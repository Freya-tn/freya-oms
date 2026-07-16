import "dotenv/config";
import { prisma } from "../lib/db";
import { deriveIsBlackMarket } from "../lib/shopify/deriveVariantFields";

/**
 * Rejoue la règle isBlackMarket (préfixe SKU "B_") sur les variantes déjà en
 * base, à partir du SKU déjà stocké — sans re-appeler Shopify. À lancer après
 * toute modification de deriveVariantFields.ts. Voir docs/SHOPIFY_SYNC.md.
 */
async function main() {
  const variants = await prisma.variant.findMany({
    select: { id: true, sku: true },
  });

  let changed = 0;
  for (const variant of variants) {
    await prisma.variant.update({
      where: { id: variant.id },
      data: { isBlackMarket: deriveIsBlackMarket(variant.sku) },
    });
    changed += 1;
  }

  console.log(`${changed}/${variants.length} variantes recalculées.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
