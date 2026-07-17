// Requêtes produits/variantes. `inventoryQuantity` est demandé directement
// sur la variante (dispo nativement pour un stock mono-location) — évite
// tout N+1 sur les inventory levels. Voir docs/SHOPIFY_SYNC.md.

// Décision équipe (2026-07-16) : ces marques et types de produits ne sont
// jamais synchronisés dans freyaOMS (hors périmètre de l'outil). Valeurs
// exactes vérifiées sur le catalogue réel (232 produits) avant d'écrire
// cette liste — voir docs/DATABASE.md.
export const EXCLUDED_VENDORS = ["La Roche-Posay", "CeraVe", "FREYA Tunisie"];
export const EXCLUDED_PRODUCT_TYPES = ["Pack", "Pack Saint-Valentin"];

/** Fragment de filtre Shopify `query:` excluant ces marques/types à la source (réduit le volume transféré). */
function buildExclusionFilter(): string {
  const vendorClauses = EXCLUDED_VENDORS.map((v) => `-vendor:${JSON.stringify(v)}`);
  const typeClauses = EXCLUDED_PRODUCT_TYPES.map((t) => `-product_type:${JSON.stringify(t)}`);
  return [...vendorClauses, ...typeClauses].join(" AND ");
}

/** Combine le filtre d'exclusion avec un filtre additionnel (ex: `updated_at:>...`). */
export function withExclusionFilter(extraFilter?: string): string {
  return extraFilter ? `${buildExclusionFilter()} AND ${extraFilter}` : buildExclusionFilter();
}

/**
 * Garde-fou applicatif : même si le filtre `query:` Shopify a un souci de
 * syntaxe ou de cache, un produit exclu ne sera jamais upserté en base.
 */
export function isExcludedProduct(product: { vendor: string | null; productType: string | null }): boolean {
  if (product.vendor && EXCLUDED_VENDORS.includes(product.vendor)) return true;
  if (product.productType && EXCLUDED_PRODUCT_TYPES.includes(product.productType)) return true;
  return false;
}

const PRODUCT_VARIANT_FIELDS = /* GraphQL */ `
  id
  sku
  barcode
  title
  price
  compareAtPrice
  inventoryQuantity
  createdAt
  updatedAt
  inventoryItem {
    id
    unitCost {
      amount
    }
  }
`;

/** Query pour Bulk Operation (backfill complet) — pas de pagination manuelle, Shopify gère ça en interne. */
export function buildProductsBulkQuery(filter?: string): string {
  const productsArgs = filter ? `(query: ${JSON.stringify(filter)})` : "";
  return /* GraphQL */ `
    {
      products${productsArgs} {
        edges {
          node {
            id
            title
            vendor
            productType
            status
            createdAt
            updatedAt
            variants {
              edges {
                node {
                  ${PRODUCT_VARIANT_FIELDS}
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
export const PRODUCTS_PAGE_QUERY = /* GraphQL */ `
  query ProductsPage($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          vendor
          productType
          status
          createdAt
          updatedAt
          variants(first: 250) {
            edges {
              node {
                ${PRODUCT_VARIANT_FIELDS}
              }
            }
          }
        }
      }
    }
  }
`;

export type ShopifyProductNode = {
  id: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ShopifyVariantNode = {
  id: string;
  sku: string | null;
  barcode: string | null;
  title: string;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  createdAt: string;
  updatedAt: string;
  inventoryItem: {
    id: string;
    unitCost: { amount: string } | null;
  };
};

/**
 * Poll incrémental dédié au coût (`InventoryItem.unitCost`) — voir
 * docs/SHOPIFY_SYNC.md, "Piège : le coût n'est PAS couvert par le poll
 * produits". Un changement de coût ne met à jour NI `Product.updatedAt` NI
 * `ProductVariant.updatedAt` côté Shopify (vérifié le 2026-07-17 sur un
 * changement réel : les deux sont restés figés à leur dernière valeur alors
 * que le coût avait changé il y a quelques secondes) — seul
 * `InventoryItem.updatedAt` bouge. Le poll produits standard ne peut donc
 * jamais détecter un changement de coût seul ; ce poll séparé, filtré sur ce
 * même champ, comble le trou.
 */
export const INVENTORY_ITEMS_PAGE_QUERY = /* GraphQL */ `
  query InventoryItemsPage($first: Int!, $after: String, $query: String) {
    inventoryItems(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          updatedAt
          unitCost {
            amount
          }
          variant {
            id
          }
        }
      }
    }
  }
`;

export type ShopifyInventoryItemNode = {
  id: string;
  updatedAt: string;
  unitCost: { amount: string } | null;
  variant: { id: string } | null;
};

/** Ligne brute du JSONL Bulk Operation : soit un produit, soit une variante avec `__parentId`. */
export type BulkProductsLine =
  | (ShopifyProductNode & { __parentId?: undefined })
  | (ShopifyVariantNode & { __parentId: string });
