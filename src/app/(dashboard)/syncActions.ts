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
