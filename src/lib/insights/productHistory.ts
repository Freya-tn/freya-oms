import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { daysAgo } from "./common";

export type ProductHistoryPoint = {
  date: string; // YYYY-MM-DD
  unitsSold: number;
  /** true = au moins un signal "en stock" ce jour-là ; false = rupture confirmée ; null = pas de donnée (avant le début du suivi pour cette variante). */
  available: boolean | null;
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
export async function getProductSalesAndStockHistory(variantId: string, windowDays: number): Promise<ProductHistoryPoint[]> {
  const since = daysAgo(windowDays);
  const now = new Date();

  const [salesRows, snapshotRows] = await Promise.all([
    prisma.$queryRaw<Array<{ day: Date; units: number }>>(Prisma.sql`
      SELECT date_trunc('day', o."orderCreatedAt") AS day, SUM(li."quantity")::float AS units
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
  return points;
}
