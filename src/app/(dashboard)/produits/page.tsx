import { Card, CardContent, Grid, Typography } from "@mui/material";
import { getAbcClassification } from "@/lib/insights/abc";
import { getVendorBreakdown } from "@/lib/insights/vendorBreakdown";
import { getRevenueByProduct, getRevenueByCategory } from "@/lib/insights/productBreakdown";
import { getVendorList } from "@/lib/insights/filters";
import { parsePeriodParam, parseVendorParam } from "@/lib/filterParams";
import { AbcTable } from "@/components/AbcTable";
import { BarListChart } from "@/components/BarListChart";
import { FilterBar } from "@/components/FilterBar";

export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_DAYS = 90;
const TOP_N = 8;

export default async function ProduitsPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; window?: string }>;
}) {
  const params = await searchParams;
  const vendor = parseVendorParam(params.vendor);
  const windowDays = parsePeriodParam(params.window, DEFAULT_WINDOW_DAYS);

  const [abcRows, vendorRows, productRows, categoryRows, vendors] = await Promise.all([
    getAbcClassification(windowDays, { vendor }),
    getVendorBreakdown(windowDays),
    getRevenueByProduct(windowDays, { vendor }),
    getRevenueByCategory(windowDays, { vendor }),
    getVendorList(),
  ]);

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Produits
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Classification ABC (Pareto) et répartitions par produit, catégorie et marque. Commandes confirmées uniquement.
      </Typography>

      <FilterBar vendors={vendors} defaultPeriod={DEFAULT_WINDOW_DAYS} />

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                Top produits
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
                Toutes tailles confondues
              </Typography>
              <BarListChart
                items={productRows.map((row) => ({ id: row.productId, label: row.productTitle, value: row.revenue }))}
                limit={TOP_N}
                valueType="currency"
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                CA par catégorie
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
                Type de produit Shopify
              </Typography>
              <BarListChart
                items={categoryRows.map((row) => ({ id: row.category, label: row.category, value: row.revenue }))}
                limit={TOP_N}
                valueType="currency"
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                CA par marque
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
                Toutes marques, période sélectionnée
              </Typography>
              <BarListChart
                items={vendorRows.map((row) => ({ id: row.vendor, label: row.vendor, value: row.revenue }))}
                limit={TOP_N}
                valueType="currency"
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Typography variant="h6" gutterBottom>
        Classification ABC complète (par variante)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Détail par SKU (tailles séparées), nécessaire pour les décisions de réapprovisionnement (voir la page
        Réapprovisionnement).
      </Typography>
      <AbcTable rows={abcRows} />
    </>
  );
}
