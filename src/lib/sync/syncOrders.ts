import { prisma } from "@/lib/db";
import { gidToBigInt, shopifyGraphQL } from "@/lib/shopify/client";
import { runBulkQuery } from "@/lib/shopify/bulkOperations";
import {
  buildOrdersBulkQuery,
  ORDERS_PAGE_QUERY,
  type BulkOrdersLine,
  type ShopifyLineItemNode,
  type ShopifyOrderNode,
} from "@/lib/shopify/queries/orders";
import { deriveChannel, deriveIsConfirmed } from "@/lib/shopify/deriveOrderFields";
import { startSyncRun, finishSyncRun, failSyncRun, getLastSuccessfulSync } from "./syncRun";

type OrderWithLineItems = { order: ShopifyOrderNode; lineItems: ShopifyLineItemNode[] };

async function fetchViaBulk(filter?: string): Promise<OrderWithLineItems[]> {
  const lines = await runBulkQuery<BulkOrdersLine>(buildOrdersBulkQuery(filter));

  const ordersById = new Map<string, OrderWithLineItems>();
  for (const line of lines) {
    if (line.__parentId === undefined) {
      ordersById.set(line.id, { order: line, lineItems: [] });
    }
  }
  for (const line of lines) {
    if (line.__parentId !== undefined) {
      const parent = ordersById.get(line.__parentId);
      parent?.lineItems.push(line);
    }
  }
  return [...ordersById.values()];
}

async function fetchViaPagination(filter?: string): Promise<OrderWithLineItems[]> {
  const results: OrderWithLineItems[] = [];
  let after: string | null = null;

  while (true) {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ node: ShopifyOrderNode & { lineItems: { edges: Array<{ node: ShopifyLineItemNode }> } } }>;
      };
    } = await shopifyGraphQL(ORDERS_PAGE_QUERY, { first: 250, after, query: filter ?? null });

    for (const edge of data.orders.edges) {
      const { lineItems, ...order } = edge.node;
      results.push({ order, lineItems: lineItems.edges.map((e) => e.node) });
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }

  return results;
}

async function upsertOrder({ order, lineItems }: OrderWithLineItems) {
  const cancelledAt = order.cancelledAt ? new Date(order.cancelledAt) : null;
  const channel = deriveChannel(order.tags);
  const isConfirmed = deriveIsConfirmed({
    financialStatus: order.displayFinancialStatus,
    fulfillmentStatus: order.displayFulfillmentStatus,
    cancelledAt,
  });

  const dbOrder = await prisma.order.upsert({
    where: { shopifyId: gidToBigInt(order.id) },
    create: {
      shopifyId: gidToBigInt(order.id),
      name: order.name,
      channel,
      isConfirmed,
      tags: order.tags,
      financialStatus: order.displayFinancialStatus,
      fulfillmentStatus: order.displayFulfillmentStatus,
      cancelledAt,
      currency: order.currencyCode,
      subtotalPrice: order.subtotalPriceSet.shopMoney.amount,
      totalPrice: order.totalPriceSet.shopMoney.amount,
      customerEmail: order.customer?.email ?? null,
      customerName: order.customer?.displayName ?? null,
      customerPhone: order.customer?.phone ?? null,
      orderCreatedAt: new Date(order.createdAt),
      shopifyUpdatedAt: new Date(order.updatedAt),
    },
    update: {
      channel,
      isConfirmed,
      tags: order.tags,
      financialStatus: order.displayFinancialStatus,
      fulfillmentStatus: order.displayFulfillmentStatus,
      cancelledAt,
      customerEmail: order.customer?.email ?? null,
      customerName: order.customer?.displayName ?? null,
      customerPhone: order.customer?.phone ?? null,
      shopifyUpdatedAt: new Date(order.updatedAt),
      syncedAt: new Date(),
    },
  });

  for (const lineItem of lineItems) {
    const variant = lineItem.variant
      ? await prisma.variant.findUnique({ where: { shopifyId: gidToBigInt(lineItem.variant.id) } })
      : null;

    // `discountedTotalSet` de Shopify est le PRIX FINAL de la ligne après
    // remise (pas le montant de la remise) — bug corrigé le 2026-07-16, voir
    // docs/DATABASE.md. Le vrai montant de remise = total au prix catalogue
    // moins ce prix final.
    const originalLineTotal = lineItem.quantity * Number(lineItem.originalUnitPriceSet.shopMoney.amount);
    const discountedTotal = Number(lineItem.discountedTotalSet.shopMoney.amount);
    const totalDiscount = Math.max(0, originalLineTotal - discountedTotal).toFixed(2);

    await prisma.orderLineItem.upsert({
      where: { shopifyLineItemId: gidToBigInt(lineItem.id) },
      create: {
        orderId: dbOrder.id,
        variantId: variant?.id ?? null,
        shopifyVariantId: lineItem.variant ? gidToBigInt(lineItem.variant.id) : null,
        shopifyLineItemId: gidToBigInt(lineItem.id),
        sku: lineItem.sku,
        title: lineItem.title,
        quantity: lineItem.quantity,
        unitPrice: lineItem.originalUnitPriceSet.shopMoney.amount,
        totalDiscount,
      },
      update: {
        variantId: variant?.id ?? null,
        quantity: lineItem.quantity,
        unitPrice: lineItem.originalUnitPriceSet.shopMoney.amount,
        totalDiscount,
      },
    });
  }
}

export async function syncOrders(options: { forceFull?: boolean } = {}) {
  const run = await startSyncRun("ORDERS");
  const startedAt = new Date();

  try {
    const lastSuccess = await getLastSuccessfulSync("ORDERS");
    const isFirstSync = !lastSuccess || options.forceFull === true;

    const filter = isFirstSync
      ? undefined
      : `updated_at:>'${lastSuccess.startedAt.toISOString()}'`;

    // Backfill historique complet (ou resync forcé) -> Bulk Operations. Poll
    // incrémental -> requête paginée classique (capture aussi les
    // changements de statut, ex: annulation tardive d'une commande déjà
    // confirmée). `forceFull` sert à ré-appliquer une correction de mapping
    // sur tout l'historique sans perdre le SyncRun existant (voir
    // docs/SHOPIFY_SYNC.md).
    const ordersWithLineItems = isFirstSync
      ? await fetchViaBulk(filter)
      : await fetchViaPagination(filter);

    for (const entry of ordersWithLineItems) {
      await upsertOrder(entry);
    }

    await finishSyncRun(run.id, {
      cursor: startedAt.toISOString(),
      recordsProcessed: ordersWithLineItems.length,
    });
  } catch (error) {
    await failSyncRun(run.id, error);
    throw error;
  }
}
