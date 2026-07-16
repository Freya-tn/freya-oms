// Palette de données — voir la skill "dataviz". Ces valeurs sont validées
// (contraste + séparation daltonisme) et NE DOIVENT PAS être piochées à la
// main ailleurs dans le code : toujours importer depuis ce fichier.
// L'identité de marque (vert/beige) reste dans theme.ts pour le chrome UI
// (AppBar, boutons) — jamais pour encoder de la donnée.

/** Ordre catégoriel fixe — ne jamais réordonner/cycler pour une série différente. */
export const CATEGORICAL = {
  blue: "#2a78d6",
  green: "#008300",
  magenta: "#e87ba4",
  yellow: "#eda100",
  aqua: "#1baf7a",
  orange: "#eb6834",
  violet: "#4a3aa7",
  red: "#e34948",
} as const;

/** B2B vs B2C : identité fixe, jamais ré-attribuée dynamiquement. */
export const CHANNEL_COLOR = {
  B2B: CATEGORICAL.blue,
  B2C: CATEGORICAL.green,
} as const;

/**
 * Déclaré vs black (vente non déclarée, `Variant.isBlackMarket`) : identité
 * fixe, jamais ré-attribuée. Dimension indépendante de `channel` (jamais
 * combinées sur le même graphique) — teintes volontairement distinctes de
 * CHANNEL_COLOR pour ne jamais laisser croire à un lien entre les deux axes.
 */
export const SALE_TYPE_COLOR = {
  DECLARED: CATEGORICAL.aqua,
  BLACK: CATEGORICAL.violet,
} as const;

/** Rampe séquentielle (bleu, clair -> foncé) pour magnitude continue. */
export const SEQUENTIAL_BLUE = {
  100: "#cde2fb",
  150: "#b7d3f6",
  200: "#9ec5f4",
  250: "#86b6ef",
  300: "#6da7ec",
  350: "#5598e7",
  400: "#3987e5",
  450: "#2a78d6",
  500: "#256abf",
  550: "#1c5cab",
  600: "#184f95",
  650: "#104281",
  700: "#0d366b",
} as const;

/** Rampe ordinale (3 paliers, contraste garanti >= 2:1) pour tiers A/B/C. */
export const ABC_TIER_COLOR = {
  A: SEQUENTIAL_BLUE[550],
  B: SEQUENTIAL_BLUE[400],
  C: SEQUENTIAL_BLUE[250],
} as const;

/** États — jamais réutilisés pour une série, toujours avec icône/label. */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

export const CHART_INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  surface: "#fcfcfb",
} as const;
