import { Alert, Box, Card, CardContent, Divider, Grid, Typography } from "@mui/material";
import {
  getReorderSuggestions,
  groupReorderByVendor,
  LEAD_TIME_DAYS,
  SAFETY_STOCK_DAYS,
  TARGET_COVERAGE_DAYS,
} from "@/lib/insights/reorder";
import { getVendorList } from "@/lib/insights/filters";
import { getSeasonalIndices } from "@/lib/insights/forecast";
import { parseCoverageParam, parseVendorParam } from "@/lib/filterParams";
import { ReorderTable, type CategorySeasonality } from "@/components/ReorderTable";
import { FilterBar } from "@/components/FilterBar";
import { SupplierOrderSummaryTable } from "@/components/SupplierOrderSummary";
import { TopUrgencyChart } from "@/components/TopUrgencyChart";
import { CoverageControl } from "@/components/CoverageControl";
import { ExportReorderCsvButton } from "@/components/ExportReorderCsvButton";

export const dynamic = "force-dynamic";

export default async function ReorderPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; coverage?: string }>;
}) {
  const params = await searchParams;
  const vendor = parseVendorParam(params.vendor);
  const targetCoverageDays = parseCoverageParam(params.coverage, TARGET_COVERAGE_DAYS);

  const [rows, vendors] = await Promise.all([
    getReorderSuggestions({ vendor, targetCoverageDays }),
    getVendorList(),
  ]);
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
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Variantes qui se vendent activement et qui ont atteint ou dépassé leur seuil de réapprovisionnement.
        Hypothèses v1 (à ajuster avec l&apos;équipe, voir docs/INSIGHTS.md) : délai fournisseur {LEAD_TIME_DAYS}j,
        stock de sécurité {SAFETY_STOCK_DAYS}j.
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            Filtres &amp; paramètres
          </Typography>
          <FilterBar vendors={vendors} showPeriodFilter={false} defaultPeriod={30} />
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

          <ReorderTable rows={rows} categorySeasonality={categorySeasonality} />
        </>
      )}
    </>
  );
}
