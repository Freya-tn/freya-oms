import type { Prisma } from "@/generated/prisma/client";

/**
 * Filtre commun à TOUS les insights de vente : une commande ne compte que si
 * elle est confirmée (traitée par téléphone) et non annulée. Voir
 * docs/INSIGHTS.md — ne jamais calculer une vente sans ce filtre.
 */
export function confirmedOrderFilter(sinceDate?: Date): Prisma.OrderWhereInput {
  return {
    isConfirmed: true,
    cancelledAt: null,
    ...(sinceDate ? { orderCreatedAt: { gte: sinceDate } } : {}),
  };
}

export function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}
