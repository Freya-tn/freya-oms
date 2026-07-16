import "dotenv/config";
import { prisma } from "../lib/db";
import { EXCLUDED_VENDORS, EXCLUDED_PRODUCT_TYPES } from "../lib/shopify/queries/products";

/**
 * Supprime les produits déjà en base qui correspondent à la liste
 * d'exclusion (vendor/productType) — à lancer une fois après avoir ajouté
 * une entrée à EXCLUDED_VENDORS/EXCLUDED_PRODUCT_TYPES, pour nettoyer les
 * données déjà synchronisées avant la mise à jour de la règle. Les
 * OrderLineItem historiques ne sont jamais supprimés (onDelete: SetNull sur
 * Variant) — voir docs/DATABASE.md.
 */
async function main() {
  const toDelete = await prisma.product.findMany({
    where: {
      OR: [{ vendor: { in: EXCLUDED_VENDORS } }, { productType: { in: EXCLUDED_PRODUCT_TYPES } }],
    },
    select: { id: true, title: true, vendor: true, productType: true },
  });

  console.log(`${toDelete.length} produit(s) à supprimer (vendor/productType exclus) :`);
  for (const p of toDelete) {
    console.log(` - ${p.title} (${p.vendor} / ${p.productType})`);
  }

  const result = await prisma.product.deleteMany({
    where: { id: { in: toDelete.map((p) => p.id) } },
  });

  console.log(`${result.count} produit(s) supprimé(s) (variantes/snapshots en cascade).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
