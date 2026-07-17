"use server";

import { revalidatePath } from "next/cache";
import { syncProducts } from "@/lib/sync/syncProducts";
import { syncOrders } from "@/lib/sync/syncOrders";

export type SyncActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Déclenché depuis le bouton "Actualiser" de l'Overview. Protégé par la même
 * session que le reste du dashboard (proxy.ts) — pas besoin de CRON_SECRET
 * ici, contrairement à /api/cron/sync qui est appelé sans session utilisateur.
 */
export async function triggerSyncAction(): Promise<SyncActionResult> {
  try {
    await syncProducts();
    await syncOrders();
    revalidatePath("/");
    return { ok: true, message: "Synchronisation terminée." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Déclenché depuis le bouton "Resynchroniser les coûts" de la page Alertes —
 * ne relance QUE le sync produits (coût/productType/etc), pas les commandes,
 * pour rester rapide quand on veut juste voir si un coût corrigé sur Shopify
 * est bien rattrapé (voir docs/SHOPIFY_SYNC.md, "Piège : le coût...").
 */
export async function triggerProductSyncAction(): Promise<SyncActionResult> {
  try {
    await syncProducts();
    revalidatePath("/alertes");
    return { ok: true, message: "Synchronisation produits terminée." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
