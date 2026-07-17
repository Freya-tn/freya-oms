import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

const MONTH_LABEL = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

export type YearlyRevenuePoint = { month: number; monthLabel: string } & Record<string, number | string>;

export type RevenueByMonthYoY = {
  years: number[];
  points: YearlyRevenuePoint[];
};

/**
 * CA confirmé par mois, une série par année — répond à "on a maintenant
 * plusieurs années d'historique, autant voir la vraie saisonnalité" (retour
 * utilisateur 2026-07-17) plutôt que juste "vs période équivalente
 * précédente" (déjà fait sur l'Overview, section 10 de INSIGHTS.md).
 *
 * `Order.subtotalPrice` (pas de somme par ligne) : c'est un total non filtré
 * par marque, même règle que documentée pour le CA global/tendance (voir
 * "CA : Order.subtotalPrice vs somme des lignes de commande").
 */
export async function getRevenueByMonthYoY(): Promise<RevenueByMonthYoY> {
  const rows = await prisma.$queryRaw<Array<{ year: number; month: number; revenue: number }>>(Prisma.sql`
    SELECT
      EXTRACT(YEAR FROM "orderCreatedAt")::int AS year,
      EXTRACT(MONTH FROM "orderCreatedAt")::int AS month,
      SUM("subtotalPrice")::float AS revenue
    FROM "Order"
    WHERE "isConfirmed" = true AND "cancelledAt" IS NULL
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);

  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);

  const points: YearlyRevenuePoint[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    monthLabel: MONTH_LABEL[i],
  }));

  for (const row of rows) {
    points[row.month - 1][String(row.year)] = row.revenue;
  }

  return { years, points };
}
