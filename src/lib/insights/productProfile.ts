import { prisma } from "@/lib/db";
import { getStockOverview, type StockRow } from "./stockDays";
import { getAbcClassification, type AbcRow } from "./abc";
import { getAbcClassificationByMargin, type MarginAbcRow } from "./margin";
import { getDormantStock, type DormantRow } from "./dormant";
import { getReorderSuggestions, type ReorderRow } from "./reorder";

export type ProductProfile = {
  variantId: string;
  sku: string | null;
  title: string;
  productTitle: string;
  vendor: string | null;
  productType: string | null;
  isBlackMarket: boolean;
  price: number;
  compareAtPrice: number | null;
  cost: number | null;
  inventoryQuantity: number;
  stock: StockRow | null;
  abc: AbcRow | null;
  marginAbc: MarginAbcRow | null;
  dormant: DormantRow | null;
  reorder: ReorderRow | null;
};

/**
 * Vue "360°" d'une seule variante — répond à "il faut ouvrir 4-5 pages pour
 * tout savoir sur un SKU" (retour utilisateur 2026-07-17). Réutilise
 * volontairement les insights catalogue-entier déjà en place (`getStockOverview`,
 * `getAbcClassification`, `getAbcClassificationByMargin`, `getDormantStock`,
 * `getReorderSuggestions`) plutôt que d'écrire une seconde implémentation des
 * mêmes formules pour un seul variantId : le catalogue est petit (~150
 * variantes), le coût de calculer le catalogue entier pour n'en garder qu'une
 * ligne est négligeable comparé au risque de dérive entre deux calculs du
 * même chiffre (même principe que documenté ailleurs pour les seuils stock).
 */
export async function getProductProfile(variantId: string): Promise<ProductProfile | null> {
  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      sku: true,
      title: true,
      price: true,
      compareAtPrice: true,
      cost: true,
      inventoryQuantity: true,
      isBlackMarket: true,
      product: { select: { title: true, vendor: true, productType: true } },
    },
  });
  if (!variant) return null;

  const [stockRows, abcRows, marginAbc, dormantRows, reorderRows] = await Promise.all([
    getStockOverview(),
    getAbcClassification(90),
    getAbcClassificationByMargin(90),
    getDormantStock(),
    getReorderSuggestions({}),
  ]);

  return {
    variantId: variant.id,
    sku: variant.sku,
    title: variant.title,
    productTitle: variant.product.title,
    vendor: variant.product.vendor,
    productType: variant.product.productType,
    isBlackMarket: variant.isBlackMarket,
    price: Number(variant.price),
    compareAtPrice: variant.compareAtPrice !== null ? Number(variant.compareAtPrice) : null,
    cost: variant.cost !== null ? Number(variant.cost) : null,
    inventoryQuantity: variant.inventoryQuantity,
    stock: stockRows.find((r) => r.variantId === variantId) ?? null,
    abc: abcRows.find((r) => r.variantId === variantId) ?? null,
    marginAbc: marginAbc.rows.find((r) => r.variantId === variantId) ?? null,
    dormant: dormantRows.find((r) => r.variantId === variantId) ?? null,
    reorder: reorderRows.find((r) => r.variantId === variantId) ?? null,
  };
}
