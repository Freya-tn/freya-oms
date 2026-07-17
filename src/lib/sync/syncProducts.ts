import { prisma } from "@/lib/db";
import { gidToBigInt, shopifyGraphQL } from "@/lib/shopify/client";
import { runBulkQuery } from "@/lib/shopify/bulkOperations";
import {
  buildProductsBulkQuery,
  PRODUCTS_PAGE_QUERY,
  INVENTORY_ITEMS_PAGE_QUERY,
  withExclusionFilter,
  isExcludedProduct,
  type BulkProductsLine,
  type ShopifyProductNode,
  type ShopifyVariantNode,
  type ShopifyInventoryItemNode,
} from "@/lib/shopify/queries/products";
import { startSyncRun, finishSyncRun, failSyncRun, getLastSuccessfulSync } from "./syncRun";
import { deriveIsBlackMarket } from "@/lib/shopify/deriveVariantFields";

type ProductWithVariants = { product: ShopifyProductNode; variants: ShopifyVariantNode[] };

async function fetchViaBulk(filter?: string): Promise<ProductWithVariants[]> {
  const lines = await runBulkQuery<BulkProductsLine>(buildProductsBulkQuery(filter));

  const productsById = new Map<string, ProductWithVariants>();
  for (const line of lines) {
    if (line.__parentId === undefined) {
      productsById.set(line.id, { product: line, variants: [] });
    }
  }
  for (const line of lines) {
    if (line.__parentId !== undefined) {
      const parent = productsById.get(line.__parentId);
      parent?.variants.push(line);
    }
  }
  return [...productsById.values()];
}

async function fetchViaPagination(filter?: string): Promise<ProductWithVariants[]> {
  const results: ProductWithVariants[] = [];
  let after: string | null = null;

  while (true) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ node: ShopifyProductNode & { variants: { edges: Array<{ node: ShopifyVariantNode }> } } }>;
      };
    } = await shopifyGraphQL(PRODUCTS_PAGE_QUERY, { first: 250, after, query: filter ?? null });

    for (const edge of data.products.edges) {
      const { variants, ...product } = edge.node;
      results.push({ product, variants: variants.edges.map((e) => e.node) });
    }

    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }

  return results;
}

/**
 * Rattrape les changements de coût (`InventoryItem.unitCost`) qu'un simple
 * poll produits ne peut jamais voir — voir le commentaire sur
 * `INVENTORY_ITEMS_PAGE_QUERY` dans queries/products.ts et
 * docs/SHOPIFY_SYNC.md. Uniquement pour les polls incrémentaux : le premier
 * sync (Bulk Operations) lit déjà `unitCost` frais pour toutes les variantes.
 */
async function fetchInventoryItemCostUpdates(filter: string): Promise<ShopifyInventoryItemNode[]> {
  const results: ShopifyInventoryItemNode[] = [];
  let after: string | null = null;

  while (true) {
    const data: {
      inventoryItems: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ node: ShopifyInventoryItemNode }>;
      };
    } = await shopifyGraphQL(INVENTORY_ITEMS_PAGE_QUERY, { first: 250, after, query: filter });

    for (const edge of data.inventoryItems.edges) {
      results.push(edge.node);
    }

    if (!data.inventoryItems.pageInfo.hasNextPage) break;
    after = data.inventoryItems.pageInfo.endCursor;
  }

  return results;
}

async function applyInventoryItemCostUpdates(items: ShopifyInventoryItemNode[]): Promise<number> {
  let updated = 0;
  for (const item of items) {
    // Un inventory item sans variant rattachée (rare — ex: composant de
    // bundle) n'a rien à mettre à jour chez nous.
    if (!item.variant) continue;
    const result = await prisma.variant.updateMany({
      where: { inventoryItemId: gidToBigInt(item.id) },
      data: { cost: item.unitCost?.amount ?? null, syncedAt: new Date() },
    });
    updated += result.count;
  }
  return updated;
}

