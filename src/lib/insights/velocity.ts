import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { OrderChannel } from "@/generated/prisma/enums";

type VelocityFilters = { channel?: OrderChannel; vendor?: string; category?: string };

/**
 * Depuis combien de jours `InventorySnapshot` est alimenté (poll le plus
 * ancien connu, tous variantes confondues) — permet aux pages Dormants/
 * Réappro d'estimer quand assez de profondeur sera accumulée pour donner des
 * résultats fiables (voir `VelocityResult.sufficientData`). Reconstituer cet
 * historique rétroactivement n'est PAS possible : l'API Shopify n'expose que
 * le stock ACTUEL (`InventoryLevel`), pas d'historique interrogeable — voir
 * docs/INSIGHTS.md, section 1, "Pourquoi cet historique ne peut pas être
 * rattrapé depuis Shopify".
 */
export async function getInventoryHistoryDepthDays(): Promise<number> {
  const result = await prisma.inventorySnapshot.aggregate({ _min: { recordedAt: true } });
  if (!result._min.recordedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - result._min.recordedAt.getTime()) / 86_400_000));
}

// Jamais chercher de disponibilité plus vieille qu'un an — même borne que
// l'algo adaptatif de la page Stock (ADAPTIVE_MAX_LOOKBACK_DAYS), pour rester
// cohérent : au-delà, l'historique n'est plus représentatif de la demande
// actuelle.
const VELOCITY_MAX_LOOKBACK_DAYS = 365;

export type VelocityResult = {
  velocityPerDay: number;
  /** Nombre de jours de disponibilité réelle effectivement trouvés (≤ la taille du bloc demandé). */
  availableDays: number;
  /**
   * Faux si `availableDays` n'atteint pas la taille du bloc demandé — soit la
   * variante n'a tout simplement pas encore assez de recul (nouvelle, ou
   * jamais restée en stock aussi longtemps), soit `InventorySnapshot` n'a pas
   * encore accumulé assez de profondeur (ex: base fraîchement initialisée).
   * Décision équipe 2026-07-18 : dans les deux cas, ne JAMAIS présenter le
   * chiffre comme fiable — mieux vaut ne rien afficher que d'afficher une
   * vitesse extrapolée sur un signal trop court. Voir docs/INSIGHTS.md,
   * section 1.
   */
  sufficientData: boolean;
};

