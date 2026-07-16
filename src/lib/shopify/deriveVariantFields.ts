/**
 * Vente non déclarée ("au black") — décision équipe 2026-07-16 : les SKU
 * préfixés "B_" identifient un duplicata volontaire d'un SKU officiel, créé
 * pour tracer en stock les ventes qui ne passent pas par la comptabilité
 * déclarée. Voir docs/SHOPIFY_SYNC.md pour le détail. Dérivé à l'ingestion et
 * dénormalisé sur Variant, jamais recalculé à la volée dans les requêtes
 * d'insights (même principe que Order.channel/isConfirmed).
 */
export const BLACK_MARKET_SKU_PREFIX = "B_";

export function deriveIsBlackMarket(sku: string | null | undefined): boolean {
  return !!sku && sku.startsWith(BLACK_MARKET_SKU_PREFIX);
}
