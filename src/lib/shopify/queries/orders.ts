// Requêtes commandes/line items. `displayFinancialStatus`/`displayFulfillmentStatus`
// sont les statuts natifs Shopify utilisés pour dériver `isConfirmed` — voir
// src/lib/shopify/deriveOrderFields.ts et docs/SHOPIFY_SYNC.md.

const LINE_ITEM_FIELDS = /* GraphQL */ `
  id
  sku
  title
  quantity
  discountedTotalSet {
    shopMoney {
      amount
    }
  }
  originalUnitPriceSet {
    shopMoney {
      amount
    }
  }
  variant {
    id
  }
`;

const ORDER_SCALAR_FIELDS = /* GraphQL */ `
  id
  name
  tags
  displayFinancialStatus
  displayFulfillmentStatus
  cancelledAt
  createdAt
  updatedAt
  currencyCode
  subtotalPriceSet {
    shopMoney {
      amount
    }
  }
  totalPriceSet {
    shopMoney {
      amount
    }
  }
  customer {
    email
    displayName
    phone
  }
`;

/** Query pour Bulk Operation (backfill historique complet). */
export function buildOrdersBulkQuery(filter?: string): string {
  const ordersArgs = filter ? `(query: ${JSON.stringify(filter)})` : "";
  return /* GraphQL */ `
    {
      orders${ordersArgs} {
        edges {
          node {
            ${ORDER_SCALAR_FIELDS}
            lineItems {
              edges {
                node {
                  ${LINE_ITEM_FIELDS}
                }
              }
            }
          }
        }
      }
    }
  `;
}

/** Query paginée classique pour les polls incrémentaux. */
export const ORDERS_PAGE_QUERY = /* GraphQL */ `
  query OrdersPage($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          ${ORDER_SCALAR_FIELDS}
          lineItems(first: 250) {
            edges {
              node {
                ${LINE_ITEM_FIELDS}
              }
            }
          }
        }
      }
    }
  }
`;

export type ShopifyLineItemNode = {
  id: string;
  sku: string | null;
  title: string;
  quantity: number;
  discountedTotalSet: { shopMoney: { amount: string } };
  originalUnitPriceSet: { shopMoney: { amount: string } };
  variant: { id: string } | null;
};

export type ShopifyOrderNode = {
  id: string;
  name: string;
  tags: string[];
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  currencyCode: string;
  subtotalPriceSet: { shopMoney: { amount: string } };
  totalPriceSet: { shopMoney: { amount: string } };
  customer: { email: string | null; displayName: string | null; phone: string | null } | null;
};

/** Ligne brute du JSONL Bulk Operation : soit une commande, soit un line item avec `__parentId`. */
export type BulkOrdersLine =
  | (ShopifyOrderNode & { __parentId?: undefined })
  | (ShopifyLineItemNode & { __parentId: string });
