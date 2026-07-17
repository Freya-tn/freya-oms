import "dotenv/config";
import { prisma } from "../lib/db";
import { gidToBigInt } from "../lib/shopify/client";
import { runBulkQuery } from "../lib/shopify/bulkOperations";
import { buildProductsBulkQuery, withExclusionFilter, type BulkProductsLine } from "../lib/shopify/queries/products";

/**
 * Backfill ponctuel de Variant.shopifyCreatedAt pour les variantes déjà
 * synchronisées avant l'introduction de ce champ (2026-07-18) — nécessaire
 * pour que la vitesse de vente ne sous-estime pas les produits récemment
 * ajoutés (voir docs/INSIGHTS.md, "Vitesse de vente : produits récemment
 * ajoutés"). Un seul run suffit : shopifyCreatedAt est immuable côté
 * Shopify, les prochains polls incrémentaux le rempliront nativement pour
 * toute nouvelle variante (voir syncProducts.ts).
 */
async function main() {
  const lines = await runBulkQuery<BulkProductsLine>(buildProductsBulkQuery(withExclusionFilter()));

  let updated = 0;
  for (const line of lines) {
    if (line.__parentId === undefined) continue; // ligne produit, pas variante
    const result = await prisma.variant.updateMany({
      where: { shopifyId: gidToBigInt(line.id) },
      data: { shopifyCreatedAt: new Date(line.createdAt) },
    });
    updated += result.count;
  }

  console.log(`${updated} variante(s) mises à jour avec leur date de création Shopify.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
