import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { ForecastScope } from "@/generated/prisma/enums";
import type { OrderChannel } from "@/generated/prisma/enums";
import { getAdaptiveVelocityByVariant } from "./velocity";

// Prévisions de ventes (page Prévisions) — voir docs/INSIGHTS.md, section
// "Prévisions de ventes", pour la justification complète de chaque choix
// ci-dessous. Résumé des principes qui ne sont pas évidents en lisant juste
// le code :
//
// 1. Toutes les fonctions acceptent `asOf` explicitement (jamais `new Date()`
//    interne) — indispensable pour BACKTESTER sur un mois déjà clos et
//    connu avant de brancher quoi que ce soit en cron/UI, et pour que
//    `getAdaptiveVelocityByVariant(filters, asOf)` (voir velocity.ts) ne
//    voie jamais de ventes postérieures à `asOf` (fuite de données).
// 2. Le taux de base par SKU (`getBaseUnitsRate`) est fiable individuellement
//    (EWMA adaptatif, déjà validé sur la page Stock) ; la saisonnalité et la
//    croissance, elles, n'ont de sens qu'agrégées (GLOBAL/CATEGORY) car un
//    SKU seul a souvent trop peu d'historique pour une saisonnalité propre.
// 3. Toujours en UNITÉS jusqu'à la toute fin — la conversion en TND
//    (`getAvgSellingPrice`) est le SEUL endroit qui suppose un prix de vente
//    moyen stable ; mélanger cette hypothèse dans les facteurs multiplicatifs
//    la ferait compter plusieurs fois.
// 4. Chaque garde-fou (`seasonalTrusted`, `growthTrusted`, `avgSellingPriceTrusted`)
//    retombe sur une valeur neutre plutôt que de fabriquer un chiffre precis
//    à partir d'un signal trop pauvre — même principe que `confident` dans
//    velocity.ts (voir l'incident réel "11896 jours restants" du 2026-07-18).
// 5. **Découpage B2B/B2C (2026-07-18)** : vérifié sur données réelles — B2B
//    est extrêmement irrégulier (0 unité vendue sur 5 des 12 mois calendaires
//    observés, pics ponctuels bruts les autres mois) alors que B2C vend en
//    continu tous les mois. Mélanger les deux dans un seul calcul de
//    saisonnalité/croissance fait porter la lumpiness de B2B sur le signal
//    B2C, qui est pourtant fiable. Chaque prévision (`forecastForScope`) est
//    donc calculée indépendamment par canal (`computeChannelForecast`) puis
//    sommée — jamais un seul calcul mélangeant les deux.
// 6. **Saisonnalité lissée par confiance, pas coupée net (2026-07-18)** :
//    l'ancien comportement retombait brutalement sur un indice neutre (1.0)
//    dès qu'il manquait ne serait-ce qu'UNE année sur les 3 requises — alors
//    que 2 années sur 3 restent un signal réel, juste moins certain qu'avec
//    3+. `getSeasonalIndices` rapproche maintenant l'indice de 1.0
//    proportionnellement au nombre d'années réellement observées
//    (`occurrences / MIN_SEASONAL_OCCURRENCES`), sans jamais dépasser
//    l'indice brut ni changer de comportement une fois le seuil de confiance
//    plein atteint (identique à l'ancien calcul quand `occurrences >= 3`).
// 7. **Pondération jour de semaine pour les jours restants (2026-07-18)** :
//    vérifié sur données réelles — jeudi représente 19,1% du volume total
//    contre 10,9%-11,9% le week-end, un écart réel d'environ ×1,7 entre le
//    meilleur et le pire jour. L'ancien calcul traitait chaque jour restant
//    du mois comme équivalent (`baseUnitsRate * daysRemaining`), ce qui biaise
//    l'extrapolation en fin de mois si les jours restants ne sont pas un
//    échantillon représentatif de la semaine (ex: il ne reste que des
//    week-ends). `getDayOfWeekIndices` calcule un indice par jour de semaine
//    (moyenne = 1.0), utilisé pour pondérer précisément chaque jour restant
//    plutôt qu'un simple compte de jours.

