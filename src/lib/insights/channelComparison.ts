import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { daysAgo } from "./common";

const MONTH_LABEL = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

export type ChannelTotals = {
  channel: "B2B" | "B2C";
  units: number;
  revenue: number;
};

export type TopProductRow = {
  channel: "B2B" | "B2C";
  variantId: string;
  sku: string | null;
  title: string;
  productTitle: string;
  units: number;
  revenue: number;
};

/**
 * Comparaison B2B vs B2C : CA + unités par canal (filtrable par marque), et
 * top produits par canal (classements séparés, pas un classement global avec
 * colonne canal). Voir docs/INSIGHTS.md, section 4. Toujours filtré sur
 * commandes confirmées/non-annulées, bucketé sur orderCreatedAt.
 *
 * Sans filtre marque : le CA vient de `Order.subtotalPrice` (le total déjà
 * calculé par Shopify, net de toute remise quel que soit son type) — garantit
 * une correspondance exacte avec les rapports natifs Shopify. Avec un filtre
 * marque : impossible d'utiliser `subtotalPrice` (c'est un total par
 * commande, pas par produit), donc on retombe sur une somme par ligne de
 * commande — voir la note dans docs/INSIGHTS.md sur la limite de précision
 * qui en découle (remises "panier"/multi-produits pas toujours allouées par
 * Shopify au niveau de la ligne).
 */
export async function getChannelTotals(windowDays: number, filters: { vendor?: string } = {}): Promise<ChannelTotals[]> {
  const since = daysAgo(windowDays);

  if (!filters.vendor) {
    return prisma.$queryRaw<ChannelTotals[]>(Prisma.sql`
      SELECT
        o."channel" AS channel,
        SUM((SELECT COALESCE(SUM(li."quantity"), 0) FROM "OrderLineItem" li WHERE li."orderId" = o.id))::float AS units,
        SUM(o."subtotalPrice")::float AS revenue
      FROM "Order" o
      WHERE o."isConfirmed" = true
        AND o."cancelledAt" IS NULL
        AND o."orderCreatedAt" >= ${since}
      GROUP BY o."channel"
    `);
  }

  return prisma.$queryRaw<ChannelTotals[]>(Prisma.sql`
    SELECT
      o."channel" AS channel,
      SUM(li."quantity")::float AS units,
      SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      AND p.vendor = ${filters.vendor}
    GROUP BY o."channel"
  `);
}

/**
 * Toujours par ligne de commande (nécessairement — impossible d'avoir un CA
 * par produit à partir du seul total de commande). Voir la note de précision
 * ci-dessus et dans docs/INSIGHTS.md.
 */
