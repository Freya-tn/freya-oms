import { prisma } from "@/lib/db";
import type { StockStatus } from "@/lib/filterParams";
import { getVelocityByVariant } from "./velocity";

const VELOCITY_WINDOW_DAYS = 30;

export type StockRow = {
  variantId: string;
  sku: string | null;
  title: string;
  productTitle: string;
  vendor: string | null;
  inventoryQuantity: number;
  velocityPerDay: number | null;
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
 * (filtrable par marque et par catégorie). Voir docs/INSIGHTS.md, section 2,
 * pour les cas limites (velocity = 0, inventoryQuantity = 0).
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
    getVelocityByVariant(VELOCITY_WINDOW_DAYS, { vendor: filters.vendor, category: filters.category }),
  ]);

  return variants.map((variant) => {
    const velocityPerDay = velocity.get(variant.id) ?? null;
    const hasVelocity = velocityPerDay !== null && velocityPerDay > 0;

    const daysOfStock =
      variant.inventoryQuantity === 0 ? 0 : hasVelocity ? variant.inventoryQuantity / velocityPerDay! : null;

    const estimatedStockoutDate =
      daysOfStock === null
        ? null
        : (() => {
            const date = new Date();
            date.setDate(date.getDate() + Math.floor(daysOfStock));
            return date;
          })();

    // Taux d'écoulement = unités vendues / (unités vendues + stock restant) —
    // classique en gestion de stock : proche de 1 = ça tourne bien, proche de
    // 0 = surstock relatif à la demande.
    const unitsSold = hasVelocity ? velocityPerDay! * VELOCITY_WINDOW_DAYS : 0;
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
      daysOfStock,
      estimatedStockoutDate,
      sellThroughRate,
      status: computeStockStatus(variant.inventoryQuantity, daysOfStock),
    };
  });
}