// Vitesse de vente (unités/jour) calculée sur les `rankEnd - rankStart + 1`
// derniers JOURS DE DISPONIBILITÉ RÉELLE d'une variante (pas des jours
// calendaires) — quitte à remonter jusqu'à un an en arrière pour les
// retrouver si la variante est en rupture depuis longtemps. Corrige un bug
// réel signalé le 2026-07-18 : diviser par la fenêtre calendaire complète
// dilue artificiellement la vitesse d'un produit qui vend bien mais a été
// en rupture une bonne partie de la période (best-seller réapprovisionné
// récemment, ou carrément en rupture depuis le début de la fenêtre) — ça le
// fait passer à tort pour "dormant" (dormant.ts) ou "sans vente" (exclu du
// réappro par reorder.ts, alors que c'est justement lui qu'il faut racheter).
//
// "Disponible" = au moins un poll de synchro (InventorySnapshot) ce jour-là
// avec quantity > 0 — un jour est compté en entier même si le stock s'est
// épuisé en cours de journée (poll horaire par défaut, pas de suivi
// infra-journalier plus fin, cohérent avec l'architecture "polling
// uniquement" du projet).
//
// `rankStart`/`rankEnd` sont 1-indexés et comptent les jours disponibles en
// partant du plus récent (rank 1 = dernier jour disponible connu). Ça permet
// à `getPriorVelocityByVariant` de désigner "le bloc de jours disponibles
// juste avant celui-ci", même si les deux blocs ne couvrent pas les mêmes
// dates calendaires selon les variantes.
async function velocityByAvailableDayRank(
  rankStart: number,
  rankEnd: number,
  filters: VelocityFilters,
): Promise<Map<string, VelocityResult>> {
  const blockSize = rankEnd - rankStart + 1;
  const now = new Date();
  const lookbackFloor = new Date(now.getTime() - VELOCITY_MAX_LOOKBACK_DAYS * 86_400_000);

  const rows = await prisma.$queryRaw<Array<{ variantId: string; units: number | null; availableDays: number }>>(
    Prisma.sql`
    WITH available_days AS (
      SELECT
        "variantId",
        day,
        ROW_NUMBER() OVER (PARTITION BY "variantId" ORDER BY day DESC) AS rn
      FROM (
        SELECT DISTINCT s."variantId", date_trunc('day', s."recordedAt") AS day
        FROM "InventorySnapshot" s
        JOIN "Variant" v ON v.id = s."variantId"
        ${filters.vendor || filters.category ? Prisma.sql`JOIN "Product" p ON p.id = v."productId"` : Prisma.empty}
        WHERE s.quantity > 0
          AND s."recordedAt" >= ${lookbackFloor}::timestamptz
          AND s."recordedAt" <= ${now}::timestamptz
          ${filters.vendor ? Prisma.sql`AND p.vendor = ${filters.vendor}` : Prisma.empty}
          ${filters.category ? Prisma.sql`AND p."productType" = ${filters.category}` : Prisma.empty}
      ) distinct_days
    ),
    selected_days AS (
      SELECT "variantId", day FROM available_days WHERE rn BETWEEN ${rankStart} AND ${rankEnd}
    ),
    day_counts AS (
      SELECT "variantId", COUNT(*)::int AS "availableDays" FROM selected_days GROUP BY "variantId"
    ),
    sales AS (
      SELECT sd."variantId", SUM(li.quantity)::float AS units
      FROM selected_days sd
      JOIN "OrderLineItem" li ON li."variantId" = sd."variantId"
      JOIN "Order" o ON o.id = li."orderId" AND date_trunc('day', o."orderCreatedAt") = sd.day
      WHERE o."isConfirmed" = true AND o."cancelledAt" IS NULL
        ${filters.channel ? Prisma.sql`AND o."channel" = ${filters.channel}` : Prisma.empty}
      GROUP BY sd."variantId"
    )
    SELECT dc."variantId" AS "variantId", COALESCE(s.units, 0) AS units, dc."availableDays" AS "availableDays"
    FROM day_counts dc
    LEFT JOIN sales s ON s."variantId" = dc."variantId"
  `,
  );

  const velocity = new Map<string, VelocityResult>();
  for (const row of rows) {
    if (row.availableDays <= 0) continue;
    velocity.set(row.variantId, {
      velocityPerDay: (row.units ?? 0) / row.availableDays,
      availableDays: row.availableDays,
      sufficientData: row.availableDays >= blockSize,
    });
  }
  return velocity;
}

/**
 * Vitesse de vente (unités/jour) par variante sur les `windowDays` derniers
 * jours de disponibilité réelle (pas une fenêtre calendaire fixe). Voir
 * docs/INSIGHTS.md, section 1, et le commentaire de `velocityByAvailableDayRank`
 * pour la justification complète. Une variante sans aucun jour de
 * disponibilité connu sur les 365 derniers jours (jamais en stock, ou
 * historique de snapshots pas encore assez profond) est absente de la Map ;
 * une variante présente mais avec `sufficientData: false` a moins de
 * `windowDays` jours de disponibilité réelle recensés (nouvelle variante, ou
 * historique `InventorySnapshot` encore trop récent) — l'appelant ne doit
 * JAMAIS traiter ces deux cas comme une vitesse fiable de 0.
 */
export async function getVelocityByVariant(
  windowDays: number,
  filters: VelocityFilters = {},
): Promise<Map<string, VelocityResult>> {
  return velocityByAvailableDayRank(1, windowDays, filters);
}

/**
 * Vitesse de vente sur le bloc de `windowDays` jours de disponibilité réelle
 * PRÉCÉDENT immédiatement celui de `getVelocityByVariant` (rangs
 * windowDays+1 à 2×windowDays) — sert à détecter une accélération/
 * décélération de la demande. Voir docs/INSIGHTS.md, section 5 (tendance).
 */
export async function getPriorVelocityByVariant(
  windowDays: number,
  filters: VelocityFilters = {},
): Promise<Map<string, VelocityResult>> {
  return velocityByAvailableDayRank(windowDays + 1, windowDays * 2, filters);
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
