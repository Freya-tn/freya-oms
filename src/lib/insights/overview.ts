import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getChannelTotals } from "./channelComparison";
import { getDormantStock } from "./dormant";
import { getReorderSuggestions } from "./reorder";
import { daysAgo } from "./common";

export type PeriodDelta = { current: number; previous: number; changeRatio: number | null };

function delta(current: number, previous: number): PeriodDelta {
  return { current, previous, changeRatio: previous > 0 ? (current - previous) / previous : null };
}

/**
 * KPIs de la page Overview pour une fenêtre donnée, avec comparaison à la
 * période équivalente précédente (ex: 30 derniers jours vs 30 jours d'avant)
 * — classique en pilotage business, voir docs/INSIGHTS.md section 9.
 */
export async function getOverviewKpis(windowDays: number) {
  const since = daysAgo(windowDays);
  const previousSince = daysAgo(windowDays * 2);

  const [
    stockValueRows,
    outOfStockCount,
    totals7d,
    totalsWindow,
    dormant,
    reorderRows,
    confirmedOrdersCurrent,
    totalOrdersCurrent,
    cancelledOrdersCurrent,
    confirmedOrdersPrevious,
    totalOrdersPrevious,
    cancelledOrdersPrevious,
  ] = await Promise.all([
    prisma.variant.findMany({ select: { inventoryQuantity: true, cost: true, price: true } }),
    prisma.variant.count({ where: { inventoryQuantity: 0 } }),
    getChannelTotals(7),
    getChannelTotals(windowDays),
    getDormantStock(),
    getReorderSuggestions(),
    prisma.order.count({ where: { orderCreatedAt: { gte: since }, isConfirmed: true, cancelledAt: null } }),
    prisma.order.count({ where: { orderCreatedAt: { gte: since } } }),
    prisma.order.count({ where: { orderCreatedAt: { gte: since }, cancelledAt: { not: null } } }),
    prisma.order.count({
      where: { orderCreatedAt: { gte: previousSince, lt: since }, isConfirmed: true, cancelledAt: null },
    }),
    prisma.order.count({ where: { orderCreatedAt: { gte: previousSince, lt: since } } }),
    prisma.order.count({
      where: { orderCreatedAt: { gte: previousSince, lt: since }, cancelledAt: { not: null } },
    }),
  ]);

  const stockValue = stockValueRows.reduce(
    (sum, v) => sum + v.inventoryQuantity * Number(v.cost ?? v.price),
    0,
  );

  const revenueCurrent = totalsWindow.reduce((sum, t) => sum + t.revenue, 0);

  // Revenu de la période précédente calculé séparément (pas juste réutiliser
  // totalsWindow) pour permettre le delta CA ci-dessous.
  const totalsPrevious = await getChannelTotalsForRange(previousSince, since);
  const revenuePrevious = totalsPrevious.reduce((sum, t) => sum + t.revenue, 0);

  const averageOrderValue = confirmedOrdersCurrent > 0 ? revenueCurrent / confirmedOrdersCurrent : null;
  const cancellationRateCurrent = totalOrdersCurrent > 0 ? cancelledOrdersCurrent / totalOrdersCurrent : null;
  const cancellationRatePrevious =
    totalOrdersPrevious > 0 ? cancelledOrdersPrevious / totalOrdersPrevious : null;

  return {
    stockValue,
    outOfStockCount,
    totals7d,
    revenue: delta(revenueCurrent, revenuePrevious),
    confirmedOrders: delta(confirmedOrdersCurrent, confirmedOrdersPrevious),
    dormantCount: dormant.length,
    dormantValue: dormant.reduce((sum, row) => sum + row.stockValue, 0),
    averageOrderValue,
    cancellationRate: cancellationRateCurrent,
    cancellationRatePrevious,
    reorderAlertsCount: reorderRows.length,
    reorderCriticalCount: reorderRows.filter((r) => r.urgency === "critical").length,
  };
}

async function getChannelTotalsForRange(since: Date, until: Date) {
  // Total au niveau commande (Order.subtotalPrice, calculé par Shopify) :
  // correspond exactement aux rapports natifs Shopify, contrairement à une
  // somme par ligne de commande. Voir la note dans channelComparison.ts.
  return prisma.$queryRaw<Array<{ channel: "B2B" | "B2C"; units: number; revenue: number }>>(Prisma.sql`
    SELECT
      o."channel" AS channel,
      SUM((SELECT COALESCE(SUM(li."quantity"), 0) FROM "OrderLineItem" li WHERE li."orderId" = o.id))::float AS units,
      SUM(o."subtotalPrice")::float AS revenue
    FROM "Order" o
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      AND o."orderCreatedAt" < ${until}
    GROUP BY o."channel"
  `);
}
