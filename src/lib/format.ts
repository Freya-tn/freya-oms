// Formatage partagé — fonctions PURES (pas d'import Prisma), safe à importer
// depuis un Client Component. Boutique en TND (Tunisie), voir docs/ARCHITECTURE.md.

const numberFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export function formatCurrency(value: number): string {
  return `${numberFormatter.format(value)} TND`;
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** Date absolue courte (ex: "15 juillet 2026") — pour ancrer une mesure "depuis le début" à une date concrète. */
export function formatDate(date: Date | string): string {
  return dateFormatter.format(new Date(date));
}

const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });

/**
 * Sous-titre "X% de marge" pour un BarListChart, avec le rappel de couverture
 * uniquement quand elle est réellement partielle — sinon "calculée sur 100%
 * du CA, le reste n'a pas de coût connu" est contradictoire (il n'y a pas de
 * "reste" à 100%). Seule source de vérité pour ce texte : Produits et B2B vs
 * B2C l'utilisent tous les deux, voir docs/INSIGHTS.md, section 14.
 */
export function formatMarginSublabel(marginRate: number | null, costCoverage: number): string {
  if (marginRate === null) return "coût non renseigné sur Shopify : marge impossible à calculer";
  const rate = percentFormatter.format(marginRate);
  if (costCoverage >= 0.999) return `${rate} de marge`;
  return `${rate} de marge (calculée sur ${percentFormatter.format(costCoverage)} du CA, le reste n'a pas de coût connu)`;
}

/** Temps relatif court (ex: "il y a 5 min") — pour afficher la fraîcheur d'une synchro. */
export function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "jamais";
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffDays = Math.round(diffH / 24);
  return `il y a ${diffDays} j`;
}
