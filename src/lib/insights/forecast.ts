import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { ForecastScope } from "@/generated/prisma/enums";
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

const MIN_SEASONAL_OCCURRENCES = 3; // années complètes distinctes minimum pour faire confiance à l'indice d'un mois
const MIN_GROWTH_ORDERS = 3; // commandes distinctes minimum sur la fenêtre antérieure pour faire confiance au facteur de croissance
const GROWTH_WINDOW_DAYS = 90;
const GROWTH_CLAMP_MIN = 0.3;
const GROWTH_CLAMP_MAX = 3.0;
const AVG_PRICE_WINDOW_DAYS = 90;

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

// Unités : toujours par ligne de commande (Order n'a pas de total d'unités),
// join Variant obligatoire (même population que getAdaptiveVelocityByVariant,
// voir commentaire sur categoryJoin). CA : voir la branche ci-dessous — jamais
// la même formule pour GLOBAL et CATEGORY (voir docs/INSIGHTS.md, "CA :
// Order.subtotalPrice vs somme des lignes de commande").
/** Exportée pour generateForecasts.ts (réconciliation : units/revenue réels d'un mois clos). */
export async function unitsAndRevenueInWindow(
  scope: ForecastScope,
  scopeKey: string,
  since: Date,
  until: Date,
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
  `);
  const units = unitsRows[0]?.units ?? 0;

  if (scope === "GLOBAL") {
    // Sans filtre produit, `Order.subtotalPrice` est plus fidèle aux
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

  // CATEGORY : pas d'alternative à la somme par ligne (il faut le filtre
  // productType, qui n'existe qu'au niveau produit/ligne) — limite acceptée
  // et déjà documentée (légère sous-estimation des remises multi-produits).
  const revenueRows = await prisma.$queryRaw<Array<{ revenue: number | null }>>(Prisma.sql`
    SELECT SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE li."variantId" IS NOT NULL
      AND o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      AND o."orderCreatedAt" < ${until}
      AND p."productType" = ${scopeKey}
  `);
  return { units, revenue: revenueRows[0]?.revenue ?? 0 };
}

async function confirmedOrderCount(scope: ForecastScope, scopeKey: string, since: Date, until: Date): Promise<number> {
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
export async function getBaseUnitsRate(scope: ForecastScope, scopeKey: string, asOf: Date): Promise<number> {
  const velocity = await getAdaptiveVelocityByVariant(scope === "CATEGORY" ? { category: scopeKey } : {}, asOf);
  let total = 0;
  for (const v of velocity.values()) total += v.velocityPerDay;
  return total;
}

export type MonthlySeasonalIndex = {
  month: number; // 1-12
  /** 1.0 = mois moyen. Neutre (1.0) si `trusted` est faux. */
  index: number;
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
 * qu'un autre. Neutre (1.0) si moins de `MIN_SEASONAL_OCCURRENCES` années.
 */
export async function getSeasonalIndices(
  scope: ForecastScope,
  scopeKey: string,
  asOf: Date,
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
    return { month: i + 1, index: trusted ? rawIndex : 1, trusted, occurrences };
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
export async function getGrowthFactor(scope: ForecastScope, scopeKey: string, asOf: Date): Promise<GrowthFactorResult> {
  const currentWindow = { since: addDays(asOf, -GROWTH_WINDOW_DAYS), until: asOf };
  const priorWindow = { since: addDays(asOf, -(365 + GROWTH_WINDOW_DAYS)), until: addDays(asOf, -365) };

  const [current, prior, priorOrderCount] = await Promise.all([
    unitsAndRevenueInWindow(scope, scopeKey, currentWindow.since, currentWindow.until),
    unitsAndRevenueInWindow(scope, scopeKey, priorWindow.since, priorWindow.until),
    confirmedOrderCount(scope, scopeKey, priorWindow.since, priorWindow.until),
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
 * prix de vente moyen stable sur l'année — si le suivi de précision
 * (`getForecastAccuracy`) révèle un biais systématique un mois donné (ex:
 * soldes), c'est le premier point à revisiter.
 */
export async function getAvgSellingPrice(scope: ForecastScope, scopeKey: string, asOf: Date): Promise<AvgSellingPriceResult> {
  const since = addDays(asOf, -AVG_PRICE_WINDOW_DAYS);
  const { units, revenue } = await unitsAndRevenueInWindow(scope, scopeKey, since, asOf);
  if (units > 0) return { avgPrice: revenue / units, trusted: true };

  const fallback = await prisma.variant.aggregate({
    _avg: { price: true },
    where: scope === "CATEGORY" ? { product: { productType: scopeKey } } : undefined,
  });
  return { avgPrice: Number(fallback._avg.price ?? 0), trusted: false };
}

export type ForecastResult = {
  scope: ForecastScope;
  scopeKey: string;
  targetYear: number;
  targetMonth: number;
  predictedUnits: number;
  predictedRevenue: number;
  /** Unités/CA RÉELS déjà connus depuis le début du mois cible jusqu'à `asOf` (jamais ré-estimés). */
  actualUnitsToDate: number;
  actualRevenueToDate: number;
  /** Jours du mois cible déjà couverts par du réel / restants à extrapoler — pour rendre visible le mécanisme "de plus en plus précis". */
  daysElapsed: number;
  daysRemaining: number;
  daysInMonth: number;
  baseUnitsRate: number;
  seasonalIndex: number;
  seasonalTrusted: boolean;
  growthFactor: number;
  growthTrusted: boolean;
  avgSellingPriceTrusted: boolean;
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

  const [baseUnitsRate, seasonalIndices, growth, avgPrice, actuals] = await Promise.all([
    getBaseUnitsRate(scope, scopeKey, asOf),
    getSeasonalIndices(scope, scopeKey, asOf),
    getGrowthFactor(scope, scopeKey, asOf),
    getAvgSellingPrice(scope, scopeKey, asOf),
    unitsAndRevenueInWindow(scope, scopeKey, monthStart, actualsCutoff),
  ]);

  const seasonal = seasonalIndices[targetMonth - 1];
  const predictedUnitsRemaining = daysRemaining > 0 ? baseUnitsRate * daysRemaining * seasonal.index * growth.factor : 0;

  return {
    scope,
    scopeKey,
    targetYear,
    targetMonth,
    predictedUnits: actuals.units + predictedUnitsRemaining,
    predictedRevenue: actuals.revenue + predictedUnitsRemaining * avgPrice.avgPrice,
    actualUnitsToDate: actuals.units,
    actualRevenueToDate: actuals.revenue,
    daysElapsed,
    daysRemaining,
    daysInMonth,
    baseUnitsRate,
    seasonalIndex: seasonal.index,
    seasonalTrusted: seasonal.trusted,
    growthFactor: growth.factor,
    growthTrusted: growth.trusted,
    avgSellingPriceTrusted: avgPrice.trusted,
  };
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
