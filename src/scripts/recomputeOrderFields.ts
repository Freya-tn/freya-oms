import "dotenv/config";
import { prisma } from "../lib/db";
import { deriveChannel, deriveIsConfirmed } from "../lib/shopify/deriveOrderFields";

/**
 * Rejoue les règles de dérivation channel/isConfirmed sur les commandes déjà
 * en base, à partir des tags/statuts bruts déjà stockés — sans re-appeler
 * Shopify. À lancer après toute modification de deriveOrderFields.ts. Voir
 * docs/DATABASE.md, point 3.
 */
async function main() {
  const orders = await prisma.order.findMany({
    select: { id: true, tags: true, financialStatus: true, fulfillmentStatus: true, cancelledAt: true },
  });

  let changed = 0;
  for (const order of orders) {
    const channel = deriveChannel(order.tags);
    const isConfirmed = deriveIsConfirmed({
      financialStatus: order.financialStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      cancelledAt: order.cancelledAt,
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { channel, isConfirmed },
    });
    changed += 1;
  }

  console.log(`${changed}/${orders.length} commandes recalculées.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
