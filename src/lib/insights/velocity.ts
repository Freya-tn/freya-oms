import { prisma } from "@/lib/db";
import type { OrderChannel } from "@/generated/prisma/enums";
import { confirmedOrderFilter } from "./common";

type VelocityFilters = { channel?: OrderChannel; vendor?: string; category?: string };

async function velocityForRange(
  since: Date,
  until: Date,
  windowDays: number,
  filters: VelocityFilters,
): Promise<Map<string, number>> {
  const grouped = await prisma.orderLineItem.groupBy({
    by: ["variantId"],
    where: {
      variantId: { not: null },
      ...(filters.vendor || filters.category
        ? {
            variant: {
              product: {
                ...(filters.vendor ? { vendor: filters.vendor } : {}),
                ...(filters.category ? { productType: filters.category } : {}),
              },
            },
          }
        : {}),
      order: {
        ...confirmedOrderFilter(),
        orderCreatedAt: { gte: since, lt: until },
        ...(filters.channel ? { channel: filters.channel } : {}),
      },
    },
    _sum: { quantity: true },
  });

  const velocity = new Map<string, number>();
  for (const row of grouped) {
    if (!row.variantId) continue;
    velocity.set(row.variantId, (row._sum.quantity ?? 0) / windowDays);
  }
  return velocity;
}

/**
 * Vitesse de vente (unités/jour) par variante sur une fenêtre glissante se
 * terminant aujourd'hui. Voir docs/INSIGHTS.md, section 1.
 */
export async function getVelocityByVariant(
  windowDays: number,
  filters: VelocityFilters = {},
): Promise<Map<string, number>> {
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  return velocityForRange(since, until, windowDays, filters);
}

/**
 * Vitesse de vente sur la fenêtre PRÉCÉDENTE de même durée (ex: jours -60 à
 * -30 si windowDays=30) — sert à détecter une accélération/décélération de
 * la demande. Voir docs/INSIGHTS.md, section 5 (tendance).
 */
export async function getPriorVelocityByVariant(
  windowDays: number,
  filters: VelocityFilters = {},
): Promise<Map<string, number>> {
  const until = new Date();
  until.setDate(until.getDate() - windowDays);
  const since = new Date();
  since.setDate(since.getDate() - windowDays * 2);
  return velocityForRange(since, until, windowDays, filters);
}
