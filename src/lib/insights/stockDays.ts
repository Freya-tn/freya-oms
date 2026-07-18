import { prisma } from "@/lib/db";
import type { StockStatus } from "@/lib/filterParams";
import { ANALYSIS_WINDOW_DAYS_MAX, ANALYSIS_WINDOW_DAYS_MIN } from "@/lib/filterParams";
import { getVelocityByVariant } from "./velocity";

// Fenêtre par défaut d'analyse — identique à celle de Réappro (décision
// équipe 2026-07-18 : "je veux que Stock et Réappro soient iso, la logique
// de Réappro est la bonne"), réglable par l'utilisateur via `AnalysisWindowControl`
// (`?window=`), jamais figée en dur dans les calculs.
export const STOCK_VELOCITY_WINDOW_DAYS = 30;

export type StockRow = {
  variantId: string;
  sku: string | null;
  title: string;
  productTitle: string;
  vendor: string | null;
  inventoryQuantity: number;
  velocityPerDay: number | null;
  /** Jours de disponibilité réelle effectivement trouvés (≤ la fenêtre demandée) — voir velocity.ts. */
  availableDays: number | null;
  /** Faux si moins de `windowDays` jours de disponibilité réelle recensés (variante trop récente, ou historique InventorySnapshot pas encore assez profond) — voir velocity.ts. */
  sufficientData: boolean;
  daysOfStock: number | null;
  estimatedStockoutDate: Date | null;
  status: StockStatus;
};

/**
 * Statut synthétique dérivé de `inventoryQuantity`/`daysOfStock` — mêmes
 * seuils que les Chip déjà affichés dans StockTable, maintenant calculés une
 * seule fois ici (source de vérité unique, voir `STOCK_STATUS_OPTIONS` dans
 * `filterParams.ts`).
 */
function computeStockStatus(inventoryQuantity: number, daysOfStock: number | null): StockStatus {
  if (inventoryQuantity === 0) return "rupture";
  if (daysOfStock === null) return "unknown";
  if (daysOfStock < 7) return "critical";
  if (daysOfStock < 21) return "low";
  return "ok";
}

/**
 * Vue "stock" complète : niveau actuel + vitesse de vente + jours restants +
 * date de rupture estimée, pour toutes les variantes (filtrable par marque
 * et par catégorie). Vitesse de vente calculée par `getVelocityByVariant`
 * (voir velocity.ts) — **la même fonction que Réappro** (décision équipe
 * 2026-07-18, corrige un biais réel : l'ancien calcul adaptatif/pondéré
 * traitait les jours de RUPTURE comme des jours "sans demande", diluant la
 * vitesse d'un produit qui vendait bien juste avant d'être en rupture, comme
 * si la demande avait disparu). `windowDays` réglable par l'utilisateur via
 * le même slider que Réappro (`?window=`, `AnalysisWindowControl.tsx`).
 *
 * Compromis assumé (vérifié le 2026-07-18) : un produit plus jeune que
 * `windowDays` ne peut jamais atteindre `sufficientData: true` (il n'a
 * simplement pas encore assez de jours de disponibilité réelle à montrer),
 * contrairement à l'ancien calcul adaptatif qui bornait sa fenêtre à
 * l'ancienneté réelle du produit pour lui donner quand même une estimation.
 * Cohérent avec le principe déjà validé pour dormants/réappro ("soit on a
 * l'info fiable, soit on ne dit rien") plutôt qu'une exception pour Stock.
 */
export async function getStockOverview(
  filters: { vendor?: string; category?: string; windowDays?: number } = {},
): Promise<StockRow[]> {
  const windowDays = Math.min(
    ANALYSIS_WINDOW_DAYS_MAX,
    Math.max(ANALYSIS_WINDOW_DAYS_MIN, filters.windowDays ?? STOCK_VELOCITY_WINDOW_DAYS),
  );

  const [variants, velocity] = await Promise.all([
    prisma.variant.findMany({
      where:
        filters.vendor || filters.category
          ? {
              product: {
                ...(filters.vendor ? { vendor: filters.vendor } : {}),
                ...(filters.category ? { productType: filters.category } : {}),
              },
            }
          : undefined,
      select: {
        id: true,
        sku: true,
        title: true,
        inventoryQuantity: true,
        product: { select: { title: true, vendor: true } },
      },
      orderBy: { syncedAt: "desc" },
    }),
    getVelocityByVariant(windowDays, { vendor: filters.vendor, category: filters.category }),
  ]);

  return variants.map((variant) => {
    const result = velocity.get(variant.id) ?? null;
    const velocityPerDay = result?.velocityPerDay ?? null;
    // "jours restants" n'est extrapolé que si on a assez de jours de
    // disponibilité réelle recensés (`sufficientData`, voir velocity.ts) —
    // sinon on préfère dire "on ne sait pas" plutôt qu'un nombre fabriqué à
    // partir d'un historique trop court (même principe que dormants/réappro).
    const canEstimateStockout = result !== null && result.sufficientData && velocityPerDay !== null && velocityPerDay > 0;

    const daysOfStock =
      variant.inventoryQuantity === 0 ? 0 : canEstimateStockout ? variant.inventoryQuantity / velocityPerDay! : null;

    const estimatedStockoutDate =
      daysOfStock === null
        ? null
        : (() => {
            const date = new Date();
            date.setDate(date.getDate() + Math.floor(daysOfStock));
            return date;
          })();

    return {
      variantId: variant.id,
      sku: variant.sku,
      title: variant.title,
      productTitle: variant.product.title,
      vendor: variant.product.vendor,
      inventoryQuantity: variant.inventoryQuantity,
      velocityPerDay,
      availableDays: result?.availableDays ?? null,
      sufficientData: result?.sufficientData ?? false,
      daysOfStock,
      estimatedStockoutDate,
      status: computeStockStatus(variant.inventoryQuantity, daysOfStock),
    };
  });
}
