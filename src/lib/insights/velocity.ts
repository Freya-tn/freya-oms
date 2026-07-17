import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
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

// Vitesse de vente "adaptative" (page Stock) — voir docs/INSIGHTS.md,
// section "Vitesse de vente adaptative (page Stock)" pour la justification
// complète. Deux problèmes réglés à la fois, sans paramètre à régler
// manuellement :
//
// 1. Un produit récemment ajouté ne doit JAMAIS voir sa vitesse diluée par
//    une période où il n'existait pas encore côté Shopify (`shopifyCreatedAt`
//    borne la fenêtre réellement utilisée, jamais une fenêtre fixe pour tous).
// 2. Un produit ancien avec beaucoup d'historique doit en profiter (jusqu'à
//    1 an regardé), mais une moyenne plate sur un an réagit trop lentement à
//    un vrai changement de tendance récent — chaque vente est donc pondérée
//    par son ancienneté (décroissance exponentielle, demi-vie 30j : une vente
//    d'il y a 30 jours compte moitié moins qu'une vente d'aujourd'hui).
const ADAPTIVE_MAX_LOOKBACK_DAYS = 365;
const ADAPTIVE_HALF_LIFE_DAYS = 30;
const ADAPTIVE_DECAY_RATE = Math.LN2 / ADAPTIVE_HALF_LIFE_DAYS;

// Garde-fou de confiance — découvert le 2026-07-18 sur un cas réel : une
// variante à 41 unités en stock, 3 ventes au total sur ~9 mois et rien du
// tout depuis 86 jours affichait "11896 jours de stock restant". Le calcul
// n'était pas "faux" mathématiquement (une décroissance exponentielle sur un
// signal quasi éteint donne mécaniquement un chiffre minuscule, donc un ratio
// stock/vitesse énorme) — le vrai problème est d'extrapoler un "jours
// restants" à partir d'un signal trop pauvre pour être digne de confiance.
// Plutôt que de fabriquer un nombre précis mais trompeur, on refuse
// d'estimer "jours restants" dans ce cas (même traitement que "pas de vente
// du tout" — voir `STOCK_STATUS_OPTIONS`, statut "unknown").
//
// Note sur `Variant.shopifyCreatedAt` : ne PAS confondre "date de création de
// la fiche Shopify" et "depuis quand ce produit se vend réellement" — Freya
// crée parfois une fiche produit bien avant d'avoir du stock (référencement
// SEO anticipé), donc `shopifyCreatedAt` reste utile pour borner la fenêtre
// (jamais plus loin qu'un produit n'existe), mais ne suffit PAS à juger de
// la fiabilité d'une extrapolation — d'où ce garde-fou basé sur l'activité
// de vente réelle (nombre de ventes + fraîcheur de la dernière vente),
// seule preuve directe qu'on a des données pertinentes pour prédire.
const MIN_CONFIDENT_UNITS = 3;
const MAX_DAYS_SINCE_LAST_SALE_FOR_CONFIDENCE = 60; // 2 demi-vies : au-delà, le signal est déjà résiduel

export type AdaptiveVelocity = {
  /** Vitesse pondérée (récent = plus de poids) — toujours calculée, même si `confident` est faux (contexte utile). */
  velocityPerDay: number;
  /** Unités vendues, brutes (non pondérées), sur la fenêtre effective — pour le taux d'écoulement (jamais gaté par `confident`). */
  unitsInWindow: number;
  /** Fenêtre réellement utilisée pour cette variante (min(365j, son ancienneté réelle)). */
  effectiveWindowDays: number;
  /** Faux si le signal est trop pauvre (trop peu de ventes et/ou rien de récent) pour extrapoler un "jours restants" fiable — voir le commentaire ci-dessus. */
  confident: boolean;
};

