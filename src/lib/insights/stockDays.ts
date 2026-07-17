import { prisma } from "@/lib/db";
import type { StockStatus } from "@/lib/filterParams";
import { getAdaptiveVelocityByVariant } from "./velocity";

export type StockRow = {
  variantId: string;
  sku: string | null;
  title: string;
  productTitle: string;
  vendor: string | null;
  inventoryQuantity: number;
  velocityPerDay: number | null;
  effectiveWindowDays: number | null;
  /** Faux si le signal de vente est trop pauvre pour extrapoler "jours restants" (voir velocity.ts) — même si velocityPerDay a une valeur. */
  velocityConfident: boolean;
  daysOfStock: number | null;
  estimatedStockoutDate: Date | null;
  sellThroughRate: number | null;
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
 * Vue "stock" complète : niveau actuel + vitesse de vente + jours restants
 * + date de rupture estimée + taux d'écoulement, pour toutes les variantes
 * (filtrable par marque et par catégorie). Vitesse de vente calculée par
 * `getAdaptiveVelocityByVariant` (voir velocity.ts) — pas de fenêtre fixe
 * choisie par l'utilisateur : l'algorithme s'adapte lui-même à l'ancienneté
 * de chaque variante et pondère les ventes récentes plus fort, voir
 * docs/INSIGHTS.md, section "Vitesse de vente adaptative (page Stock)".
 * Voir aussi section 2 pour les cas limites (velocity = 0, inventoryQuantity = 0).
 */
export async function getStockOverview(filters: { vendor?: string; category?: string } = {}): Promise<StockRow[]> {
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
    getAdaptiveVelocityByVariant({ vendor: filters.vendor, category: filters.category }),
  ]);

  return variants.map((variant) => {
    const adaptive = velocity.get(variant.id) ?? null;
    const velocityPerDay = adaptive?.velocityPerDay ?? null;
    // "jours restants" n'est extrapolé que si le signal est jugé fiable
    // (`confident`, voir velocity.ts) — sinon on préfère dire "on ne sait
    // pas" plutôt que d'afficher un nombre fabriqué à partir d'un historique
    // trop pauvre/trop ancien (ex réel du 2026-07-18 : "11896 jours" pour une
    // variante à 3 ventes au total, rien depuis 86 jours). `velocityPerDay`
    // reste affiché tel quel (contexte utile), seule l'extrapolation est gatée.
    const canEstimateStockout = adaptive !== null && adaptive.confident && velocityPerDay !== null && velocityPerDay > 0;

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

    // Taux d'écoulement = unités vendues (brutes, sur la fenêtre adaptative
    // de cette variante) / (unités vendues + stock restant) — classique en
    // gestion de stock : proche de 1 = ça tourne bien, proche de 0 = surstock
    // relatif à la demande. Volontairement PAS pondéré comme velocityPerDay
    // (formule simple, comparable à ce qui est documenté depuis le début).
    const unitsSold = adaptive?.unitsInWindow ?? 0;
    const sellThroughRate =
      unitsSold + variant.inventoryQuantity > 0 ? unitsSold / (unitsSold + variant.inventoryQuantity) : null;

    return {
      variantId: variant.id,
      sku: variant.sku,
      title: variant.title,
      productTitle: variant.product.title,
      vendor: variant.product.vendor,
      inventoryQuantity: variant.inventoryQuantity,
      velocityPerDay,
      effectiveWindowDays: adaptive?.effectiveWindowDays ?? null,
      velocityConfident: adaptive?.confident ?? false,
      daysOfStock,
      estimatedStockoutDate,
      sellThroughRate,
      status: computeStockStatus(variant.inventoryQuantity, daysOfStock),
    };
  });
}
