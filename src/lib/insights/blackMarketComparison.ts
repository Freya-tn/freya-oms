import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { daysAgo } from "./common";

export type SaleType = "DECLARED" | "BLACK";

export type SaleTypeTotals = {
  saleType: SaleType;
  units: number;
  revenue: number;
};

export type TopProductBySaleTypeRow = {
  saleType: SaleType;
  variantId: string;
  sku: string | null;
  title: string;
  productTitle: string;
  units: number;
  revenue: number;
};

/**
 * Ratio ventes déclarées vs non déclarées ("au black", `Variant.isBlackMarket`,
 * voir docs/SHOPIFY_SYNC.md) : CA + unités par type de vente (filtrable par
 * marque), et top produits par type. Voir docs/INSIGHTS.md, section 12.
 * Toujours filtré sur commandes confirmées/non-annulées, bucketé sur
 * orderCreatedAt.
 *
 * Contrairement à `channel` (dérivé au niveau commande), `isBlackMarket` est
 * une propriété du SKU/variante — une même commande peut mélanger du déclaré
 * et du black. Donc, contrairement à `getChannelTotals`, on ne peut JAMAIS
 * utiliser `Order.subtotalPrice` ici, même sans filtre marque : on retombe
 * systématiquement sur une somme par ligne de commande (même limite de
 * précision que celle documentée pour les filtres marque dans INSIGHTS.md).
 */
export async function getSaleTypeTotals(windowDays: number, filters: { vendor?: string } = {}): Promise<SaleTypeTotals[]> {
  const since = daysAgo(windowDays);

  return prisma.$queryRaw<SaleTypeTotals[]>(Prisma.sql`
    SELECT
      CASE WHEN v."isBlackMarket" THEN 'BLACK' ELSE 'DECLARED' END AS "saleType",
      SUM(li."quantity")::float AS units,
      SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
    GROUP BY v."isBlackMarket"
  `);
}

/** Toujours par ligne de commande (nécessairement, voir la note ci-dessus). */
export async function getTopProductsBySaleType(
  windowDays: number,
  limit = 5,
  filters: { vendor?: string } = {},
): Promise<Record<SaleType, TopProductBySaleTypeRow[]>> {
  const since = daysAgo(windowDays);

  const rows = await prisma.$queryRaw<
    Array<{ saleType: SaleType; variantId: string; units: number; revenue: number }>
  >(Prisma.sql`
    SELECT
      CASE WHEN v."isBlackMarket" THEN 'BLACK' ELSE 'DECLARED' END AS "saleType",
      li."variantId" AS "variantId",
      SUM(li."quantity")::float AS units,
      SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
    GROUP BY v."isBlackMarket", li."variantId"
    ORDER BY revenue DESC
  `);

  const variantIds = [...new Set(rows.map((r) => r.variantId))];
  const variants = await prisma.variant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, sku: true, title: true, product: { select: { title: true } } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const result: Record<SaleType, TopProductBySaleTypeRow[]> = { DECLARED: [], BLACK: [] };
  for (const row of rows) {
    if (result[row.saleType].length >= limit) continue;
    const variant = variantById.get(row.variantId);
    if (!variant) continue;
    result[row.saleType].push({
      saleType: row.saleType,
      variantId: row.variantId,
      sku: variant.sku,
      title: variant.title,
      productTitle: variant.product.title,
      units: row.units,
      revenue: row.revenue,
    });
  }
  return result;
}
