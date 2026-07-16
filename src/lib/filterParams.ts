// Utilitaires purs (aucun accès DB) pour parser les filtres URL — séparés de
// src/lib/insights/filters.ts (qui importe Prisma) pour rester safe à
// importer depuis un Client Component ("use client") comme FilterBar.tsx.
// Un Client Component qui importe, même indirectement, `@/lib/db` fait
// planter le bundle browser (pg a besoin de modules Node natifs).

export const PERIOD_OPTIONS = [7, 30, 60, 90, 180] as const;
export type PeriodDays = (typeof PERIOD_OPTIONS)[number];

/** Parse le paramètre `window` d'une URL (searchParams) en nombre de jours valide, avec repli. */
export function parsePeriodParam(value: string | undefined, fallback: PeriodDays): number {
  const parsed = Number(value);
  if (PERIOD_OPTIONS.includes(parsed as PeriodDays)) return parsed;
  return fallback;
}

/** Parse le paramètre `vendor` d'une URL — "all"/absent = pas de filtre. */
export function parseVendorParam(value: string | undefined): string | undefined {
  if (!value || value === "all") return undefined;
  return value;
}

/** Parse le paramètre `category` d'une URL (Product.productType) — "all"/absent = pas de filtre. */
export function parseCategoryParam(value: string | undefined): string | undefined {
  if (!value || value === "all") return undefined;
  return value;
}

// Statuts stock — mêmes seuils que ceux affichés dans StockTable (Chip par
// ligne), voir docs/INSIGHTS.md. Définis ici (fichier pur, sans Prisma) pour
// être la SEULE source de vérité, importée à la fois par l'insight serveur
// (src/lib/insights/stockDays.ts) et par les composants client
// (FilterBar/StockTable) — jamais deux listes de seuils qui pourraient dériver.
export const STOCK_STATUS_OPTIONS = [
  { value: "rupture", label: "Rupture" },
  { value: "critical", label: "Critique (< 7 j)" },
  { value: "low", label: "Faible (< 21 j)" },
  { value: "ok", label: "Ok" },
  { value: "unknown", label: "Pas de vente (30j)" },
] as const;

export type StockStatus = (typeof STOCK_STATUS_OPTIONS)[number]["value"];

/** Parse le paramètre `status` d'une URL — absent/valeur inconnue = pas de filtre. */
export function parseStockStatusParam(value: string | undefined): StockStatus | undefined {
  return STOCK_STATUS_OPTIONS.some((option) => option.value === value) ? (value as StockStatus) : undefined;
}

export const COVERAGE_DAYS_MIN = 30;
export const COVERAGE_DAYS_MAX = 180;

/** Parse le paramètre `coverage` (couverture cible réappro, en jours) — borné, avec repli. */
export function parseCoverageParam(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(COVERAGE_DAYS_MAX, Math.max(COVERAGE_DAYS_MIN, Math.round(parsed)));
}
