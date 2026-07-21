// Fonction PURE (aucun import Prisma) — même convention que filterParams.ts
// vs insights/filters.ts : safe à importer depuis un Client Component
// (PurchaseIntakeTable, pour l'aperçu "nouveau coût" en direct à la frappe)
// ET depuis la logique serveur (insights/purchaseIntake.ts), une seule
// implémentation partagée pour ne jamais laisser dériver l'aperçu du calcul
// réellement appliqué.

/**
 * Coût moyen pondéré après un réapprovisionnement. Si `previousCost` est
 * inconnu (jamais renseigné sur Shopify), on ne fabrique pas une moyenne à
 * partir d'une base inconnue : le nouveau coût est simplement le prix
 * d'achat de cette réception.
 */
export function computeWeightedAverageCost(
  previousQuantity: number,
  previousCost: number | null,
  quantityPurchased: number,
  purchasePrice: number,
): { newQuantity: number; newCost: number } {
  const clampedPreviousQuantity = Math.max(0, previousQuantity);
  const newQuantity = clampedPreviousQuantity + quantityPurchased;
  const newCost =
    previousCost != null
      ? (quantityPurchased * purchasePrice + clampedPreviousQuantity * previousCost) / newQuantity
      : purchasePrice;
  return { newQuantity, newCost: Math.round(newCost * 100) / 100 };
}
