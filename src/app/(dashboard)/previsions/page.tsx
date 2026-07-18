import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  forecastAllScopes,
  forecastForScope,
  getForecastAccuracy,
  type ChannelForecastDetail,
  type ForecastResult,
} from "@/lib/insights/forecast";
import { getCategoryList } from "@/lib/insights/filters";
import { parseCategoryParam } from "@/lib/filterParams";
import { CHANNEL_COLOR } from "@/lib/theme/chartColors";
import { FilterBar } from "@/components/FilterBar";
import { ForecastAccuracyChart } from "@/components/ForecastAccuracyChart";
import { ForecastMethodologyDialog } from "@/components/ForecastMethodologyDialog";
import { ForecastOverviewTable, type ForecastOverviewRow } from "@/components/ForecastOverviewTable";
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

function ChannelDetail({ channel, detail }: { channel: "B2B" | "B2C"; detail: ChannelForecastDetail }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: CHANNEL_COLOR[channel] }} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {channel}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {formatCurrency(detail.predictedRevenue)}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
        {/* Info-bulle native (attribut `title`), pas <Tooltip> : Tooltip clone
            son enfant et déclenche un hydration mismatch au premier rendu
            avec Chip en MUI v9/React 19 (aucun autre endroit du code ne
            met un Chip directement sous Tooltip, voir ReorderTable.tsx). */}
        <span title="Taux de base : vitesse de vente adaptative de ce canal (voir page Stock).">
          <Chip label={`Base ${detail.baseUnitsRate.toFixed(1)} u/j`} size="small" variant="outlined" />
        </span>
        <span
          title={
            detail.seasonalTrusted
              ? `Indice calculé sur ${detail.seasonalOccurrences} années complètes (confiance pleine).`
              : `Seulement ${detail.seasonalOccurrences} année(s) complète(s) pour ce mois : indice rapproché de 1.0 proportionnellement (jamais coupé net).`
          }
        >
          <Chip
            label={`Saisonnalité ×${detail.seasonalIndex.toFixed(2)}`}
            size="small"
            color={detail.seasonalTrusted ? "default" : "warning"}
            variant="outlined"
          />
        </span>
        <span
          title={
            detail.growthTrusted
              ? "Croissance unités sur 90j vs même période l'an dernier, pour ce canal."
              : "Pas assez de commandes l'an dernier sur cette période pour comparer : facteur neutre (1.0)."
          }
        >
          <Chip
            label={`Croissance ×${detail.growthFactor.toFixed(2)}`}
            size="small"
            color={detail.growthTrusted ? "default" : "warning"}
            variant="outlined"
          />
        </span>
        {!detail.dowTrusted && (
          <span title="Pas assez de commandes sur ce canal pour fiabiliser la répartition par jour de semaine : jours restants comptés à parts égales.">
            <Chip label="Jours à parts égales" size="small" color="warning" variant="outlined" />
          </span>
        )}
        {!detail.avgSellingPriceTrusted && (
          <span title="Aucune vente récente sur ce canal : prix de vente moyen basé sur le prix catalogue.">
            <Chip label="Prix catalogue" size="small" color="warning" variant="outlined" />
          </span>
        )}
      </Box>
    </Box>
  );
}

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
          {formatNumber(forecast.predictedUnits)} unités prévues (B2B + B2C)
        </Typography>

        <Divider sx={{ mb: 1.5 }} />
        <Stack spacing={0.75} sx={{ mb: 1.5 }}>
          <Typography variant="body2">
            <strong>{formatNumber(forecast.actualUnitsToDate)}</strong> unités déjà vendues, réelles
            {forecast.daysElapsed > 0 ? ` (${Math.round(forecast.daysElapsed)} j sur ${Math.round(forecast.daysInMonth)})` : ""}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            + {formatNumber(Math.max(0, extrapolatedUnits))} unités extrapolées sur les{" "}
            {Math.round(forecast.daysRemaining)} j restants
          </Typography>
        </Stack>

        <Divider sx={{ mb: 1.5 }} />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          Détail par canal (calculé indépendamment, jamais mélangé)
        </Typography>
        <ChannelDetail channel="B2B" detail={forecast.byChannel.B2B} />
        <ChannelDetail channel="B2C" detail={forecast.byChannel.B2C} />

        <Accordion disableGutters elevation={0} sx={{ mt: 1, border: "1px solid", borderColor: "divider", "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, "& .MuiAccordionSummary-content": { my: 0.5 } }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Voir le détail du calcul
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            {(["B2B", "B2C"] as const).map((channel) => {
              const detail = forecast.byChannel[channel];
              const channelExtrapolated = Math.max(0, detail.predictedUnits - detail.actualUnitsToDate);
              return (
                <Typography key={channel} variant="body2" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
                  <Box component="span" sx={{ display: "block", fontWeight: 600, color: "text.primary" }}>
                    {channel}
                  </Box>
                  <Box component="span" sx={{ display: "block" }}>
                    {formatNumber(detail.actualUnitsToDate)} unités déjà vendues (réel)
                  </Box>
                  <Box component="span" sx={{ display: "block" }}>
                    + [{detail.baseUnitsRate.toFixed(2)} u/j de base × jours restants pondérés par jour de semaine
                    {detail.dowTrusted ? "" : " (à parts égales, historique insuffisant)"} × ×
                    {detail.seasonalIndex.toFixed(2)} saisonnalité × ×{detail.growthFactor.toFixed(2)} croissance]
                  </Box>
                  <Box component="span" sx={{ display: "block", fontWeight: 600, color: "text.primary" }}>
                    = {formatNumber(channelExtrapolated)} unités extrapolées, = {formatCurrency(detail.predictedRevenue)}
                  </Box>
                </Typography>
              );
            })}
            <Divider sx={{ my: 1 }} />
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              Total = {formatNumber(forecast.predictedUnits)} unités = {formatCurrency(forecast.predictedRevenue)}
            </Typography>
          </AccordionDetails>
        </Accordion>
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

  const categories = await getCategoryList();
  const [currentMonthForecast, nextMonthForecast, accuracy, allScopes] = await Promise.all([
    forecastForScope(scope, scopeKey, now.getUTCFullYear(), now.getUTCMonth() + 1, now),
    forecastForScope(scope, scopeKey, nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1, now),
    getForecastAccuracy(scope, scopeKey),
    forecastAllScopes(categories, now),
  ]);

  const overviewRows: ForecastOverviewRow[] = allScopes.map((row) => ({
    ...row,
    id: row.scopeKey,
    href: row.scope === "GLOBAL" ? "/previsions" : `/previsions?category=${encodeURIComponent(row.scopeKey)}`,
  }));

  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Prévisions de ventes
        </Typography>
        <ForecastMethodologyDialog />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Chaque prévision combine les ventes déjà réelles du mois (jamais ré-estimées) et une extrapolation UNIQUEMENT
        sur les jours restants : la part réelle grandit et la part extrapolée rétrécit mécaniquement chaque jour, ce
        qui rend la prévision plus précise à mesure que le mois avance.
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Vue d&apos;ensemble : global + toutes les catégories
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Triable par colonne. Cliquez un périmètre pour voir son détail complet ci-dessous.
          </Typography>
          <ForecastOverviewTable rows={overviewRows} />
        </CardContent>
      </Card>

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
