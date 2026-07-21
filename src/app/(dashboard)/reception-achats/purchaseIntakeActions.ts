"use server";

import {
  getPurchaseIntakeStatus,
  retryFailedLines,
  startPurchaseIntake,
  type PurchaseIntakeLineInput,
} from "@/lib/insights/purchaseIntake";

export type StartPurchaseIntakeResult = { ok: true; batchId: string } | { ok: false; error: string };

export async function startPurchaseIntakeAction(
  vendor: string,
  lines: PurchaseIntakeLineInput[],
): Promise<StartPurchaseIntakeResult> {
  try {
    const batchId = await startPurchaseIntake(vendor, lines);
    return { ok: true, batchId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type PurchaseIntakeLineStatus = {
  id: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  quantityPurchased: number;
  purchasePrice: number;
  previousQuantity: number;
  previousCost: number | null;
  newQuantity: number;
  newCost: number;
  status: "pending" | "applied" | "failed";
  errorMessage: string | null;
};

export type PurchaseIntakeStatus = {
  id: string;
  vendor: string;
  status: "in_progress" | "completed" | "completed_with_errors";
  lines: PurchaseIntakeLineStatus[];
};

// Décimales Prisma converties en `number` ici — ce sont les seules valeurs
// qui traversent la frontière Server Action -> Client Component (jamais un
// objet Decimal brut, pas garanti sérialisable tel quel).
export async function getPurchaseIntakeStatusAction(batchId: string): Promise<PurchaseIntakeStatus> {
  const batch = await getPurchaseIntakeStatus(batchId);
  return {
    id: batch.id,
    vendor: batch.vendor,
    status: batch.status as PurchaseIntakeStatus["status"],
    lines: batch.lines.map((line) => ({
      id: line.id,
      variantId: line.variantId,
      productTitle: line.variant.product.title,
      variantTitle: line.variant.title,
      sku: line.variant.sku,
      quantityPurchased: line.quantityPurchased,
      purchasePrice: Number(line.purchasePrice),
      previousQuantity: line.previousQuantity,
      previousCost: line.previousCost !== null ? Number(line.previousCost) : null,
      newQuantity: line.newQuantity,
      newCost: Number(line.newCost),
      status: line.status as PurchaseIntakeLineStatus["status"],
      errorMessage: line.errorMessage,
    })),
  };
}

export async function retryFailedLinesAction(batchId: string): Promise<StartPurchaseIntakeResult> {
  try {
    await retryFailedLines(batchId);
    return { ok: true, batchId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
