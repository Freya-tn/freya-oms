import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { daysAgo } from "./common";

const DEFAULT_WINDOW_DAYS = 90;

export type ProductRevenueRow = {
  productId: string;
  productTitle: string;
  vendor: string | null;
  revenue: number;
  units: number;
};

export type CategoryRevenueRow = {
  category: string;
  revenue: number;
  units: number;
};

/**
 * CA par PRODUIT (toutes tailles/variantes confondues) — répond à "à moins
 * de regrouper par produit, un CA par variante fragmente un même produit en
 * plusieurs barres (30ml, 100ml...)". Voir docs/INSIGHTS.md, section 11.
 * Nécessairement calculé par ligne de commande (pas de total Shopify au
 * niveau produit) — même limite de précision que les autres CA filtrés par
 * marque, voir la note dans channelComparison.ts.
 */
export async function getRevenueByProduct(
  windowDays: number = DEFAULT_WINDOW_DAYS,
  filters: { vendor?: string } = {},
): Promise<ProductRevenueRow[]> {
  const since = daysAgo(windowDays);

  return prisma.$queryRaw<ProductRevenueRow[]>(Prisma.sql`
    SELECT
      p.id AS "productId",
      p.title AS "productTitle",
      p.vendor AS vendor,
      SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue,
      SUM(li."quantity")::float AS units
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
    GROUP BY p.id, p.title, p.vendor
    ORDER BY revenue DESC
  `);
}

/**
 * CA par CATÉGORIE (`Product.productType` Shopify : Nettoyant, Sérum,
 * Masque...) — vue macro complémentaire au détail par produit. Voir
 * docs/INSIGHTS.md, section 11.
 */
export async function getRevenueByCategory(
  windowDays: number = DEFAULT_WINDOW_DAYS,
  filters: { vendor?: string } = {},
): Promise<CategoryRevenueRow[]> {
  const since = daysAgo(windowDays);

  return prisma.$queryRaw<CategoryRevenueRow[]>(Prisma.sql`
    SELECT
      COALESCE(NULLIF(p."productType", ''), 'Autre') AS category,
      SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue,
      SUM(li."quantity")::float AS units
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
    GROUP BY category
    ORDER BY revenue DESC
  `);
}
