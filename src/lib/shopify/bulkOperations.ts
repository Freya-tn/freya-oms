import { shopifyGraphQL } from "./client";

// Bulk Operations API : exécute une requête Shopify de façon asynchrone
// côté serveur et renvoie un fichier JSONL, quel que soit le volume de
// données. Compte pour un coût quasi nul côté quota GraphQL (la requête
// elle-même n'est jamais paginée manuellement). Utilisé pour le backfill
// initial / une resynchro complète — voir docs/SHOPIFY_SYNC.md.
//
// Une seule bulk operation peut tourner à la fois par boutique : on
// vérifie toujours `currentBulkOperation` avant d'en lancer une nouvelle.

const RUN_BULK_QUERY = /* GraphQL */ `
  mutation RunBulkQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CURRENT_BULK_OPERATION = /* GraphQL */ `
  query CurrentBulkOperation {
    currentBulkOperation {
      id
      status
      errorCode
      url
      objectCount
    }
  }
`;

type BulkOperationNode = {
  id: string;
  status: "CREATED" | "RUNNING" | "COMPLETED" | "CANCELED" | "FAILED" | "EXPIRED";
  errorCode?: string | null;
  url?: string | null;
  objectCount?: string;
};

async function getCurrentBulkOperation(): Promise<BulkOperationNode | null> {
  const data = await shopifyGraphQL<{ currentBulkOperation: BulkOperationNode | null }>(
    CURRENT_BULK_OPERATION,
  );
  return data.currentBulkOperation;
}

async function waitForCompletion(): Promise<BulkOperationNode> {
  let delayMs = 2000;
  const maxDelayMs = 15000;

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const op = await getCurrentBulkOperation();

    if (!op) {
      throw new Error("Bulk operation: aucune opération courante trouvée pendant le polling");
    }
    if (op.status === "COMPLETED") return op;
    if (op.status === "FAILED" || op.status === "CANCELED" || op.status === "EXPIRED") {
      throw new Error(`Bulk operation terminée en échec: ${op.status} (${op.errorCode ?? "?"})`);
    }

    delayMs = Math.min(delayMs * 1.5, maxDelayMs);
  }
}

/**
 * Lance une requête en Bulk Operation, attend sa complétion, télécharge et
 * parse le JSONL résultant. `query` doit être une query GraphQL valide
 * utilisant des connections (voir la doc Shopify sur les Bulk Operations).
 */
export async function runBulkQuery<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const current = await getCurrentBulkOperation();
  if (current && (current.status === "CREATED" || current.status === "RUNNING")) {
    throw new Error(
      `Une bulk operation est déjà en cours (${current.id}) — attendre sa fin avant d'en lancer une nouvelle.`,
    );
  }

  const started = await shopifyGraphQL<{
    bulkOperationRunQuery: {
      bulkOperation: BulkOperationNode | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(RUN_BULK_QUERY, { query });

  if (started.bulkOperationRunQuery.userErrors.length > 0) {
    throw new Error(
      `Bulk operation refusée: ${started.bulkOperationRunQuery.userErrors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }

  const completed = await waitForCompletion();
  if (!completed.url) {
    // Aucune donnée produite (objectCount = 0) : Shopify ne fournit pas d'URL.
    return [];
  }

  const res = await fetch(completed.url);
  if (!res.ok) {
    throw new Error(`Téléchargement du résultat bulk operation échoué: HTTP ${res.status}`);
  }
  const text = await res.text();

  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}
