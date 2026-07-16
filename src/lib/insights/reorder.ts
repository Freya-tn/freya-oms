import { prisma } from "@/lib/db";
import { getVelocityByVariant, getPriorVelocityByVariant } from "./velocity";

const VELOCITY_WINDOW_DAYS = 30;

// Hypothèses globales v1 — voir docs/INSIGHTS.md, section 5. Pas de délai
// fournisseur réel en base (pas de modèle Supplier pour l'instant), donc un
// délai global est utilisé en attendant d'avoir cette donnée par marque/
// fournisseur. À ajuster avec l'équipe.
export const LEAD_TIME_DAYS = 14;
export const SAFETY_STOCK_DAYS = 7;
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

function computeTrend(current: number, prior: number): DemandTrend {
  if (prior === 0) return current > 0 ? "new" : "unknown";
  const ratio = current / prior;
  if (ratio >= TREND_UP_RATIO) return "up";
  if (ratio <= TREND_DOWN_RATIO) return "down";
  return "stable";
}

/**
 * Suggestions de réapprovisionnement : uniquement les variantes qui se
 * vendent réellement (velocity > 0) — un produit dormant en rupture n'est
 * pas une urgence de rachat, c'est un problème de dormance (voir dormant.ts).
 * `trend` compare la vitesse des 30 derniers jours à celle des 30 jours
 * précédents (accélération/décélération de la demande).
 */
export async function getReorderSuggestions(
  filters: { vendor?: string; targetCoverageDays?: number } = {},
): Promise<ReorderRow[]> {
  const targetCoverageDays = filters.targetCoverageDays ?? TARGET_COVERAGE_DAYS;

  const [variants, velocity, priorVelocity] = await Promise.all([
    prisma.variant.findMany({
      where: filters.vendor ? { product: { vendor: filters.vendor } } : undefined,
      select: {
        id: true,
        sku: true,
        title: true,
        inventoryQuantity: true,
        product: { select: { title: true, vendor: true } },
      },
    }),
    getVelocityByVariant(VELOCITY_WINDOW_DAYS, { vendor: filters.vendor }),
    getPriorVelocityByVariant(VELOCITY_WINDOW_DAYS, { vendor: filters.vendor }),
  ]);

  const rows: ReorderRow[] = [];
  for (const variant of variants) {
    const velocityPerDay = velocity.get(variant.id) ?? 0;
    if (velocityPerDay <= 0) continue;

    const reorderPoint = velocityPerDay * (LEAD_TIME_DAYS + SAFETY_STOCK_DAYS);
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
      inventoryQuantity: variant.inventoryQuantity,
      velocityPerDay,
      trend: computeTrend(velocityPerDay, priorVelocity.get(variant.id) ?? 0),
      reorderPoint,
      suggestedOrderQty,
      daysUntilStockout: variant.inventoryQuantity / velocityPerDay,
      urgency,
    });
  }

  const urgencyRank: Record<ReorderUrgency, number> = { critical: 0, serious: 1, warning: 2, good: 3 };
  return rows.sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency] || a.daysUntilStockout! - b.daysUntilStockout!);
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
