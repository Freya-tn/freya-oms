import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { daysAgo } from "./common";

const TIER_A_THRESHOLD = 0.8;
const TIER_B_THRESHOLD = 0.95;

export type MarginRow = {
  id: string;
  label: string;
  /** CA total (toutes les lignes, coûtées ou non) — jamais gonflé/déformé par le filtre coût. */
  revenue: number;
  /** CA des lignes dont la variante a un coût renseigné — base réelle du calcul de marge. */
  costedRevenue: number;
  cost: number;
  margin: number;
  /** null si costedRevenue = 0 (aucune ligne coûtée) — jamais un taux basé sur un coût traité comme 0. */
  marginRate: number | null;
  /** Part du CA total couverte par un coût connu (0 à 1) — à afficher pour ne jamais laisser croire à une marge complète sur des données partielles. */
  costCoverage: number;
};

/**
 * Marge = CA net de remise moins coût de revient, calculée UNIQUEMENT sur
 * les lignes dont la variante a un `cost` renseigné (jamais un coût manquant
 * traité comme 0 — voir docs/INSIGHTS.md, section 14). `costCoverage`
 * explicite la part du CA réellement couverte par cette marge, pour ne
 * jamais présenter un chiffre partiel comme s'il était complet.
 *
 * Toujours calculée par ligne de commande (le coût vit sur `Variant`, comme
 * `isBlackMarket` — même limite de précision documentée pour `subtotalPrice`
 * vs somme des lignes, voir la section "CA : Order.subtotalPrice...").
 */
function toMarginRows(
  rows: Array<{ id: string; label: string; revenue: number; costedRevenue: number; cost: number }>,
): MarginRow[] {
  return rows.map((row) => ({
    ...row,
    margin: row.costedRevenue - row.cost,
    marginRate: row.costedRevenue > 0 ? (row.costedRevenue - row.cost) / row.costedRevenue : null,
    costCoverage: row.revenue > 0 ? row.costedRevenue / row.revenue : 0,
  }));
}

export async function getMarginByProduct(windowDays: number, filters: { vendor?: string } = {}): Promise<MarginRow[]> {
  const since = daysAgo(windowDays);
  const rows = await prisma.$queryRaw<Array<{ id: string; label: string; revenue: number; costedRevenue: number; cost: number }>>(Prisma.sql`
    SELECT
      p.id AS id,
      p.title AS label,
      SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue,
      SUM(CASE WHEN v.cost IS NOT NULL THEN li."quantity" * li."unitPrice" - li."totalDiscount" ELSE 0 END)::float AS "costedRevenue",
      SUM(CASE WHEN v.cost IS NOT NULL THEN li."quantity" * v.cost ELSE 0 END)::float AS cost
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
    GROUP BY p.id, p.title
    ORDER BY revenue DESC
  `);
  return toMarginRows(rows);
}

export async function getMarginByVendor(windowDays: number): Promise<MarginRow[]> {
  const since = daysAgo(windowDays);
  const rows = await prisma.$queryRaw<Array<{ id: string; label: string; revenue: number; costedRevenue: number; cost: number }>>(Prisma.sql`
    SELECT
      COALESCE(p.vendor, 'Autre') AS id,
      COALESCE(p.vendor, 'Autre') AS label,
      SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue,
      SUM(CASE WHEN v.cost IS NOT NULL THEN li."quantity" * li."unitPrice" - li."totalDiscount" ELSE 0 END)::float AS "costedRevenue",
      SUM(CASE WHEN v.cost IS NOT NULL THEN li."quantity" * v.cost ELSE 0 END)::float AS cost
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
    GROUP BY p.vendor
    ORDER BY revenue DESC
  `);
  return toMarginRows(rows);
}

export type MarginByChannelRow = MarginRow & { channel: "B2B" | "B2C" };

export async function getMarginByChannel(windowDays: number, filters: { vendor?: string } = {}): Promise<MarginByChannelRow[]> {
  const since = daysAgo(windowDays);
  const rows = await prisma.$queryRaw<Array<{ id: "B2B" | "B2C"; label: "B2B" | "B2C"; revenue: number; costedRevenue: number; cost: number }>>(Prisma.sql`
    SELECT
      o."channel" AS id,
      o."channel" AS label,
      SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue,
      SUM(CASE WHEN v.cost IS NOT NULL THEN li."quantity" * li."unitPrice" - li."totalDiscount" ELSE 0 END)::float AS "costedRevenue",
      SUM(CASE WHEN v.cost IS NOT NULL THEN li."quantity" * v.cost ELSE 0 END)::float AS cost
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
    GROUP BY o."channel"
  `);
  return toMarginRows(rows).map((r) => ({ ...r, channel: r.id as "B2B" | "B2C" }));
}

export type MarginAbcTier = "A" | "B" | "C";

export type MarginAbcRow = {
  variantId: string;
  sku: string | null;
  title: string;
  productTitle: string;
  margin: number;
  marginShare: number;
  cumulativeShare: number;
  tier: MarginAbcTier;
};

/**
 * Classification ABC (Pareto) par MARGE plutôt que par CA — un top-vendeur
 * peut être un mauvais élève en marge, et inversement. Exclut les variantes
 * sans coût renseigné (impossible de les classer par marge sans supposer un
 * coût de 0, ce qui les ferait paraître artificiellement rentables) : à
 * signaler dans l'UI plutôt qu'à cacher silencieusement.
 */
export async function getAbcClassificationByMargin(
  windowDays: number,
  filters: { vendor?: string } = {},
): Promise<{ rows: MarginAbcRow[]; excludedVariantCount: number }> {
  const since = daysAgo(windowDays);

  const rows = await prisma.$queryRaw<Array<{ variantId: string; margin: number }>>(Prisma.sql`
    SELECT li."variantId" AS "variantId", SUM(li."quantity" * (li."unitPrice" - v.cost) - li."totalDiscount")::float AS margin
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      AND li."variantId" IS NOT NULL
      AND v.cost IS NOT NULL
      ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
    GROUP BY li."variantId"
    ORDER BY margin DESC
  `);

  const excludedVariantCount = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT li."variantId") AS count
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      AND li."variantId" IS NOT NULL
      AND v.cost IS NULL
      ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
  `).then((r) => Number(r[0]?.count ?? 0));

  const totalMargin = rows.reduce((sum, r) => sum + r.margin, 0);
  if (totalMargin === 0) return { rows: [], excludedVariantCount };

  const variantIds = rows.map((r) => r.variantId);
  const variants = await prisma.variant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, sku: true, title: true, product: { select: { title: true } } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  let cumulative = 0;
  const result: MarginAbcRow[] = [];
  for (const row of rows) {
    const variant = variantById.get(row.variantId);
    if (!variant) continue;

    cumulative += row.margin;
    const cumulativeShare = cumulative / totalMargin;
    const tier: MarginAbcTier = cumulativeShare <= TIER_A_THRESHOLD ? "A" : cumulativeShare <= TIER_B_THRESHOLD ? "B" : "C";

    result.push({
      variantId: row.variantId,
      sku: variant.sku,
      title: variant.title,
      productTitle: variant.product.title,
      margin: row.margin,
      marginShare: row.margin / totalMargin,
      cumulativeShare,
      tier,
    });
  }

  return { rows: result, excludedVariantCount };
}
