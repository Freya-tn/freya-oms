import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { daysAgo } from "./common";

export type RevenueTrendPoint = {
  date: string; // YYYY-MM-DD
  b2b: number;
  b2c: number;
};

export type OrderCountTrendPoint = {
  date: string;
  confirmed: number;
  cancelled: number;
};

/** CA confirmé par jour, splitté par canal — pour un graphique en aires empilées (un seul axe). */
export async function getRevenueTrend(windowDays: number): Promise<RevenueTrendPoint[]> {
  const since = daysAgo(windowDays);

  const rows = await prisma.$queryRaw<Array<{ day: Date; channel: "B2B" | "B2C"; revenue: number }>>(Prisma.sql`
    SELECT
      date_trunc('day', o."orderCreatedAt") AS day,
      o."channel" AS channel,
      SUM(o."subtotalPrice")::float AS revenue
    FROM "Order" o
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
    GROUP BY 1, 2
    ORDER BY 1
  `);

  const byDay = new Map<string, RevenueTrendPoint>();
  for (const row of rows) {
    const date = row.day.toISOString().slice(0, 10);
    const point = byDay.get(date) ?? { date, b2b: 0, b2c: 0 };
    if (row.channel === "B2B") point.b2b = row.revenue;
    else point.b2c = row.revenue;
    byDay.set(date, point);
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Nombre de commandes confirmées vs annulées par jour — pour suivre le taux d'annulation dans le temps. */
export async function getOrderCountTrend(windowDays: number): Promise<OrderCountTrendPoint[]> {
  const since = daysAgo(windowDays);

  const rows = await prisma.$queryRaw<Array<{ day: Date; isConfirmed: boolean; count: bigint }>>(Prisma.sql`
    SELECT date_trunc('day', "orderCreatedAt") AS day, "isConfirmed", count(*) AS count
    FROM "Order"
    WHERE "orderCreatedAt" >= ${since}
    GROUP BY 1, 2
    ORDER BY 1
  `);

  const byDay = new Map<string, OrderCountTrendPoint>();
  for (const row of rows) {
    const date = row.day.toISOString().slice(0, 10);
    const point = byDay.get(date) ?? { date, confirmed: 0, cancelled: 0 };
    if (row.isConfirmed) point.confirmed = Number(row.count);
    else point.cancelled = Number(row.count);
    byDay.set(date, point);
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}
