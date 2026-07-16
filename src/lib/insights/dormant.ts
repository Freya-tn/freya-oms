import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getVelocityByVariant } from "./velocity";

const VELOCITY_WINDOW_DAYS = 60;

// Seuil de vitesse de vente en dessous duquel une variante est considérée
// "dormante". À ajuster avec l'équipe une fois des données réelles
// observées — voir docs/INSIGHTS.md, section 3.
const SEUIL_DORMANT_UNITS_PER_DAY = 0.05; // ~1 unité vendue tous les 20 jours

export type DormantRow = {
  variantId: string;
  sku: string | null;
  title: string;
  productTitle: string;
  vendor: string | null;
  inventoryQuantity: number;
  velocityPerDay: number;
  stockValue: number;
  lastSaleAt: Date | null;
};

/** Date de la commande la plus ancienne synchronisée — point de départ réel de "jamais vendu depuis le début de l'historique". */
export async function getHistoryStartDate(): Promise<Date | null> {
  const result = await prisma.order.aggregate({ _min: { orderCreatedAt: true } });
  return result._min.orderCreatedAt;
}

/** Date de dernière vente confirmée, tous historique confondu (pas de fenêtre glissante). */
async function getLastSaleDateByVariant(): Promise<Map<string, Date>> {
  const rows = await prisma.$queryRaw<Array<{ variantId: string; lastSaleAt: Date }>>(Prisma.sql`
    SELECT li."variantId" AS "variantId", MAX(o."orderCreatedAt") AS "lastSaleAt"
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    WHERE li."variantId" IS NOT NULL
      AND o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
    GROUP BY li."variantId"
  `);
  return new Map(rows.map((r) => [r.variantId, r.lastSaleAt]));
}

/** Variantes à rotation quasi nulle mais avec du stock immobilisé, triées par valeur décroissante. */
export async function getDormantStock(filters: { vendor?: string } = {}): Promise<DormantRow[]> {
  const [variants, velocity, lastSaleByVariant] = await Promise.all([
    prisma.variant.findMany({
      where: {
        inventoryQuantity: { gt: 0 },
        ...(filters.vendor ? { product: { vendor: filters.vendor } } : {}),
      },
      select: {
        id: true,
        sku: true,
        title: true,
        inventoryQuantity: true,
        cost: true,
        price: true,
        product: { select: { title: true, vendor: true } },
      },
    }),
    getVelocityByVariant(VELOCITY_WINDOW_DAYS, { vendor: filters.vendor }),
    getLastSaleDateByVariant(),
  ]);

  const rows: DormantRow[] = [];
  for (const variant of variants) {
    const velocityPerDay = velocity.get(variant.id) ?? 0;
    if (velocityPerDay >= SEUIL_DORMANT_UNITS_PER_DAY) continue;

    const unitValue = variant.cost ?? variant.price;
    rows.push({
      variantId: variant.id,
      sku: variant.sku,
      title: variant.title,
      productTitle: variant.product.title,
      vendor: variant.product.vendor,
      inventoryQuantity: variant.inventoryQuantity,
      velocityPerDay,
      stockValue: variant.inventoryQuantity * Number(unitValue),
      lastSaleAt: lastSaleByVariant.get(variant.id) ?? null,
    });
  }

  return rows.sort((a, b) => b.stockValue - a.stockValue);
}

export type DormantSummary = {
  totalValue: number;
  variantCount: number;
  averageValue: number;
  neverSoldCount: number;
};

/**
 * Agrégats calculés en mémoire sur un résultat déjà filtré par
 * `getDormantStock` (pas une nouvelle requête filtrée — juste une réduction
 * d'un jeu de lignes déjà correct, même principe que les KPI dérivés des
 * pages B2B vs B2C / Déclaré vs black). Voir docs/INSIGHTS.md, section 13.
 */
export function summarizeDormantStock(rows: DormantRow[]): DormantSummary {
  const totalValue = rows.reduce((sum, row) => sum + row.stockValue, 0);
  const variantCount = rows.length;
  const neverSoldCount = rows.filter((row) => row.lastSaleAt === null).length;
  return {
    totalValue,
    variantCount,
    averageValue: variantCount > 0 ? totalValue / variantCount : 0,
    neverSoldCount,
  };
}

export type VendorStockValueRow = { vendor: string; value: number };

/** Répartition de la valeur immobilisée par marque, une seule teinte (magnitude, pas identité) — voir docs/INSIGHTS.md, section 7. */
export function groupDormantValueByVendor(rows: DormantRow[]): VendorStockValueRow[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = row.vendor ?? "Autre";
    totals.set(key, (totals.get(key) ?? 0) + row.stockValue);
  }
  return [...totals.entries()]
    .map(([vendor, value]) => ({ vendor, value }))
    .sort((a, b) => b.value - a.value);
}
