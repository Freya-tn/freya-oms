import { prisma } from "@/lib/db";
import { getVelocityByVariant, getPriorVelocityByVariant, type VelocityResult } from "./velocity";
import { ANALYSIS_WINDOW_DAYS_MAX, ANALYSIS_WINDOW_DAYS_MIN } from "@/lib/filterParams";

// Fenêtre par défaut d'analyse (vitesse de vente / tendance) — réglable par
// l'utilisateur via `filters.windowDays` (slider sur la page Réappro,
// `?window=`, décision équipe 2026-07-18), cette constante n'est qu'un
// défaut, jamais figée en dur dans les calculs. Bornes : voir
// `ANALYSIS_WINDOW_DAYS_MIN`/`_MAX` dans `filterParams.ts`.
export const VELOCITY_WINDOW_DAYS = 30;

// Délai de sécurité global (temps fournisseur + marge de sécurité fusionnés
// en une seule hypothèse, décision équipe 2026-07-18 : distinguer les deux
// n'avait pas de sens tant qu'il n'y a pas de délai fournisseur réel en base
// par marque — voir docs/INSIGHTS.md, section 5). Pas de modèle Supplier
// pour l'instant, donc une hypothèse globale est utilisée en attendant
// d'avoir cette donnée par marque/fournisseur.
export const REORDER_SAFETY_DELAY_DAYS = 30;
// Une commande doit couvrir au moins 3 mois de vente (décision équipe 2026-07-16).
export const TARGET_COVERAGE_DAYS = 90;

// Seuils de variation de vitesse de vente pour qualifier une tendance.
const TREND_UP_RATIO = 1.2;
const TREND_DOWN_RATIO = 0.8;

export type ReorderUrgency = "critical" | "serious" | "warning" | "good";
export type DemandTrend = "up" | "down" | "stable" | "new" | "unknown";

export type ReorderRow = {
  variantId: string;
  sku: string | null;
  title: string;
  productTitle: string;
  vendor: string | null;
  /** Product.productType — affichage informatif seul (chip saisonnalité, voir docs/INSIGHTS.md), n'entre dans AUCUN calcul de cette fonction. */
  category: string | null;
  inventoryQuantity: number;
  velocityPerDay: number;
  trend: DemandTrend;
  reorderPoint: number;
  suggestedOrderQty: number;
  daysUntilStockout: number | null;
  urgency: ReorderUrgency;
};

function computeUrgency(inventoryQuantity: number, reorderPoint: number): ReorderUrgency {
  if (inventoryQuantity === 0) return "critical";
  if (inventoryQuantity <= reorderPoint * 0.5) return "serious";
  if (inventoryQuantity <= reorderPoint) return "warning";
  return "good";
}

/**
 * `prior` non fiable (absent ou moins d'un bloc complet de `windowDays` jours
 * de disponibilité réelle recensés) -> "unknown" plutôt que "new" : on ne
 * sait juste pas, ce n'est pas la même affirmation que "cette variante est
 * neuve et n'a jamais vendu avant". Décision équipe 2026-07-18.
 */
function computeTrend(current: number, prior: VelocityResult | undefined): DemandTrend {
  if (!prior || !prior.sufficientData) return "unknown";
  if (prior.velocityPerDay === 0) return current > 0 ? "new" : "unknown";
  const ratio = current / prior.velocityPerDay;
  if (ratio >= TREND_UP_RATIO) return "up";
  if (ratio <= TREND_DOWN_RATIO) return "down";
  return "stable";
}

export type ReorderSuggestionsResult = {
  rows: ReorderRow[];
  /**
   * Variantes exclues faute d'assez de jours de disponibilité réelle
   * recensés sur `windowDays` (voir `VelocityResult.sufficientData` dans
   * `velocity.ts`) — jamais incluses avec une vitesse extrapolée sur un
   * signal trop court. Décision équipe 2026-07-18 : mieux vaut ne rien
   * suggérer que de suggérer une quantité basée sur un signal peu fiable.
   */
  insufficientDataCount: number;
};

/**
 * Suggestions de réapprovisionnement : uniquement les variantes qui se
 * vendent réellement (velocity > 0) ET dont la vitesse est mesurée sur un
 * bloc complet de `windowDays` jours de disponibilité réelle (sinon exclues,
 * voir `insufficientDataCount`) — un produit dormant en rupture n'est pas
 * une urgence de rachat, c'est un problème de dormance (voir dormant.ts).
 * `trend` compare la vitesse du bloc de `windowDays` jours de disponibilité
 * réelle le plus récent à celle du bloc précédent (accélération/
 * décélération de la demande) — voir `getVelocityByVariant` dans
 * `velocity.ts` pour la méthodologie "jours de disponibilité réelle" (corrige
 * le bug du 2026-07-18 : un best-seller en rupture ne doit pas disparaître
 * des suggestions faute de ventes DANS la fenêtre calendaire, il faut
 * remonter jusqu'à sa dernière période de disponibilité réelle pour estimer
 * sa vraie vitesse).
 */