async function upsertProduct({ product, variants }: ProductWithVariants) {
  const dbProduct = await prisma.product.upsert({
    where: { shopifyId: gidToBigInt(product.id) },
    create: {
      shopifyId: gidToBigInt(product.id),
      title: product.title,
      vendor: product.vendor,
      productType: product.productType,
      status: product.status,
      shopifyCreatedAt: new Date(product.createdAt),
      shopifyUpdatedAt: new Date(product.updatedAt),
    },
    update: {
      title: product.title,
      vendor: product.vendor,
      productType: product.productType,
      status: product.status,
      shopifyUpdatedAt: new Date(product.updatedAt),
      syncedAt: new Date(),
    },
  });

  for (const variant of variants) {
    const dbVariant = await prisma.variant.upsert({
      where: { shopifyId: gidToBigInt(variant.id) },
      create: {
        shopifyId: gidToBigInt(variant.id),
        productId: dbProduct.id,
        inventoryItemId: gidToBigInt(variant.inventoryItem.id),
        sku: variant.sku,
        barcode: variant.barcode,
        title: variant.title,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        cost: variant.inventoryItem.unitCost?.amount ?? null,
        inventoryQuantity: variant.inventoryQuantity ?? 0,
        isBlackMarket: deriveIsBlackMarket(variant.sku),
        shopifyCreatedAt: new Date(variant.createdAt),
        shopifyUpdatedAt: new Date(variant.updatedAt),
      },
      update: {
        sku: variant.sku,
        barcode: variant.barcode,
        title: variant.title,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        cost: variant.inventoryItem.unitCost?.amount ?? null,
        inventoryQuantity: variant.inventoryQuantity ?? 0,
        isBlackMarket: deriveIsBlackMarket(variant.sku),
        shopifyCreatedAt: new Date(variant.createdAt),
        shopifyUpdatedAt: new Date(variant.updatedAt),
        syncedAt: new Date(),
      },
    });

    await prisma.inventorySnapshot.create({
      data: { variantId: dbVariant.id, quantity: variant.inventoryQuantity ?? 0 },
    });
  }
}

export async function syncProducts() {
  const run = await startSyncRun("PRODUCTS");
  const startedAt = new Date();

  try {
    const lastSuccess = await getLastSuccessfulSync("PRODUCTS");
    const isFirstSync = !lastSuccess;
    const updatedSince = isFirstSync ? undefined : `updated_at:>'${lastSuccess.startedAt.toISOString()}'`;

    // Backfill complet -> Bulk Operations, exclusion appliquée à la SOURCE
    // (réduit le volume transféré, voir docs/SHOPIFY_SYNC.md).
    // Poll incrémental -> requête paginée sur un petit delta, SANS le filtre
    // d'exclusion cette fois : un produit qui bascule vers un vendor/type
    // exclu (ex: productType "Sérum" -> "Pack") ne matcherait plus jamais
    // `-product_type:'Pack'` et resterait indéfiniment en base avec des
    // infos périmées. On fetch tout ce qui a changé et on décide
    // upsert/suppression après coup avec `isExcludedProduct` (seule source
    // de vérité pour ce garde-fou, voir docs/SHOPIFY_SYNC.md).
    const productsWithVariants = isFirstSync
      ? await fetchViaBulk(withExclusionFilter(updatedSince))
      : await fetchViaPagination(updatedSince);

    let upserted = 0;
    let removed = 0;
    for (const entry of productsWithVariants) {
      if (isExcludedProduct(entry.product)) {
        const result = await prisma.product.deleteMany({ where: { shopifyId: gidToBigInt(entry.product.id) } });
        removed += result.count;
        continue;
      }
      await upsertProduct(entry);
      upserted += 1;
    }

    // Rattrapage coût (voir fetchInventoryItemCostUpdates) : uniquement sur
    // un poll incrémental, le premier sync (Bulk Operations) a déjà lu un
    // unitCost frais pour toutes les variantes.
    let costsUpdated = 0;
    if (updatedSince) {
      const costUpdates = await fetchInventoryItemCostUpdates(updatedSince);
      costsUpdated = await applyInventoryItemCostUpdates(costUpdates);
    }

    await finishSyncRun(run.id, {
      cursor: startedAt.toISOString(),
      recordsProcessed: upserted + removed + costsUpdated,
    });
  } catch (error) {
    await failSyncRun(run.id, error);
    throw error;
  }
}
