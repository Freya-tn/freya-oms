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