export async function getTopProductsByChannel(
  windowDays: number,
  limit = 5,
  filters: { vendor?: string } = {},
): Promise<Record<"B2B" | "B2C", TopProductRow[]>> {
  const since = daysAgo(windowDays);

  const rows = await prisma.$queryRaw<
    Array<{
      channel: "B2B" | "B2C";
      variantId: string;
      units: number;
      revenue: number;
    }>
  >(Prisma.sql`
    SELECT
      o."channel" AS channel,
      li."variantId" AS "variantId",
      SUM(li."quantity")::float AS units,
      SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    ${filters.vendor ? Prisma.sql`JOIN "Variant" v ON v.id = li."variantId" JOIN "Product" p ON p.id = v."productId"` : Prisma.empty}
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      AND li."variantId" IS NOT NULL
      ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
    GROUP BY o."channel", li."variantId"
    ORDER BY revenue DESC
  `);

  const variantIds = [...new Set(rows.map((r) => r.variantId))];
  const variants = await prisma.variant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, sku: true, title: true, product: { select: { title: true } } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const result: Record<"B2B" | "B2C", TopProductRow[]> = { B2B: [], B2C: [] };
  for (const row of rows) {
    if (result[row.channel].length >= limit) continue;
    const variant = variantById.get(row.variantId);
    if (!variant) continue;
    result[row.channel].push({
      channel: row.channel,
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

export type MonthlyChannelPoint = { month: number; monthLabel: string; B2B: number; B2C: number };

export type MonthlyChannelBreakdown = {
  year: number;
  /** Années distinctes présentes en base (commandes confirmées), pour peupler le sélecteur d'année. */
  availableYears: number[];
  points: MonthlyChannelPoint[];
  /** Moyenne mensuelle par canal, divisée par le nombre de mois ayant au moins une vente (pas toujours 12 : une année en cours n'a que ses mois écoulés). */
  avgPerMonth: { B2B: number; B2C: number };
  monthsWithData: number;
};

/**
 * CA confirmé par mois pour UNE année donnée, splitté B2B/B2C — répond à "on
 * fait combien en moyenne par mois en B2B et en B2C cette année, et sur les
 * années précédentes ?" (retour utilisateur 2026-07-18). Filtrable par marque
 * (redescend en SQL, voir docs/INSIGHTS.md, "Filtres marque et période") —
 * sans filtre, `Order.subtotalPrice` (voir docs/INSIGHTS.md, "CA :
 * Order.subtotalPrice vs somme des lignes de commande") ; avec un filtre
 * marque, somme par ligne de commande (seule option possible pour un total
 * par produit).
 *
 * `avgPerMonth` divise par `monthsWithData`, PAS toujours 12 : sur l'année en
 * cours, diviser par 12 sous-estimerait la moyenne réelle des mois déjà
 * passés (les mois futurs n'ont simplement pas encore de ligne).
 */
export async function getMonthlyChannelBreakdown(
  year: number,
  filters: { vendor?: string } = {},
): Promise<MonthlyChannelBreakdown> {
  const [rows, yearRows] = await Promise.all([
    filters.vendor
      ? prisma.$queryRaw<Array<{ month: number; channel: "B2B" | "B2C"; revenue: number }>>(Prisma.sql`
          SELECT
            EXTRACT(MONTH FROM o."orderCreatedAt")::int AS month,
            o."channel" AS channel,
            SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue
          FROM "OrderLineItem" li
          JOIN "Order" o ON o.id = li."orderId"
          JOIN "Variant" v ON v.id = li."variantId"
          JOIN "Product" p ON p.id = v."productId"
          WHERE o."isConfirmed" = true
            AND o."cancelledAt" IS NULL
            AND EXTRACT(YEAR FROM o."orderCreatedAt")::int = ${year}
            AND p.vendor = ${filters.vendor}
          GROUP BY 1, 2
        `)
      : prisma.$queryRaw<Array<{ month: number; channel: "B2B" | "B2C"; revenue: number }>>(Prisma.sql`
          SELECT
            EXTRACT(MONTH FROM "orderCreatedAt")::int AS month,
            "channel" AS channel,
            SUM("subtotalPrice")::float AS revenue
          FROM "Order"
          WHERE "isConfirmed" = true
            AND "cancelledAt" IS NULL
            AND EXTRACT(YEAR FROM "orderCreatedAt")::int = ${year}
          GROUP BY 1, 2
        `),
    prisma.$queryRaw<Array<{ year: number }>>(Prisma.sql`
      SELECT DISTINCT EXTRACT(YEAR FROM "orderCreatedAt")::int AS year
      FROM "Order"
      WHERE "isConfirmed" = true AND "cancelledAt" IS NULL
      ORDER BY 1
    `),
  ]);

  const points: MonthlyChannelPoint[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    monthLabel: MONTH_LABEL[i],
    B2B: 0,
    B2C: 0,
  }));
  for (const row of rows) points[row.month - 1][row.channel] = row.revenue;

  const monthsWithData = points.filter((p) => p.B2B > 0 || p.B2C > 0).length;
  const divisor = Math.max(1, monthsWithData);

  return {
    year,
    availableYears: yearRows.map((r) => r.year).sort((a, b) => a - b),
    points,
    avgPerMonth: {
      B2B: points.reduce((sum, p) => sum + p.B2B, 0) / divisor,
      B2C: points.reduce((sum, p) => sum + p.B2C, 0) / divisor,
    },
    monthsWithData,
  };
}
