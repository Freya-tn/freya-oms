import { Box, Typography } from "@mui/material";
import { getAlerts } from "@/lib/insights/alerts";
import { AlertsList } from "@/components/AlertsList";
import { SyncCostButton } from "@/components/SyncCostButton";

export const dynamic = "force-dynamic";

export default async function AlertesPage() {
  const alerts = await getAlerts();
  const activeCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Alertes
        </Typography>
        <SyncCostButton />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Données manquantes ou anomalies détectées automatiquement (coût, marge) - à vérifier et valider manuellement,
        jamais corrigées toutes seules.{" "}
        {activeCount > 0 ? `${activeCount} alerte(s) à traiter.` : "Tout est à jour."} Si vous venez de corriger un
        coût sur Shopify, resynchronisez pour voir le nouveau résultat sans attendre le prochain poll automatique.
      </Typography>
      <AlertsList alerts={alerts} />
    </>
  );
}
