import type { OrderChannel } from "@/generated/prisma/enums";

/** Channel B2B/B2C — règle confirmée par l'équipe métier, voir docs/SHOPIFY_SYNC.md. */
export function deriveChannel(tags: string[]): OrderChannel {
  return tags.includes("B2B") ? "B2B" : "B2C";
}

/**
 * Règle validée avec l'équipe le 2026-07-15 sur un échantillon de 7375
 * commandes réelles (voir docs/SHOPIFY_SYNC.md pour le détail de l'analyse) :
 * une commande est confirmée si elle n'est pas annulée, pas VOIDED, et a au
 * moins commencé son fulfillment ou été payée. Une commande encore
 * PENDING + UNFULFILLED et non annulée est trop ambiguë (peut vouloir dire
 * "confirmée par téléphone, pas encore expédiée" ou "jamais appelée") —
 * décision équipe : ne pas la compter tant qu'elle n'a pas progressé.
 */
export function deriveIsConfirmed(params: {
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  cancelledAt: Date | null;
}): boolean {
  if (params.cancelledAt) return false;
  if (params.financialStatus === "VOIDED") return false;
  if (params.financialStatus === "PENDING" && params.fulfillmentStatus === "UNFULFILLED") {
    return false;
  }
  return true;
}
