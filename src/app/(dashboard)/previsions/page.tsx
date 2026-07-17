import { Alert, Box, Card, CardContent, Chip, Divider, Grid, Stack, Typography } from "@mui/material";
import { forecastForScope, getForecastAccuracy, type ForecastResult } from "@/lib/insights/forecast";
import { getCategoryList } from "@/lib/insights/filters";
import { parseCategoryParam } from "@/lib/filterParams";
import { FilterBar } from "@/components/FilterBar";
import { ForecastAccuracyChart } from "@/components/ForecastAccuracyChart";
import { formatCurrency, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const MONTH_LABEL = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

function ForecastCard({ title, forecast }: { title: string; forecast: ForecastResult }) {
  const monthLabel = `${MONTH_LABEL[forecast.targetMonth - 1]} ${forecast.targetYear}`;
  const extrapolatedUnits = forecast.predictedUnits - forecast.actualUnitsToDate;

  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {title} ({monthLabel})
        </Typography>
        <Typography variant="h4" component="p" sx={{ fontWeight: 700, mt: 0.5 }}>
          {formatCurrency(forecast.predictedRevenue)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {formatNumber(forecast.predictedUnits)} unités prévues
        </Typography>

        <Divider sx={{ mb: 1.5 }} />
        <Stack spacing={0.75}>
          <Typography variant="body2">
            <strong>{formatNumber(forecast.actualUnitsToDate)}</strong> unités déjà vendues, réelles
            {forecast.daysElapsed > 0 ? ` (${Math.round(forecast.daysElapsed)} j sur ${Math.round(forecast.daysInMonth)})` : ""}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            + {formatNumber(Math.max(0, extrapolatedUnits))} unités extrapolées sur les{" "}
            {Math.round(forecast.daysRemaining)} j restants
          </Typography>
        </Stack>

        <Divider sx={{ my: 1.5 }} />
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {/* Info-bulle native (attribut `title`), pas <Tooltip> : Tooltip clone
              son enfant et déclenche un hydration mismatch au premier rendu
              avec Chip en MUI v9/React 19 (aucun autre endroit du code ne
              met un Chip directement sous Tooltip, voir ReorderTable.tsx). */}
          <span title="Taux de base : vitesse de vente adaptative agrégée sur ce périmètre (voir page Stock).">
            <Chip label={`Base ${forecast.baseUnitsRate.toFixed(1)} u/j`} size="small" variant="outlined" />
          </span>
          <span
            title={
              forecast.seasonalTrusted
                ? "Indice de saisonnalité calculé sur au moins 3 années complètes."
                : "Moins de 3 années complètes d'historique pour ce mois : indice neutre (1.0) plutôt qu'un chiffre peu fiable."
            }
          >
            <Chip
              label={`Saisonnalité ×${forecast.seasonalIndex.toFixed(2)}`}
              size="small"
              color={forecast.seasonalTrusted ? "default" : "warning"}
              variant="outlined"
            />
          </span>
          <span
            title={
              forecast.growthTrusted
                ? "Croissance unités sur 90j vs même période l'an dernier."
                : "Pas assez de commandes l'an dernier sur cette période pour comparer : facteur neutre (1.0)."
            }
          >
            <Chip
              label={`Croissance ×${forecast.growthFactor.toFixed(2)}`}
              size="small"
              color={forecast.growthTrusted ? "default" : "warning"}
              variant="outlined"
            />
          </span>
          {!forecast.avgSellingPriceTrusted && (
            <span title="Aucune vente récente dans ce périmètre : prix de vente moyen basé sur le prix catalogue plutôt que sur des ventes réelles.">
              <Chip label="Prix catalogue (pas de vente récente)" size="small" color="warning" variant="outlined" />
            </span>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

export default async function PrevisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const params = await searchParams;
  const category = parseCategoryParam(params.category);
  const scope = category ? ("CATEGORY" as const) : ("GLOBAL" as const);
  const scopeKey = category ?? "GLOBAL";

  const now = new Date();
  const nextMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [categories, currentMonthForecast, nextMonthForecast, accuracy] = await Promise.all([
    getCategoryList(),
    forecastForScope(scope, scopeKey, now.getUTCFullYear(), now.getUTCMonth() + 1, now),
    forecastForScope(scope, scopeKey, nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1, now),
    getForecastAccuracy(scope, scopeKey),
  ]);

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Prévisions de ventes
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Chaque prévision combine les ventes déjà réelles du mois (jamais ré-estimées) et une extrapolation UNIQUEMENT
        sur les jours restants : la part réelle grandit et la part extrapolée rétrécit mécaniquement chaque jour, ce
        qui rend la prévision plus précise à mesure que le mois avance. Voir docs/INSIGHTS.md, section
        &quot;Prévisions de ventes&quot;.
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            Périmètre
          </Typography>
          <FilterBar
            vendors={[]}
            showVendorFilter={false}
            showPeriodFilter={false}
            defaultPeriod={30}
            extraFilters={[
              {
                key: "category",
                label: "Périmètre",
                allLabel: "Global (toutes catégories)",
                options: categories.map((c) => ({ value: c, label: c })),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <ForecastCard title="Mois en cours" forecast={currentMonthForecast} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ForecastCard title="Mois prochain" forecast={nextMonthForecast} />
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Précision des prévisions dans le temps
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Erreur moyenne (MAPE) des prévisions passées, une fois le mois cible clos et le réel connu, par délai
            avant la fin du mois cible. Se remplit jour après jour, mois après mois : la preuve concrète que
            l&apos;algorithme devient plus précis, pas juste une promesse.
          </Typography>
          {accuracy.length === 0 ? (
            <Alert severity="info">
              Pas encore de mois réconcilié pour ce périmètre. Ce graphique se remplira au fil des mois, une fois que
              des prévisions passées auront pu être comparées au réel.
            </Alert>
          ) : (
            <Box>
              <ForecastAccuracyChart data={accuracy} />
              <Typography variant="caption" color="text.secondary">
                Basé sur {accuracy.reduce((sum, p) => sum + p.sampleSize, 0)} prévision(s) réconciliée(s).
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>
    </>
  );
}
