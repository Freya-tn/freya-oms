import { Alert, AlertTitle, Typography } from "@mui/material";
import { formatDate } from "@/lib/format";

/**
 * Affiché À LA PLACE du contenu habituel (filtres, table) tant que
 * `InventorySnapshot` n'a pas assez de profondeur pour donner des résultats
 * fiables (voir `sufficientData` dans `velocity.ts`, docs/INSIGHTS.md
 * section 1) - décision équipe 2026-07-18 : mieux vaut expliquer clairement
 * l'attente que d'afficher une page vide/toutes-exclues sans contexte.
 */
export function HistoryDepthNotice({
  historyDepthDays,
  requiredDays,
}: {
  historyDepthDays: number;
  requiredDays: number;
}) {
  const daysRemaining = Math.max(0, requiredDays - historyDepthDays);
  const readyDate = new Date(new Date().getTime() + daysRemaining * 86_400_000);

  return (
    <Alert severity="info">
      <AlertTitle>Pas encore assez de recul pour des résultats fiables</AlertTitle>
      <Typography variant="body2" sx={{ mb: 1 }}>
        Il faut {requiredDays}j de suivi réel du stock. Shopify ne fournit que le niveau de stock actuel, jamais
        d&apos;historique récupérable a posteriori - cette donnée se construit donc jour après jour, pas d&apos;un
        coup.
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        Suivi actuel : {historyDepthDays}j sur {requiredDays}j
        {daysRemaining > 0 ? ` - encore ${daysRemaining}j, vers le ${formatDate(readyDate)}` : ""}.
      </Typography>
    </Alert>
  );
}