export async function getReorderSuggestionsDetailed(
  filters: { vendor?: string; targetCoverageDays?: number; windowDays?: number } = {},
): Promise<ReorderSuggestionsResult> {
  const targetCoverageDays = filters.targetCoverageDays ?? TARGET_COVERAGE_DAYS;
  const windowDays = Math.min(
    ANALYSIS_WINDOW_DAYS_MAX,
    Math.max(ANALYSIS_WINDOW_DAYS_MIN, filters.windowDays ?? VELOCITY_WINDOW_DAYS),
  );

  const [variants, velocity, priorVelocity] = await Promise.all([
    prisma.variant.findMany({
      where: filters.vendor ? { product: { vendor: filters.vendor } } : undefined,
      select: {
        id: true,
        sku: true,
        title: true,
        inventoryQuantity: true,
        product: { select: { title: true, vendor: true, productType: true } },
      },
    }),
    getVelocityByVariant(windowDays, { vendor: filters.vendor }),
    getPriorVelocityByVariant(windowDays, { vendor: filters.vendor }),
  ]);

  const rows: ReorderRow[] = [];
  let insufficientDataCount = 0;
  for (const variant of variants) {
    const velocity_ = velocity.get(variant.id);
    if (!velocity_ || !velocity_.sufficientData) {
      insufficientDataCount += 1;
      continue;
    }
    const velocityPerDay = velocity_.velocityPerDay;
    if (velocityPerDay <= 0) continue;

    const reorderPoint = velocityPerDay * REORDER_SAFETY_DELAY_DAYS;
    const suggestedOrderQty = Math.max(
      0,
      Math.round(velocityPerDay * targetCoverageDays - variant.inventoryQuantity),
    );
    const urgency = computeUrgency(variant.inventoryQuantity, reorderPoint);

    // Seules les variantes qui méritent une action (au ou sous le point de
    // commande) apparaissent — pas la totalité du catalogue vendable.
    if (urgency === "good") continue;

    rows.push({
      variantId: variant.id,
      sku: variant.sku,
      title: variant.title,
      productTitle: variant.product.title,
      vendor: variant.product.vendor,
      category: variant.product.productType,
      inventoryQuantity: variant.inventoryQuantity,
      velocityPerDay,
      trend: computeTrend(velocityPerDay, priorVelocity.get(variant.id)),
      reorderPoint,
      suggestedOrderQty,
      daysUntilStockout: variant.inventoryQuantity / velocityPerDay,
      urgency,
    });
  }

  const urgencyRank: Record<ReorderUrgency, number> = { critical: 0, serious: 1, warning: 2, good: 3 };
  rows.sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency] || a.daysUntilStockout! - b.daysUntilStockout!);
  return { rows, insufficientDataCount };
}

/** Voir `getReorderSuggestionsDetailed` — ne retourne que les lignes, pour les appelants qui n'ont pas besoin du compteur de données insuffisantes. */
export async function getReorderSuggestions(
  filters: { vendor?: string; targetCoverageDays?: number; windowDays?: number } = {},
): Promise<ReorderRow[]> {
  return (await getReorderSuggestionsDetailed(filters)).rows;
}

export type SupplierOrderSummary = {
  vendor: string;
  skuCount: number;
  totalSuggestedUnits: number;
  criticalCount: number;
};

/** Regroupe les suggestions de réappro par marque — vue "commande à passer par fournisseur" façon Assisty. */
export function groupReorderByVendor(rows: ReorderRow[]): SupplierOrderSummary[] {
  const byVendor = new Map<string, SupplierOrderSummary>();
  for (const row of rows) {
    const vendor = row.vendor ?? "Autre";
    const entry = byVendor.get(vendor) ?? { vendor, skuCount: 0, totalSuggestedUnits: 0, criticalCount: 0 };
    entry.skuCount += 1;
    entry.totalSuggestedUnits += row.suggestedOrderQty;
    if (row.urgency === "critical") entry.criticalCount += 1;
    byVendor.set(vendor, entry);
  }
  return [...byVendor.values()].sort((a, b) => b.totalSuggestedUnits - a.totalSuggestedUnits);
}