const MIN_SEASONAL_OCCURRENCES = 3; // années complètes distinctes pour une confiance PLEINE dans l'indice d'un mois (en dessous, l'indice est lissé vers 1.0, jamais coupé net — voir point 6 ci-dessus)
const MIN_GROWTH_ORDERS = 3; // commandes distinctes minimum sur la fenêtre antérieure pour faire confiance au facteur de croissance
const GROWTH_WINDOW_DAYS = 90;
const GROWTH_CLAMP_MIN = 0.3;
const GROWTH_CLAMP_MAX = 3.0;
const AVG_PRICE_WINDOW_DAYS = 90;
const MIN_DOW_ORDERS = 50; // commandes distinctes minimum sur la fenêtre pour faire confiance à la répartition par jour de semaine
const DOW_LOOKBACK_DAYS = 365;

const CHANNELS: OrderChannel[] = ["B2B", "B2C"];

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Bornes [début, fin exclue[ d'un mois calendaire — exportée pour generateForecasts.ts (réconciliation). */
export function monthBounds(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

// Jointure Variant TOUJOURS présente (même en scope GLOBAL) : les lignes de
// commande sans variante liée (produits exclus de l'outil, voir CLAUDE.md
// règle 8 / docs/DATABASE.md point 10) doivent être exclues ici pour rester
// sur EXACTEMENT la même population que `getAdaptiveVelocityByVariant`
// (baseUnitsRate) — sinon la saisonnalité/croissance serait calculée sur un
// ensemble de ventes différent de celui du taux de base, un biais silencieux.
function categoryJoin(scope: ForecastScope) {
  return scope === "CATEGORY" ? Prisma.sql`JOIN "Product" p ON p.id = v."productId"` : Prisma.empty;
}
function categoryWhere(scope: ForecastScope, scopeKey: string) {
  return scope === "CATEGORY" ? Prisma.sql`AND p."productType" = ${scopeKey}` : Prisma.empty;
}
function channelWhere(channel?: OrderChannel) {
  return channel ? Prisma.sql`AND o."channel" = ${channel}` : Prisma.empty;
}

// Unités : toujours par ligne de commande (Order n'a pas de total d'unités),
// join Variant obligatoire (même population que getAdaptiveVelocityByVariant,
// voir commentaire sur categoryJoin). CA : voir la branche ci-dessous — jamais
// la même formule pour GLOBAL et CATEGORY (voir docs/INSIGHTS.md, "CA :
// Order.subtotalPrice vs somme des lignes de commande"). Avec un filtre
// `channel`, toujours par ligne (même limite déjà documentée : Order.subtotalPrice
// est un total de COMMANDE, pas isolable par canal si jamais une commande
// mélangeait les deux — en pratique jamais le cas, `channel` est un attribut
// de commande entière, mais la règle de précision CA reste la même par cohérence).
/** Exportée pour generateForecasts.ts (réconciliation : units/revenue réels d'un mois clos). */
export async function unitsAndRevenueInWindow(
  scope: ForecastScope,
  scopeKey: string,
  since: Date,
  until: Date,
  channel?: OrderChannel,
): Promise<{ units: number; revenue: number }> {
  if (until <= since) return { units: 0, revenue: 0 };

  const unitsRows = await prisma.$queryRaw<Array<{ units: number | null }>>(Prisma.sql`
    SELECT SUM(li."quantity")::float AS units
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    ${categoryJoin(scope)}
    WHERE li."variantId" IS NOT NULL
      AND o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      AND o."orderCreatedAt" < ${until}
      ${categoryWhere(scope, scopeKey)}
      ${channelWhere(channel)}
  `);
  const units = unitsRows[0]?.units ?? 0;

  if (scope === "GLOBAL" && !channel) {
    // Sans filtre produit NI canal, `Order.subtotalPrice` est plus fidèle aux
    // rapports Shopify natifs qu'une somme par ligne : certaines remises
    // multi-produits (bundles/duos) ne sont pas allouées par Shopify au
    // niveau de la ligne, ce qui sous-estimerait le CA d'environ 12-20%
    // (vérifié en amont sur avril 2026 : ~23% d'écart) si on sommait les
    // lignes ici comme pour CATEGORY.
    const revenueRows = await prisma.$queryRaw<Array<{ revenue: number | null }>>(Prisma.sql`
      SELECT SUM(o."subtotalPrice")::float AS revenue
      FROM "Order" o
      WHERE o."isConfirmed" = true
        AND o."cancelledAt" IS NULL
        AND o."orderCreatedAt" >= ${since}
        AND o."orderCreatedAt" < ${until}
    `);
    return { units, revenue: revenueRows[0]?.revenue ?? 0 };
  }

  // CATEGORY et/ou filtre canal : pas d'alternative à la somme par ligne (il
  // faut le filtre productType/channel, qui n'existe qu'au niveau
  // produit/commande) — limite acceptée et déjà documentée (légère
  // sous-estimation des remises multi-produits).
  const revenueRows = await prisma.$queryRaw<Array<{ revenue: number | null }>>(Prisma.sql`
    SELECT SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    ${categoryJoin(scope)}
    WHERE li."variantId" IS NOT NULL
      AND o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      AND o."orderCreatedAt" < ${until}
      ${categoryWhere(scope, scopeKey)}
      ${channelWhere(channel)}
  `);
  return { units, revenue: revenueRows[0]?.revenue ?? 0 };
}

async function confirmedOrderCount(
  scope: ForecastScope,
  scopeKey: string,
  since: Date,
  until: Date,
  channel?: OrderChannel,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT o.id) AS count
    FROM "Order" o
    JOIN "OrderLineItem" li ON li."orderId" = o.id
    JOIN "Variant" v ON v.id = li."variantId"
    ${categoryJoin(scope)}
    WHERE li."variantId" IS NOT NULL
      AND o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      AND o."orderCreatedAt" < ${until}
      ${categoryWhere(scope, scopeKey)}
      ${channelWhere(channel)}
  `);
  return Number(rows[0]?.count ?? 0);
}

/**
 * Taux de base (unités/jour), agrégat de la vitesse adaptative de TOUTES les
 * variantes du scope — voir velocity.ts. Volontairement, on somme même les
 * variantes `confident: false` : ce garde-fou protège contre l'extrapolation
 * d'UNE variante individuelle à partir d'un signal pauvre (ex: "jours
 * restants"), pas contre l'agrégation de nombreux signaux individuellement
 * faibles, qui se lissent au contraire en s'additionnant.
 */
export async function getBaseUnitsRate(
  scope: ForecastScope,
  scopeKey: string,
  asOf: Date,
  channel?: OrderChannel,
): Promise<number> {
  const filters = scope === "CATEGORY" ? { category: scopeKey } : {};
  const velocity = await getAdaptiveVelocityByVariant(channel ? { ...filters, channel } : filters, asOf);
  let total = 0;
  for (const v of velocity.values()) total += v.velocityPerDay;
  return total;
}

export type MonthlySeasonalIndex = {
  month: number; // 1-12
  /** 1.0 = mois moyen. Lissé vers 1.0 proportionnellement à `occurrences` si `trusted` est faux (jamais coupé net, voir point 6 en tête de fichier). */
  index: number;
  /** Plein niveau de confiance (>= MIN_SEASONAL_OCCURRENCES années complètes). */
  trusted: boolean;
  /** Nombre d'années complètes distinctes ayant contribué à cet indice — toujours affiché, même quand trusted=false. */
  occurrences: number;
};

/**
 * Indice de saisonnalité par mois calendaire, calculé sur les années
 * COMPLÈTES disponibles (le mois de `asOf` et tout ce qui suit sont exclus
 * des deux côtés du calcul — un mois en cours n'est pas comparable à un mois
 * clos). `index[mois] = moyenne(unités de ce mois sur les années connues) /
 * moyenne(des 12 moyennes mensuelles)` — PAS une moyenne du total brut / nb
 * de mois, ce qui biaiserait le dénominateur si un mois a plus d'historique
 * qu'un autre. En dessous de `MIN_SEASONAL_OCCURRENCES` années, l'indice brut
 * est lissé vers 1.0 proportionnellement à `occurrences` (jamais coupé net à
 * 1.0 dès qu'il manque une seule année — voir point 6 en tête de fichier).
 */
export async function getSeasonalIndices(
  scope: ForecastScope,
  scopeKey: string,
  asOf: Date,
  channel?: OrderChannel,
): Promise<MonthlySeasonalIndex[]> {
  const cutoff = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));

  const rows = await prisma.$queryRaw<Array<{ year: number; month: number; units: number }>>(Prisma.sql`
    SELECT
      EXTRACT(YEAR FROM o."orderCreatedAt")::int AS year,
      EXTRACT(MONTH FROM o."orderCreatedAt")::int AS month,
      SUM(li."quantity")::float AS units
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    ${categoryJoin(scope)}
    WHERE li."variantId" IS NOT NULL
      AND o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" < ${cutoff}
      ${categoryWhere(scope, scopeKey)}
      ${channelWhere(channel)}
    GROUP BY 1, 2
  `);

  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  for (const row of rows) byMonth[row.month - 1].push(row.units);

  const monthlyAverages = byMonth.map((units) => (units.length > 0 ? units.reduce((s, u) => s + u, 0) / units.length : null));
  const knownAverages = monthlyAverages.filter((a): a is number => a !== null);
  const baseline = knownAverages.length > 0 ? knownAverages.reduce((s, a) => s + a, 0) / knownAverages.length : null;

  return monthlyAverages.map((avg, i) => {
    const occurrences = byMonth[i].length;
    const trusted = occurrences >= MIN_SEASONAL_OCCURRENCES;
    const rawIndex = avg !== null && baseline !== null && baseline > 0 ? avg / baseline : 1;
    // Confiance proportionnelle : identique au comportement précédent une
    // fois le seuil plein atteint (confidence=1 => index=rawIndex), mais
    // n'écrase plus le signal à 1.0 dès qu'il manque une seule année.
    const confidence = Math.min(1, occurrences / MIN_SEASONAL_OCCURRENCES);
    const blendedIndex = 1 + confidence * (rawIndex - 1);
    return { month: i + 1, index: blendedIndex, trusted, occurrences };
  });
}

export type GrowthFactorResult = { factor: number; trusted: boolean };

/**
 * Facteur de croissance = ratio unités des `GROWTH_WINDOW_DAYS` derniers
 * jours vs la même fenêtre un an plus tôt. Volontairement PAS de repli sur
 * une croissance mois-sur-mois : ça compterait deux fois le même signal
 * ~30-60j déjà capté par l'EWMA de `getBaseUnitsRate`. Neutre (1.0, non
 * fiable) si la fenêtre antérieure a moins de `MIN_GROWTH_ORDERS` commandes
 * distinctes ou aucune unité (rien à comparer). Toujours borné à
 * [GROWTH_CLAMP_MIN, GROWTH_CLAMP_MAX] par sécurité, même quand fiable — un
 * pic ponctuel ne doit jamais démultiplier une prévision par 10.
 */
export async function getGrowthFactor(
  scope: ForecastScope,
  scopeKey: string,
  asOf: Date,
  channel?: OrderChannel,
): Promise<GrowthFactorResult> {
  const currentWindow = { since: addDays(asOf, -GROWTH_WINDOW_DAYS), until: asOf };
  const priorWindow = { since: addDays(asOf, -(365 + GROWTH_WINDOW_DAYS)), until: addDays(asOf, -365) };

  const [current, prior, priorOrderCount] = await Promise.all([
    unitsAndRevenueInWindow(scope, scopeKey, currentWindow.since, currentWindow.until, channel),
    unitsAndRevenueInWindow(scope, scopeKey, priorWindow.since, priorWindow.until, channel),
    confirmedOrderCount(scope, scopeKey, priorWindow.since, priorWindow.until, channel),
  ]);

  if (priorOrderCount < MIN_GROWTH_ORDERS || prior.units <= 0) {
    return { factor: 1, trusted: false };
  }
  const rawFactor = current.units / prior.units;
  return { factor: Math.min(GROWTH_CLAMP_MAX, Math.max(GROWTH_CLAMP_MIN, rawFactor)), trusted: true };
}

export type AvgSellingPriceResult = { avgPrice: number; trusted: boolean };

/**
 * Prix de vente moyen (TND/unité), calculé UNE SEULE FOIS, à la toute fin de
 * la conversion unités -> CA (jamais mélangé dans `seasonalIndex`/`growthFactor`,
 * pour ne pas empiler l'hypothèse "prix stable" plusieurs fois). Sur les
 * `AVG_PRICE_WINDOW_DAYS` derniers jours de vraies ventes ; repli sur le prix
 * catalogue moyen (`Variant.price`) si aucune vente récente dans ce scope
 * (jamais une division par zéro silencieuse). Limite v1 assumée : suppose un
 * prix de vente moyen stable sur l'année - si le suivi de précision
 * (`getForecastAccuracy`) révèle un biais systématique un mois donné (ex:
 * soldes), c'est le premier point à revisiter. Le prix catalogue de repli
 * n'est jamais filtré par canal (pas de tarification distincte B2B/B2C
 * modélisée ici).
 */
export async function getAvgSellingPrice(
  scope: ForecastScope,
  scopeKey: string,
  asOf: Date,
  channel?: OrderChannel,
): Promise<AvgSellingPriceResult> {
  const since = addDays(asOf, -AVG_PRICE_WINDOW_DAYS);
  const { units, revenue } = await unitsAndRevenueInWindow(scope, scopeKey, since, asOf, channel);
  if (units > 0) return { avgPrice: revenue / units, trusted: true };

  const fallback = await prisma.variant.aggregate({
    _avg: { price: true },
    where: scope === "CATEGORY" ? { product: { productType: scopeKey } } : undefined,
  });
  return { avgPrice: Number(fallback._avg.price ?? 0), trusted: false };
}

export type DayOfWeekIndices = {
  /** Indice par jour de semaine, index[0] = dimanche ... index[6] = samedi. 1.0 = jour moyen. */
  index: number[];
  trusted: boolean;
  totalOrders: number;
};

/**
 * Répartition des ventes par jour de semaine sur les `DOW_LOOKBACK_DAYS`
 * derniers jours — sert à pondérer précisément les jours restants du mois
 * cible plutôt que de les traiter comme équivalents (voir point 7 en tête de
 * fichier : jeudi vend ~19% du volume contre ~11-12% le week-end, vérifié sur
 * données réelles). Neutre (tous les indices à 1.0, `trusted: false`) si
 * moins de `MIN_DOW_ORDERS` commandes distinctes sur la fenêtre - le
 * fallback revient alors exactement à l'ancien comportement (jours comptés
 * à parts égales), jamais une extrapolation moins précise qu'avant.
 */
export async function getDayOfWeekIndices(
  scope: ForecastScope,
  scopeKey: string,
  asOf: Date,
  channel?: OrderChannel,
): Promise<DayOfWeekIndices> {
  const since = addDays(asOf, -DOW_LOOKBACK_DAYS);

  const [rows, totalOrders] = await Promise.all([
    prisma.$queryRaw<Array<{ dow: number; units: number }>>(Prisma.sql`
      SELECT EXTRACT(DOW FROM o."orderCreatedAt")::int AS dow, SUM(li."quantity")::float AS units
      FROM "OrderLineItem" li
      JOIN "Order" o ON o.id = li."orderId"
      JOIN "Variant" v ON v.id = li."variantId"
      ${categoryJoin(scope)}
      WHERE li."variantId" IS NOT NULL
        AND o."isConfirmed" = true
        AND o."cancelledAt" IS NULL
        AND o."orderCreatedAt" >= ${since}
        AND o."orderCreatedAt" < ${asOf}
        ${categoryWhere(scope, scopeKey)}
        ${channelWhere(channel)}
      GROUP BY 1
    `),
    confirmedOrderCount(scope, scopeKey, since, asOf, channel),
  ]);

  // Nombre réel de dates de chaque jour de semaine dans la fenêtre (proche de
  // 52 mais pas exactement égal selon l'alignement calendaire) - normalise
  // correctement plutôt que de supposer 7 jours égaux.
  const dowDateCounts = [0, 0, 0, 0, 0, 0, 0];
  for (let cursor = since; cursor < asOf; cursor = addDays(cursor, 1)) {
    dowDateCounts[cursor.getUTCDay()] += 1;
  }

  const unitsByDow = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) unitsByDow[row.dow] = row.units;

  const totalUnits = unitsByDow.reduce((s, u) => s + u, 0);
  const totalDays = dowDateCounts.reduce((s, c) => s + c, 0);
  const avgUnitsPerDay = totalDays > 0 ? totalUnits / totalDays : 0;

  const index = unitsByDow.map((units, dow) => {
    if (avgUnitsPerDay <= 0 || dowDateCounts[dow] === 0) return 1;
    return units / dowDateCounts[dow] / avgUnitsPerDay;
  });

  return { index, trusted: totalOrders >= MIN_DOW_ORDERS, totalOrders };
}

/** Somme des indices jour-de-semaine sur chaque jour calendaire de [from, to[ — remplace un simple compte de jours par une extrapolation pondérée. Repli sur un compte de jours brut (poids 1 chacun) si `dowIndex` est `null` (signal jour de semaine non fiable). */
function weightedDayCount(from: Date, to: Date, dowIndex: number[] | null): number {
  if (!dowIndex) return Math.max(0, (to.getTime() - from.getTime()) / 86_400_000);
  let total = 0;
  for (let cursor = from; cursor < to; cursor = addDays(cursor, 1)) total += dowIndex[cursor.getUTCDay()];
  return total;
}

export type ChannelForecastDetail = {
  predictedUnits: number;
  predictedRevenue: number;
  actualUnitsToDate: number;
  actualRevenueToDate: number;
  baseUnitsRate: number;
  seasonalIndex: number;
  seasonalTrusted: boolean;
  seasonalOccurrences: number;
  growthFactor: number;
  growthTrusted: boolean;
  avgSellingPriceTrusted: boolean;
  dowTrusted: boolean;
};

/** Cœur du calcul pour UN canal (B2B ou B2C) — voir `forecastForScope` qui appelle ceci pour les deux et somme le résultat. */
async function computeChannelForecast(
  scope: ForecastScope,
  scopeKey: string,
  channel: OrderChannel,
  targetMonth: number,
  monthStart: Date,
  actualsCutoff: Date,
  monthEnd: Date,
  daysRemaining: number,
  asOf: Date,
): Promise<ChannelForecastDetail> {
  const [baseUnitsRate, seasonalIndices, growth, avgPrice, actuals, dow] = await Promise.all([
    getBaseUnitsRate(scope, scopeKey, asOf, channel),
    getSeasonalIndices(scope, scopeKey, asOf, channel),
    getGrowthFactor(scope, scopeKey, asOf, channel),
    getAvgSellingPrice(scope, scopeKey, asOf, channel),
    unitsAndRevenueInWindow(scope, scopeKey, monthStart, actualsCutoff, channel),
    getDayOfWeekIndices(scope, scopeKey, asOf, channel),
  ]);

  const seasonal = seasonalIndices[targetMonth - 1];
  const weightedRemaining = daysRemaining > 0 ? weightedDayCount(actualsCutoff, monthEnd, dow.trusted ? dow.index : null) : 0;
  const predictedUnitsRemaining = weightedRemaining * baseUnitsRate * seasonal.index * growth.factor;

  return {
    predictedUnits: actuals.units + predictedUnitsRemaining,
    predictedRevenue: actuals.revenue + predictedUnitsRemaining * avgPrice.avgPrice,
    actualUnitsToDate: actuals.units,
    actualRevenueToDate: actuals.revenue,
    baseUnitsRate,
    seasonalIndex: seasonal.index,
    seasonalTrusted: seasonal.trusted,
    seasonalOccurrences: seasonal.occurrences,
    growthFactor: growth.factor,
    growthTrusted: growth.trusted,
    avgSellingPriceTrusted: avgPrice.trusted,
    dowTrusted: dow.trusted,
  };
}

export type ForecastResult = {
  scope: ForecastScope;
  scopeKey: string;
  targetYear: number;
  targetMonth: number;
  /** Somme B2B + B2C — voir `byChannel` pour le détail par canal. */
  predictedUnits: number;
  predictedRevenue: number;
  actualUnitsToDate: number;
  actualRevenueToDate: number;
  /** Jours du mois cible déjà couverts par du réel / restants à extrapoler — pour rendre visible le mécanisme "de plus en plus précis". */
  daysElapsed: number;
  daysRemaining: number;
  daysInMonth: number;
  /** Vue d'ensemble simplifiée (moyenne pondérée par le taux de base de chaque canal) — pour affichage résumé (table, chips). Le détail fiable par canal est dans `byChannel`. */
  baseUnitsRate: number;
  seasonalIndex: number;
  seasonalTrusted: boolean;
  growthFactor: number;
  growthTrusted: boolean;
  avgSellingPriceTrusted: boolean;
  byChannel: Record<OrderChannel, ChannelForecastDetail>;
};

/**
 * Cœur du moteur : prévision du mois `targetYear`/`targetMonth`, vue depuis
 * `asOf`. Mécanisme qui rend la prévision "de plus en plus précise" au fil du
 * mois : la part RÉELLE (déjà vendue, jamais ré-estimée) grandit jour après
 * jour, la part EXTRAPOLÉE (le reste du mois) rétrécit mécaniquement en
 * conséquence — ce n'est pas un ajustement artificiel, juste moins de jours
 * à prévoir. `asOf` par défaut = maintenant ; un `asOf` explicite dans le
 * passé permet de BACKTESTER sur un mois déjà clos et connu (voir
 * docs/INSIGHTS.md, section "Prévisions de ventes", pour la procédure).
 *
 * Calculée indépendamment par canal (B2B/B2C, voir point 5 en tête de
 * fichier) puis sommée — jamais un seul calcul mélangeant les deux, pour ne
 * pas laisser la lumpiness de B2B polluer le signal B2C, bien plus régulier.
 */
export async function forecastForScope(
  scope: ForecastScope,
  scopeKey: string,
  targetYear: number,
  targetMonth: number,
  asOf: Date = new Date(),
): Promise<ForecastResult> {
  const { start: monthStart, end: monthEnd } = monthBounds(targetYear, targetMonth);
  const actualsCutoff = asOf < monthStart ? monthStart : asOf > monthEnd ? monthEnd : asOf;
  const daysInMonth = (monthEnd.getTime() - monthStart.getTime()) / 86_400_000;
  const daysElapsed = (actualsCutoff.getTime() - monthStart.getTime()) / 86_400_000;
  const daysRemaining = daysInMonth - daysElapsed;

  const [b2b, b2c] = await Promise.all(
    CHANNELS.map((channel) =>
      computeChannelForecast(scope, scopeKey, channel, targetMonth, monthStart, actualsCutoff, monthEnd, daysRemaining, asOf),
    ),
  );
  const byChannel: Record<OrderChannel, ChannelForecastDetail> = { B2B: b2b, B2C: b2c };

  const totalBaseRate = b2b.baseUnitsRate + b2c.baseUnitsRate;
  const weight = (detail: ChannelForecastDetail) => (totalBaseRate > 0 ? detail.baseUnitsRate / totalBaseRate : 0.5);

  return {
    scope,
    scopeKey,
    targetYear,
    targetMonth,
    predictedUnits: b2b.predictedUnits + b2c.predictedUnits,
    predictedRevenue: b2b.predictedRevenue + b2c.predictedRevenue,
    actualUnitsToDate: b2b.actualUnitsToDate + b2c.actualUnitsToDate,
    actualRevenueToDate: b2b.actualRevenueToDate + b2c.actualRevenueToDate,
    daysElapsed,
    daysRemaining,
    daysInMonth,
    baseUnitsRate: totalBaseRate,
    seasonalIndex: weight(b2b) * b2b.seasonalIndex + weight(b2c) * b2c.seasonalIndex,
    // Conservateur : la vue résumée n'affiche "fiable" que si les DEUX canaux
    // le sont, jamais juste le plus gros des deux - le détail par canal
    // (byChannel) montre la vérité individuelle indépendamment de ça.
    seasonalTrusted: b2b.seasonalTrusted && b2c.seasonalTrusted,
    growthFactor: weight(b2b) * b2b.growthFactor + weight(b2c) * b2c.growthFactor,
    growthTrusted: b2b.growthTrusted && b2c.growthTrusted,
    avgSellingPriceTrusted: b2b.avgSellingPriceTrusted && b2c.avgSellingPriceTrusted,
    byChannel,
  };
}

export type ScopeForecastRow = {
  scope: ForecastScope;
  scopeKey: string;
  label: string;
  current: ForecastResult;
  next: ForecastResult;
};

/**
 * Prévision GLOBAL + par CATÉGORIE, mois en cours et mois prochain, en un
 * seul appel — la vue d'ensemble complète du catalogue (retour utilisateur
 * 2026-07-18 : "je veux plus qu'une estimation, quelque chose de puissant").
 * Chaque ligne réutilise `forecastForScope` tel quel (aucune formule
 * dupliquée) ; volontairement pas optimisé pour éviter les recalculs
 * redondants entre mois (même principe que `productProfile.ts` : catalogue
 * restreint, ~10 catégories, la clarté d'une implémentation unique prime sur
 * la micro-performance).
 */
export async function forecastAllScopes(categories: string[], asOf: Date = new Date()): Promise<ScopeForecastRow[]> {
  const currentYear = asOf.getUTCFullYear();
  const currentMonth = asOf.getUTCMonth() + 1;
  const nextMonthDate = new Date(Date.UTC(currentYear, currentMonth, 1));
  const nextYear = nextMonthDate.getUTCFullYear();
  const nextMonth = nextMonthDate.getUTCMonth() + 1;

  const scopes: Array<{ scope: ForecastScope; scopeKey: string; label: string }> = [
    { scope: "GLOBAL", scopeKey: "GLOBAL", label: "Global (toutes catégories)" },
    ...categories.map((category) => ({ scope: "CATEGORY" as const, scopeKey: category, label: category })),
  ];

  return Promise.all(
    scopes.map(async ({ scope, scopeKey, label }) => {
      const [current, next] = await Promise.all([
        forecastForScope(scope, scopeKey, currentYear, currentMonth, asOf),
        forecastForScope(scope, scopeKey, nextYear, nextMonth, asOf),
      ]);
      return { scope, scopeKey, label, current, next };
    }),
  );
}

export type ForecastAccuracyPoint = {
  /** Nombre de jours entre la génération de la prévision et la fin du mois cible — 0 = prévision faite le dernier jour du mois, ~30 = faite en début de mois. */
  leadTimeDays: number;
  /** Erreur absolue moyenne en % (MAPE) des prévisions à ce délai, sur les mois déjà réconciliés. */
  mape: number;
  sampleSize: number;
};

/**
 * Erreur de prévision (MAPE) par délai — LA preuve concrète que l'algorithme
 * devient plus précis à mesure qu'on approche de la fin du mois (délai qui
 * diminue). Lit uniquement les lignes déjà réconciliées (voir
 * generateForecasts.ts, `reconcileClosedMonths`). Les mois à 0 unité réelle
 * sont exclus (division par zéro sur le MAPE) — n'arrive jamais en pratique
 * sur ce catalogue, mais documenté plutôt que silencieusement dangereux.
 */
export async function getForecastAccuracy(scope: ForecastScope, scopeKey: string): Promise<ForecastAccuracyPoint[]> {
  const rows = await prisma.salesForecast.findMany({
    where: { scope, scopeKey, reconciledAt: { not: null }, actualUnits: { not: null } },
    select: { targetYear: true, targetMonth: true, generatedOn: true, predictedUnits: true, actualUnits: true },
  });

  const byLeadTime = new Map<number, { errorSum: number; count: number }>();
  for (const row of rows) {
    if (row.actualUnits === null || row.actualUnits === 0) continue;
    const { end } = monthBounds(row.targetYear, row.targetMonth);
    const leadTimeDays = Math.round((end.getTime() - row.generatedOn.getTime()) / 86_400_000);
    const error = Math.abs(row.predictedUnits - row.actualUnits) / row.actualUnits;
    const entry = byLeadTime.get(leadTimeDays) ?? { errorSum: 0, count: 0 };
    entry.errorSum += error;
    entry.count += 1;
    byLeadTime.set(leadTimeDays, entry);
  }

  return [...byLeadTime.entries()]
    .map(([leadTimeDays, { errorSum, count }]) => ({ leadTimeDays, mape: errorSum / count, sampleSize: count }))
    .sort((a, b) => a.leadTimeDays - b.leadTimeDays);
}
