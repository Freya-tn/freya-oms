import { shopifyEnv } from "./env";

// Client GraphQL Admin API minimal, sans SDK : voir docs/SHOPIFY_SYNC.md
// pour la stratégie de minimisation des appels. Le point important ici
// est le throttle *dynamique* basé sur `extensions.cost.throttleStatus`
// renvoyé par Shopify sur CHAQUE réponse — jamais un `sleep()` fixe.

type ThrottleStatus = {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: { cost?: { requestedQueryCost: number; actualQueryCost: number; throttleStatus: ThrottleStatus } };
};

// État partagé du throttle entre appels successifs dans le même process
// (les jobs de sync tournent séquentiellement, pas en parallèle).
let lastKnownThrottle: { status: ThrottleStatus; observedAt: number } | null = null;

function estimateCurrentlyAvailable(): number | null {
  if (!lastKnownThrottle) return null;
  const { status, observedAt } = lastKnownThrottle;
  const elapsedSeconds = (Date.now() - observedAt) / 1000;
  const restored = elapsedSeconds * status.restoreRate;
  return Math.min(status.maximumAvailable, status.currentlyAvailable + restored);
}

async function waitForBudget(estimatedCost: number) {
  const available = estimateCurrentlyAvailable();
  if (available === null || available >= estimatedCost) return;
  const restoreRate = lastKnownThrottle!.status.restoreRate;
  const waitSeconds = (estimatedCost - available) / restoreRate;
  if (waitSeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(waitSeconds * 1000)));
  }
}

const MAX_RETRIES = 5;
// Coût forfaitaire estimé avant le premier appel (pas encore de throttleStatus connu) —
// conservateur pour éviter un THROTTLED dès la première requête d'un run.
const DEFAULT_ESTIMATED_COST = 50;

export async function shopifyGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  let attempt = 0;

  while (true) {
    await waitForBudget(DEFAULT_ESTIMATED_COST);

    const res = await fetch(shopifyEnv.graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyEnv.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok && res.status !== 200) {
      throw new Error(`Shopify GraphQL HTTP ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as GraphQLResponse<T>;

    if (json.extensions?.cost?.throttleStatus) {
      lastKnownThrottle = { status: json.extensions.cost.throttleStatus, observedAt: Date.now() };
    }

    const throttled = json.errors?.some((e) => e.extensions?.code === "THROTTLED");
    if (throttled) {
      attempt += 1;
      if (attempt > MAX_RETRIES) {
        throw new Error(`Shopify GraphQL: THROTTLED after ${MAX_RETRIES} retries`);
      }
      // Backoff exponentiel en secours, en plus de l'attente basée sur le coût réel.
      const backoffMs = 500 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }

    if (json.errors?.length) {
      throw new Error(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
    }

    if (!json.data) {
      throw new Error("Shopify GraphQL: réponse sans data ni erreurs");
    }

    return json.data;
  }
}

/** Extrait la partie numérique d'un GID GraphQL, ex: "gid://shopify/Order/123" -> 123n */
export function gidToBigInt(gid: string): bigint {
  const match = gid.match(/(\d+)$/);
  if (!match) {
    throw new Error(`GID Shopify invalide: ${gid}`);
  }
  return BigInt(match[1]);
}
