import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { daysAgo } from "./common";

export type ProductHistoryPoint = {
  date: string; // YYYY-MM-DD
  unitsSold: number;
  /** true = au moins un signal "en stock" ce jour-là ; false = rupture confirmée ; null = pas de donnée (avant le début du suivi pour cette variante). */
  available: boolean | null;
};

export type ProductHistorySummary = {
  daysInWindow: number;
  totalUnitsSold: number;
  totalRevenue: number;
  daysWithSales: number;
  /** Jours de rupture confirmée (`available === false`). */
  stockoutDays: number;
  /** Jours sans suivi de stock (`available === null`), jamais interprétés comme rupture ni disponibilité. */
  unknownDays: number;
  /** Jours avec un signal "en stock" confirmé (`available === true`). */
  availableDays: number;
  bestDay: { date: string; unitsSold: number } | null;
};

/**
 * Historique croisé ventes + disponibilité, jour par jour, pour UNE
 * variante — répond à "je veux voir l'effet d'une rupture sur les ventes
 * dans le temps" (retour utilisateur 2026-07-18). `unitsSold` vient
 * d'`OrderLineItem` (commandes confirmées uniquement, comme partout ailleurs -
 * voir docs/INSIGHTS.md, règle commune). `available` vient d'`InventorySnapshot`
 * (vrai poll ET backfill Mongo confondus - les deux se réduisent au même
 * signal binaire "au moins une quantité positive ce jour-là", voir
 * `getVelocityByVariant`) : jamais la quantité brute affichée comme un
 * niveau de stock précis, seulement disponible/rupture/inconnu, pour ne pas
 * laisser croire à une précision numérique que le backfill n'a pas (voir
 * docs/INSIGHTS.md, section 1, "Backfill ponctuel depuis un tracker externe").
 */
export async function getProductSalesAndStockHistory(
  variantId: string,
  windowDays: number,
): Promise<{ points: ProductHistoryPoint[]; summary: ProductHistorySummary }> {
  const since = daysAgo(windowDays);
  const now = new Date();

  const [salesRows, snapshotRows] = await Promise.all([
    prisma.$queryRaw<Array<{ day: Date; units: number; revenue: number }>>(Prisma.sql`
      SELECT date_trunc('day', o."orderCreatedAt") AS day,
        SUM(li."quantity")::float AS units,
        SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue
      FROM "OrderLineItem" li
      JOIN "Order" o ON o.id = li."orderId"
      WHERE li."variantId" = ${variantId}
        AND o."isConfirmed" = true
        AND o."cancelledAt" IS NULL
        AND o."orderCreatedAt" >= ${since}
      GROUP BY 1
    `),
    prisma.$queryRaw<Array<{ day: Date; maxQuantity: number }>>(Prisma.sql`
      SELECT date_trunc('day', "recordedAt") AS day, MAX(quantity)::int AS "maxQuantity"
      FROM "InventorySnapshot"
      WHERE "variantId" = ${variantId}
        AND "recordedAt" >= ${since}
      GROUP BY 1
    `),
  ]);

  const salesByDay = new Map(salesRows.map((r) => [r.day.toISOString().slice(0, 10), r.units]));
  const availableByDay = new Map(snapshotRows.map((r) => [r.day.toISOString().slice(0, 10), r.maxQuantity > 0]));

  const points: ProductHistoryPoint[] = [];
  for (let cursor = new Date(since); cursor <= now; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const key = cursor.toISOString().slice(0, 10);
    points.push({
      date: key,
      unitsSold: salesByDay.get(key) ?? 0,
      available: availableByDay.get(key) ?? null,
    });
  }

  const bestPoint = points.reduce<ProductHistoryPoint | null>(
    (best, point) => (best === null || point.unitsSold > best.unitsSold ? point : best),
    null,
  );

  const summary: ProductHistorySummary = {
    daysInWindow: points.length,
    totalUnitsSold: salesRows.reduce((sum, r) => sum + r.units, 0),
    totalRevenue: salesRows.reduce((sum, r) => sum + r.revenue, 0),
    daysWithSales: points.filter((p) => p.unitsSold > 0).length,
    stockoutDays: points.filter((p) => p.available === false).length,
    unknownDays: points.filter((p) => p.available === null).length,
    availableDays: points.filter((p) => p.available === true).length,
    bestDay: bestPoint && bestPoint.unitsSold > 0 ? { date: bestPoint.date, unitsSold: bestPoint.unitsSold } : null,
  };

  return { points, summary };
}
