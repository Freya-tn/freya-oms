import { prisma } from "@/lib/db";
import { computeWeightedAverageCost } from "@/lib/purchaseIntakeCalc";
import {
  adjustInventoryQuantity,
  getPrimaryLocationId,
  updateInventoryItemCost,
} from "@/lib/shopify/queries/inventory";

export type PurchaseIntakeLineInput = {
  variantId: string;
  quantityPurchased: number;
  purchasePrice: number;
};

/**
 * Crée le batch et fige immédiatement previousQuantity/previousCost/
 * newQuantity/newCost par ligne (pas recalculé pendant le traitement, pour
 * que l'affichage "avant -> après" reste stable même si autre chose modifie
 * la variante entre-temps). Le traitement Shopify démarre en arrière-plan
 * (promesse volontairement non attendue - voir processPurchaseIntake) :
 * le process Node tourne en continu sous PM2, donc un traitement long
 * survit à la réponse de la Server Action, comme runDueAutomations() côté
 * projet SMS.
 */
export async function startPurchaseIntake(vendor: string, lines: PurchaseIntakeLineInput[]): Promise<string> {
  if (lines.length === 0) throw new Error("Au moins une ligne est requise.");
  for (const line of lines) {
    if (!Number.isInteger(line.quantityPurchased) || line.quantityPurchased <= 0) {
      throw new Error("Quantité achetée invalide.");
    }
    if (!(line.purchasePrice > 0)) {
      throw new Error("Prix d'achat invalide.");
    }
  }

  const variants = await prisma.variant.findMany({
    where: { id: { in: lines.map((l) => l.variantId) } },
    select: { id: true, inventoryQuantity: true, cost: true },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const batch = await prisma.purchaseIntake.create({
    data: {
      vendor,
      lines: {
        create: lines.map((line) => {
          const variant = variantById.get(line.variantId);
          if (!variant) throw new Error(`Variante introuvable: ${line.variantId}`);
          const { newQuantity, newCost } = computeWeightedAverageCost(
            variant.inventoryQuantity,
            variant.cost !== null ? Number(variant.cost) : null,
            line.quantityPurchased,
            line.purchasePrice,
          );
          return {
            variantId: line.variantId,
            quantityPurchased: line.quantityPurchased,
            purchasePrice: line.purchasePrice,
            previousQuantity: variant.inventoryQuantity,
            previousCost: variant.cost,
            newQuantity,
            newCost,
          };
        }),
      },
    },
  });

  void processPurchaseIntake(batch.id);

  return batch.id;
}

const LINE_RETRY_ATTEMPTS = 3;
const LINE_RETRY_BASE_DELAY_MS = 2000;

// Le throttle Shopify (429/THROTTLED) est déjà géré par shopifyGraphQL() lui-
// même (backoff exponentiel intégré). Cette retry supplémentaire couvre les
// erreurs transitoires D'UN AUTRE ORDRE (coupure réseau, 5xx ponctuel) —
// demande explicite : "si erreur faut attendre un peu et relancer".
async function withLineRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt >= LINE_RETRY_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, LINE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
    }
  }
}

/**
 * Traite les lignes `pending` d'un batch SÉQUENTIELLEMENT (jamais en
 * parallèle — un seul budget de throttle Shopify partagé, même logique que
 * `analyzeAll()` côté projet SMS). Un échec de ligne (après ses propres
 * retries) ne bloque jamais les lignes suivantes.
 */
export async function processPurchaseIntake(batchId: string): Promise<void> {
  const lines = await prisma.purchaseIntakeLine.findMany({
    where: { purchaseIntakeId: batchId, status: "pending" },
    include: { variant: { select: { inventoryItemId: true } } },
  });

  const locationGid = await getPrimaryLocationId();

  for (const line of lines) {
    try {
      const inventoryItemGid = `gid://shopify/InventoryItem/${line.variant.inventoryItemId}`;
      await withLineRetry(() =>
        adjustInventoryQuantity(
          inventoryItemGid,
          locationGid,
          line.quantityPurchased,
          line.previousQuantity,
          line.id,
        ),
      );
      await withLineRetry(() => updateInventoryItemCost(inventoryItemGid, Number(line.newCost)));

      await prisma.$transaction([
        prisma.variant.update({
          where: { id: line.variantId },
          data: { inventoryQuantity: line.newQuantity, cost: line.newCost, syncedAt: new Date() },
        }),
        prisma.inventorySnapshot.create({
          data: { variantId: line.variantId, quantity: line.newQuantity },
        }),
        prisma.purchaseIntakeLine.update({
          where: { id: line.id },
          data: { status: "applied", appliedAt: new Date() },
        }),
      ]);
    } catch (error) {
      await prisma.purchaseIntakeLine.update({
        where: { id: line.id },
        data: { status: "failed", errorMessage: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  const allStatuses = await prisma.purchaseIntakeLine.findMany({
    where: { purchaseIntakeId: batchId },
    select: { status: true },
  });
  const hasFailure = allStatuses.some((l) => l.status === "failed");
  await prisma.purchaseIntake.update({
    where: { id: batchId },
    data: { status: hasFailure ? "completed_with_errors" : "completed" },
  });
}

/** Relit le batch + ses lignes (avec le libellé produit/variante) pour le polling côté client. */
export async function getPurchaseIntakeStatus(batchId: string) {
  const batch = await prisma.purchaseIntake.findUnique({
    where: { id: batchId },
    include: {
      lines: {
        include: { variant: { select: { title: true, sku: true, product: { select: { title: true } } } } },
      },
    },
  });
  if (!batch) throw new Error("Batch introuvable.");
  return batch;
}

/** Relance uniquement les lignes en échec (repasse `pending`), sans jamais retoucher les lignes déjà appliquées. */
export async function retryFailedLines(batchId: string): Promise<void> {
  await prisma.purchaseIntakeLine.updateMany({
    where: { purchaseIntakeId: batchId, status: "failed" },
    data: { status: "pending", errorMessage: null },
  });
  await prisma.purchaseIntake.update({ where: { id: batchId }, data: { status: "in_progress" } });
  void processPurchaseIntake(batchId);
}
