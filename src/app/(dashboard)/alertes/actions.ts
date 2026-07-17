"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";

/** Marque une alerte comme vérifiée par un humain — ne réapparaîtra plus tant que la donnée sous-jacente ne change pas de forme (voir docs/INSIGHTS.md, section "Alertes"). */
export async function acknowledgeAlert(alertKey: string): Promise<void> {
  const session = await auth();
  await prisma.alertAcknowledgment.upsert({
    where: { alertKey },
    create: { alertKey, acknowledgedBy: session?.user?.email ?? null },
    update: {},
  });
  revalidatePath("/alertes");
}

/** Rouvre une alerte précédemment vérifiée. */
export async function unacknowledgeAlert(alertKey: string): Promise<void> {
  await prisma.alertAcknowledgment.deleteMany({ where: { alertKey } });
  revalidatePath("/alertes");
}
