import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { daysAgo } from "./common";

export type VendorRow = {
  vendor: string;
  revenue: number;
  units: number;
};

/** CA + unités par marque (vendor Shopify) sur une fenêtre glissante. Voir docs/INSIGHTS.md, section 7. */
export async function getVendorBreakdown(windowDays: number): Promise<VendorRow[]> {
  const since = daysAgo(windowDays);

  const rows = await prisma.$queryRaw<VendorRow[]>(Prisma.sql`
    SELECT
      COALESCE(p.vendor, 'Autre') AS vendor,
      SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue,
      SUM(li."quantity")::float AS units
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

  return rows;
}
