import { prisma } from "@/lib/db";
import type { SyncResource, SyncStatus } from "@/generated/prisma/enums";

export type SyncStatusRow = {
  resource: SyncResource;
  status: SyncStatus | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
};

/** Dernier run (quel que soit son statut) par ressource — pour afficher la fraîcheur des données sur l'Overview. */
export async function getLastSyncStatus(): Promise<SyncStatusRow[]> {
  const resources: SyncResource[] = ["PRODUCTS", "ORDERS"];

  return Promise.all(
    resources.map(async (resource) => {
      const run = await prisma.syncRun.findFirst({
        where: { resource },
        orderBy: { startedAt: "desc" },
      });
      return {
        resource,
        status: run?.status ?? null,
        startedAt: run?.startedAt ?? null,
        finishedAt: run?.finishedAt ?? null,
        errorMessage: run?.errorMessage ?? null,
      };
    }),
  );
}
