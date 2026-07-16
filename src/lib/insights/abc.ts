import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { daysAgo } from "./common";

const DEFAULT_WINDOW_DAYS = 90;

// Seuils Pareto standards : A = jusqu'à 80% du CA cumulé, B = jusqu'à 95%, C = le reste.
const TIER_A_THRESHOLD = 0.8;
const TIER_B_THRESHOLD = 0.95;

export type AbcTier = "A" | "B" | "C";

export type AbcRow = {
  variantId: string;
  sku: string | null;
  title: string;
  productTitle: string;
  revenue: number;
  revenueShare: number;
  cumulativeShare: number;
  tier: AbcTier;
};

/**
 * Classification ABC (Pareto) des variantes par CA confirmé sur une fenêtre
 * glissante (filtrable par marque). Voir docs/INSIGHTS.md, section 6.
 * Présentée en table plutôt qu'en graphique à double axe (CA + % cumulé) —
 * un graphique à deux axes induit en erreur, voir la skill dataviz.
 */
export async function getAbcClassification(
  windowDays: number = DEFAULT_WINDOW_DAYS,
  filters: { vendor?: string } = {},
): Promise<AbcRow[]> {
  const since = daysAgo(windowDays);

  const rows = await prisma.$queryRaw<Array<{ variantId: string; revenue: number }>>(Prisma.sql`
    SELECT li."variantId" AS "variantId", SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      AND li."variantId" IS NOT NULL
      ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
    GROUP BY li."variantId"
    ORDER BY revenue DESC
  `);

  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
  if (totalRevenue === 0) return [];

  const variantIds = rows.map((r) => r.variantId);
  const variants = await prisma.variant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, sku: true, title: true, product: { select: { title: true } } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  let cumulative = 0;
  const result: AbcRow[] = [];
  for (const row of rows) {
    const variant = variantById.get(row.variantId);
    if (!variant) continue;

    cumulative += row.revenue;
    const cumulativeShare = cumulative / totalRevenue;
    const tier: AbcTier = cumulativeShare <= TIER_A_THRESHOLD ? "A" : cumulativeShare <= TIER_B_THRESHOLD ? "B" : "C";

    result.push({
      variantId: row.variantId,
      sku: variant.sku,
      title: variant.title,
      productTitle: variant.product.title,
      revenue: row.revenue,
      revenueShare: row.revenue / totalRevenue,
      cumulativeShare,
      tier,
    });
  }

  return result;
}