export async function getAdaptiveVelocityByVariant(
  filters: VelocityFilters = {},
  // Optionnel — sert UNIQUEMENT au backtest du moteur de prévisions
  // (forecast.ts), qui doit pouvoir se demander "qu'aurait-on calculé à cette
  // date passée" sans voir de ventes postérieures. Sans borne haute sur
  // orderCreatedAt, une variante "à cette date" verrait quand même les ventes
  // réelles survenues APRÈS — une fuite de données qui rendrait tout backtest
  // trompeur (toujours "juste", puisqu'il aurait triché). Par défaut (aucun
  // asOf fourni, tous les appelants existants), `now` reste la date réelle,
  // comportement strictement inchangé.
  asOf?: Date,
): Promise<Map<string, AdaptiveVelocity>> {
  const now = asOf ?? new Date();
  const lookbackFloor = new Date(now.getTime() - ADAPTIVE_MAX_LOOKBACK_DAYS * 86_400_000);
  // Négatif précalculé côté JS : un moins unaire directement sur un
  // paramètre lié rend l'opérateur `-` ambigu pour Postgres ("unknown" tant
  // que le type n'est pas déterminé) — passer la valeur déjà négative évite
  // le problème plutôt que de multiplier les casts.
  const negativeDecayRate = -ADAPTIVE_DECAY_RATE;

  const rows = await prisma.$queryRaw<
    Array<{
      variantId: string;
      rawUnits: number;
      weightedUnits: number;
      shopifyCreatedAt: Date | null;
      lastSaleAt: Date;
    }>
  >(Prisma.sql`
    SELECT
      li."variantId" AS "variantId",
      SUM(li."quantity")::float AS "rawUnits",
      SUM(li."quantity" * EXP(${negativeDecayRate} * EXTRACT(EPOCH FROM (${now}::timestamptz - o."orderCreatedAt")) / 86400))::float AS "weightedUnits",
      MIN(v."shopifyCreatedAt") AS "shopifyCreatedAt",
      MAX(o."orderCreatedAt") AS "lastSaleAt"
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    ${filters.vendor || filters.category ? Prisma.sql`JOIN "Product" p ON p.id = v."productId"` : Prisma.empty}
    WHERE li."variantId" IS NOT NULL
      AND o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${lookbackFloor}
      AND o."orderCreatedAt" <= ${now}
      ${filters.channel ? Prisma.sql`AND o."channel" = ${filters.channel}` : Prisma.empty}
      ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
      ${filters.category ? Prisma.sql`AND p."productType" = ${filters.category}` : Prisma.empty}
    GROUP BY li."variantId"
  `);

  const result = new Map<string, AdaptiveVelocity>();
  for (const row of rows) {
    // shopifyCreatedAt inconnu (variante pas encore backfillée, voir
    // npm run backfill:variant-created-at) -> on suppose prudemment le
    // maximum plutôt que de sous-estimer une hypothétique variante récente.
    const ageDays = row.shopifyCreatedAt
      ? (now.getTime() - row.shopifyCreatedAt.getTime()) / 86_400_000
      : ADAPTIVE_MAX_LOOKBACK_DAYS;
    const effectiveWindowDays = Math.min(ADAPTIVE_MAX_LOOKBACK_DAYS, Math.max(1, ageDays));
    // Somme géométrique continue des poids sur la fenêtre effective — le
    // "nombre de jours équivalent" que représente la fenêtre pondérée,
    // pour ramener weightedUnits à une vitesse (unités/jour).
    const weightSum = (1 - Math.exp(-ADAPTIVE_DECAY_RATE * effectiveWindowDays)) / ADAPTIVE_DECAY_RATE;

    const daysSinceLastSale = (now.getTime() - row.lastSaleAt.getTime()) / 86_400_000;
    const confident = row.rawUnits >= MIN_CONFIDENT_UNITS && daysSinceLastSale <= MAX_DAYS_SINCE_LAST_SALE_FOR_CONFIDENCE;

    result.set(row.variantId, {
      velocityPerDay: row.weightedUnits / weightSum,
      unitsInWindow: row.rawUnits,
      effectiveWindowDays,
      confident,
    });
  }
  return result;
}
