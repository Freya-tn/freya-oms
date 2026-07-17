import { prisma } from "@/lib/db";
import { startSyncRun, finishSyncRun, failSyncRun } from "./syncRun";
import { forecastForScope, unitsAndRevenueInWindow, monthBounds } from "@/lib/insights/forecast";
import type { ForecastScope } from "@/generated/prisma/enums";
import { getCategoryList } from "@/lib/insights/filters";

function truncateToDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/**
 * Génère la prévision du mois courant ET du mois suivant, pour chaque scope
 * (GLOBAL + toutes les catégories, voir `getCategoryList`), et écrit une
 * ligne `SalesForecast` par scope/mois avec `generatedOn` = `asOf` tronqué au
 * jour. PAS un upsert au sens "on écrase l'historique" : la clé unique inclut
 * `generatedOn`, donc un run d'hier n'est JAMAIS retouché par un run
 * d'aujourd'hui — c'est bien ça qui permet à `getForecastAccuracy` de
 * mesurer la précision par délai. L'upsert Prisma ici ne sert qu'à rendre un
 * DEUXIÈME appel LE MÊME JOUR idempotent (ex: relance manuelle après un échec
 * réseau) plutôt que de planter sur la contrainte unique — ça ne réécrit
 * jamais un jour déjà passé.
 */
export async function generateDailyForecasts(asOf: Date = new Date()): Promise<number> {
  const generatedOn = truncateToDay(asOf);
  const categories = await getCategoryList();
  const scopes: Array<{ scope: ForecastScope; scopeKey: string }> = [
    { scope: "GLOBAL", scopeKey: "GLOBAL" },
    ...categories.map((category) => ({ scope: "CATEGORY" as const, scopeKey: category })),
  ];

  const currentMonth = { year: asOf.getUTCFullYear(), month: asOf.getUTCMonth() + 1 };
  const targets = [currentMonth, addMonths(currentMonth.year, currentMonth.month, 1)];

  let count = 0;
  for (const { scope, scopeKey } of scopes) {
    for (const target of targets) {
      const forecast = await forecastForScope(scope, scopeKey, target.year, target.month, asOf);
      const data = {
        predictedUnits: forecast.predictedUnits,
        predictedRevenue: forecast.predictedRevenue,
        baseUnitsRate: forecast.baseUnitsRate,
        seasonalIndex: forecast.seasonalIndex,
        seasonalTrusted: forecast.seasonalTrusted,
        growthFactor: forecast.growthFactor,
        growthTrusted: forecast.growthTrusted,
      };
      await prisma.salesForecast.upsert({
        where: {
          scope_scopeKey_targetYear_targetMonth_generatedOn: {
            scope,
            scopeKey,
            targetYear: target.year,
            targetMonth: target.month,
            generatedOn,
          },
        },
        create: { scope, scopeKey, targetYear: target.year, targetMonth: target.month, generatedOn, ...data },
        update: data,
      });
      count += 1;
    }
  }
  return count;
}

/**
 * Une fois un mois cible clos (dans le passé par rapport à `asOf`), calcule
 * les unités/CA RÉELS définitifs et les écrit sur TOUTES les lignes
 * `SalesForecast` de ce mois (tous les `generatedOn` confondus) — c'est ce
 * qui permet ensuite `getForecastAccuracy` de comparer, pour chaque délai de
 * prévision passé, le prédit au réel. Idempotent : ne retouche jamais une
 * ligne déjà réconciliée (`reconciledAt` non null).
 */
export async function reconcileClosedMonths(asOf: Date = new Date()): Promise<number> {
  const currentYear = asOf.getUTCFullYear();
  const currentMonth = asOf.getUTCMonth() + 1;

  const closedMonthKeys = await prisma.salesForecast.findMany({
    where: {
      reconciledAt: null,
      OR: [{ targetYear: { lt: currentYear } }, { targetYear: currentYear, targetMonth: { lt: currentMonth } }],
    },
    select: { scope: true, scopeKey: true, targetYear: true, targetMonth: true },
    distinct: ["scope", "scopeKey", "targetYear", "targetMonth"],
  });

  let reconciledCount = 0;
  for (const key of closedMonthKeys) {
    const { start, end } = monthBounds(key.targetYear, key.targetMonth);
    const actuals = await unitsAndRevenueInWindow(key.scope, key.scopeKey, start, end);
    const result = await prisma.salesForecast.updateMany({
      where: {
        scope: key.scope,
        scopeKey: key.scopeKey,
        targetYear: key.targetYear,
        targetMonth: key.targetMonth,
        reconciledAt: null,
      },
      data: { actualUnits: actuals.units, actualRevenue: actuals.revenue, reconciledAt: new Date() },
    });
    reconciledCount += result.count;
  }
  return reconciledCount;
}

/** Point d'entrée cron (voir `/api/cron/sync?resource=forecast`) : génère + réconcilie sous un seul `SyncRun`, même convention que `syncProducts`/`syncOrders`. */
export async function generateForecastSync(asOf: Date = new Date()): Promise<void> {
  const run = await startSyncRun("FORECAST");
  try {
    const generated = await generateDailyForecasts(asOf);
    const reconciled = await reconcileClosedMonths(asOf);
    await finishSyncRun(run.id, { recordsProcessed: generated + reconciled });
  } catch (error) {
    await failSyncRun(run.id, error);
    throw error;
  }
}
