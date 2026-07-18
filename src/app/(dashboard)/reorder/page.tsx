import { Alert, Box, Card, CardContent, Divider, Grid, Typography } from "@mui/material";
import {
  getReorderSuggestionsDetailed,
  groupReorderByVendor,
  REORDER_SAFETY_DELAY_DAYS,
  TARGET_COVERAGE_DAYS,
  VELOCITY_WINDOW_DAYS,
} from "@/lib/insights/reorder";
import { getInventoryHistoryDepthDays } from "@/lib/insights/velocity";
import { getVendorList } from "@/lib/insights/filters";
import { getSeasonalIndices } from "@/lib/insights/forecast";
import { parseAnalysisWindowParam, parseCoverageParam, parseVendorParam } from "@/lib/filterParams";
import { ReorderTable, type CategorySeasonality } from "@/components/ReorderTable";
import { FilterBar } from "@/components/FilterBar";
import { SupplierOrderSummaryTable } from "@/components/SupplierOrderSummary";
import { TopUrgencyChart } from "@/components/TopUrgencyChart";
import { CoverageControl } from "@/components/CoverageControl";
import { AnalysisWindowControl } from "@/components/AnalysisWindowControl";
import { ExportReorderCsvButton } from "@/components/ExportReorderCsvButton";
import { HistoryDepthNotice } from "@/components/HistoryDepthNotice";

export const dynamic = "force-dynamic";

export default async function ReorderPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; coverage?: string; window?: string }>;
}) {
  const params = await searchParams;
  const vendor = parseVendorParam(params.vendor);
  const targetCoverageDays = parseCoverageParam(params.coverage, TARGET_COVERAGE_DAYS);
  const windowDays = parseAnalysisWindowParam(params.window, VELOCITY_WINDOW_DAYS);

  const [{ rows, insufficientDataCount }, vendors, historyDepthDays] = await Promise.all([
    getReorderSuggestionsDetailed({ vendor, targetCoverageDays, windowDays }),
    getVendorList(),
    getInventoryHistoryDepthDays(),
  ]);
  const notReady = historyDepthDays < windowDays;
  const supplierSummary = groupReorderByVendor(rows);

  // Chip informatif (lecture seule, n'entre dans AUCUN calcul ci-dessus) :
  // saisonnalité du mois PROCHAIN pour chaque catégorie présente dans les
  // suggestions — le réappro décidé aujourd'hui sera vendu dans les semaines
  // à venir, pas ce mois-ci. Voir docs/INSIGHTS.md, "Prévisions de ventes".
  const now = new Date();
  const nextMonth = ((now.getUTCMonth() + 1) % 12) + 1;
  const categories = [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))];
  const categorySeasonality: Record<string, CategorySeasonality> = {};
  await Promise.all(
    categories.map(async (category) => {
      const indices = await getSeasonalIndices("CATEGORY", category, now);
      const entry = indices[nextMonth - 1];
      categorySeasonality[category] = { index: entry.index, trusted: entry.trusted };
    }),
  );

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Réapprovisionnement
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Comment ça marche : pour chaque variante, on calcule sa vitesse de vente sur les {windowDays} derniers
        jours où elle a réellement eu du stock (pas {windowDays} jours calendaires bruts) - un produit en rupture
        une partie de la période n&apos;est jamais pénalisé pour ça. Le seuil de réappro = cette vitesse ×{" "}
        {REORDER_SAFETY_DELAY_DAYS}j (délai de sécurité fournisseur + marge, hypothèse globale v1, à ajuster avec
        l&apos;équipe une fois une donnée réelle par fournisseur disponible). La quantité suggérée couvre{" "}
        {targetCoverageDays}j de vente au-delà du stock actuel. Seules les variantes qui se vendent réellement ET
        dont on a assez de recul apparaissent ici.
      </Typography>

      {notReady ? (
        <HistoryDepthNotice historyDepthDays={historyDepthDays} requiredDays={windowDays} />
      ) : (
        <>
          {insufficientDataCount > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {insufficientDataCount} variante(s) volontairement exclue(s) : pas encore {windowDays}j de
              disponibilité réelle recensés en historique (variante récente, ou historique de stock encore trop
              court côté outil) - on préfère ne rien suggérer plutôt qu&apos;une quantité basée sur un signal trop
              court.
            </Alert>
          )}

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
                Filtres &amp; paramètres
              </Typography>
              <FilterBar vendors={vendors} showPeriodFilter={false} defaultPeriod={30} />
              <Divider sx={{ my: 2 }} />
              <AnalysisWindowControl defaultValue={windowDays} />
              <Divider sx={{ my: 2 }} />
              <CoverageControl defaultValue={targetCoverageDays} />
            </CardContent>
          </Card>

          {rows.length === 0 ? (
            <Alert severity="success">Aucune variante n&apos;a besoin d&apos;être réapprovisionnée pour le moment.</Alert>
          ) : (
            <>
              <Grid container spacing={3} sx={{ mb: 3 }}>
                <Grid size={{ xs: 12, md: 5 }}>
                  <Card sx={{ height: "100%" }}>
                    <CardContent>
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 1 }}>
                        <Typography variant="h6" gutterBottom sx={{ mb: 0 }}>
                          Commandes à passer par fournisseur
                        </Typography>
                        <ExportReorderCsvButton rows={rows} />
                      </Box>
                      <SupplierOrderSummaryTable rows={supplierSummary} />
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 12, md: 7 }}>
                  <Card sx={{ height: "100%" }}>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Top urgences
                      </Typography>
                      <TopUrgencyChart data={rows} />
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>

              <ReorderTable rows={rows} categorySeasonality={categorySeasonality} windowDays={windowDays} />
            </>
          )}
        </>
      )}
    </>
  );
}
