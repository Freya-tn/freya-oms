import { shopifyGraphQL } from "../client";

// Premières mutations Shopify de ce projet (tout le reste est en lecture,
// polling seul — voir docs/SHOPIFY_SYNC.md). Le throttle dynamique et le
// retry sur THROTTLED sont déjà gérés génériquement par shopifyGraphQL() ;
// rien à refaire ici, seulement construire les mutations et vérifier leurs
// userErrors (même garde-fou que bulkOperationRunQuery, voir
// ../bulkOperations.ts).

const LOCATIONS_QUERY = /* GraphQL */ `
  query PrimaryLocation {
    locations(first: 1) {
      edges {
        node {
          id
        }
      }
    }
  }
`;

// Une seule location Shopify (règle métier 1 — pas de multi-entrepôt) : ne
// change jamais, donc mise en cache en mémoire pour tout le process plutôt
// que re-interrogée à chaque appel.
let cachedLocationId: string | null = null;

/** GID de l'unique location Shopify de la boutique — mis en cache après le premier appel. */
export async function getPrimaryLocationId(): Promise<string> {
  if (cachedLocationId) return cachedLocationId;

  const data = await shopifyGraphQL<{ locations: { edges: Array<{ node: { id: string } }> } }>(
    LOCATIONS_QUERY,
  );
  const location = data.locations.edges[0]?.node;
  if (!location) {
    throw new Error("Shopify: aucune location trouvée sur la boutique.");
  }
  cachedLocationId = location.id;
  return cachedLocationId;
}

const ADJUST_INVENTORY_QUANTITY_MUTATION = /* GraphQL */ `
  mutation AdjustInventoryQuantity($input: InventoryAdjustQuantitiesInput!, $key: String!) {
    inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Ajuste la quantité disponible d'un inventory item par DELTA (jamais un
 * "set" absolu) — évite d'écraser une quantité qui aurait changé entre-temps
 * (vente, autre correction manuelle) pendant qu'un batch de réception est en
 * cours de traitement.
 *
 * Deux garde-fous exigés par Shopify pour CE type de mutation (découverts en
 * testant en réel, absents de la doc consultée au moment d'écrire la
 * mutation, corrigés avant tout usage réel) :
 * - `changeFromQuantity` : vérif optimiste - si la quantité réelle a dérivé
 *   depuis le calcul de ce batch (vente entre-temps), Shopify refuse la
 *   mutation plutôt que d'appliquer le delta sur une base fausse.
 * - `@idempotent(key: ...)` : `idempotencyKey` doit rester stable pour TOUTES
 *   les tentatives d'UNE MÊME ligne (voir `withLineRetry` dans
 *   insights/purchaseIntake.ts) - Shopify déduplique ainsi une vraie
 *   double-tentative réseau (retry après une réponse perdue) au lieu
 *   d'appliquer le delta deux fois. L'appelant passe l'id de la
 *   PurchaseIntakeLine (stable, unique, déjà là) - jamais une clé regénérée à
 *   chaque tentative, qui annulerait toute la protection.
 */
export async function adjustInventoryQuantity(
  inventoryItemGid: string,
  locationGid: string,
  delta: number,
  changeFromQuantity: number,
  idempotencyKey: string,
): Promise<void> {
  const data = await shopifyGraphQL<{
    inventoryAdjustQuantities: { userErrors: Array<{ field: string[] | null; message: string }> };
  }>(ADJUST_INVENTORY_QUANTITY_MUTATION, {
    key: idempotencyKey,
    input: {
      name: "available",
      reason: "correction",
      changes: [{ inventoryItemId: inventoryItemGid, locationId: locationGid, delta, changeFromQuantity }],
    },
  });

  const userErrors = data.inventoryAdjustQuantities.userErrors;
  if (userErrors.length > 0) {
    throw new Error(`Shopify inventoryAdjustQuantities refusé: ${userErrors.map((e) => e.message).join("; ")}`);
  }
}

const UPDATE_INVENTORY_ITEM_COST_MUTATION = /* GraphQL */ `
  mutation UpdateInventoryItemCost($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

/** Pose le nouveau coût unitaire (moyenne pondérée déjà calculée) sur l'inventory item. */
export async function updateInventoryItemCost(inventoryItemGid: string, cost: number): Promise<void> {
  const data = await shopifyGraphQL<{
    inventoryItemUpdate: { userErrors: Array<{ field: string[] | null; message: string }> };
  }>(UPDATE_INVENTORY_ITEM_COST_MUTATION, {
    id: inventoryItemGid,
    input: { cost },
  });

  const userErrors = data.inventoryItemUpdate.userErrors;
  if (userErrors.length > 0) {
    throw new Error(`Shopify inventoryItemUpdate refusé: ${userErrors.map((e) => e.message).join("; ")}`);
  }
}
