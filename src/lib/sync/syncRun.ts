import { prisma } from "@/lib/db";
import type { SyncResource } from "@/generated/prisma/enums";

export async function startSyncRun(resource: SyncResource) {
  return prisma.syncRun.create({
    data: { resource, status: "RUNNING" },
  });
}

export async function finishSyncRun(
  id: string,
  data: { cursor?: string | null; recordsProcessed: number },
) {
  return prisma.syncRun.update({
    where: { id },
    data: {
      status: "SUCCESS",
      finishedAt: new Date(),
      cursor: data.cursor ?? undefined,
      recordsProcessed: data.recordsProcessed,
    },
  });
}

export async function failSyncRun(id: string, error: unknown) {
  return prisma.syncRun.update({
    where: { id },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : String(error),
    },
  });
}

/** Curseur du dernier run réussi pour une resource — sert de filtre `updated_at:>` pour les polls incrémentaux. */
export async function getLastSuccessfulSync(resource: SyncResource) {
  return prisma.syncRun.findFirst({
    where: { resource, status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
  });
}
