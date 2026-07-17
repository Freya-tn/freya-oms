import { Card, CardContent, Grid, Typography } from "@mui/material";
import { getAbcClassification } from "@/lib/insights/abc";
import { getVendorBreakdown } from "@/lib/insights/vendorBreakdown";
import { getRevenueByProduct, getRevenueByCategory } from "@/lib/insights/productBreakdown";
import { getMarginByProduct, getMarginByVendor, getAbcClassificationByMargin } from "@/lib/insights/margin";
import { getVendorList } from "@/lib/insights/filters";
import { parsePeriodParam, parseVendorParam } from "@/lib/filterParams";
import { formatNumber } from "@/lib/format";
import { AbcTable } from "@/components/AbcTable";
import { MarginAbcTable } from "@/components/MarginAbcTable";
import { BarListChart } from "@/components/BarListChart";
import { FilterBar } from "@/components/FilterBar";

export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_DAYS = 90;
const TOP_N = 8;
const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });

export default async function ProduitsPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; window?: string }>;
}) {
  const params = await searchParams;
  const vendor = parseVendorParam(params.vendor);
  const windowDays = parsePeriodParam(params.window, DEFAULT_WINDOW_DAYS);

  const [abcRows, vendorRows, productRows, categoryRows, marginByProduct, marginByVendor, marginAbc, vendors] =
    await Promise.all([
      getAbcClassification(windowDays, { vendor }),
      getVendorBreakdown(windowDays),
      getRevenueByProduct(windowDays, { vendor }),
      getRevenueByCategory(windowDays, { vendor }),
      getMarginByProduct(windowDays, { vendor }),
      getMarginByVendor(windowDays),
      getAbcClassificationByMargin(windowDays, { vendor }),
      getVendorList(),
    ]);

  const topMarginByProduct = [...marginByProduct].sort((a, b) => b.margin - a.margin);
  const topMarginByVendor = [...marginByVendor].sort((a, b) => b.margin - a.margin);

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
        Marge
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        CA net de coût de revient, calculé uniquement sur les lignes dont le coût est renseigné côté Shopify (jamais un
        coût manquant traité comme 0). Le sous-titre indique la part du CA réellement couverte par un coût connu.
      </Typography>
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                Marge par marque
              </Typography>
              <BarListChart
                items={topMarginByVendor.map((row) => ({
                  id: row.id,
                  label: row.label,
                  sublabel:
                    row.marginRate !== null
                      ? `${percentFormatter.format(row.marginRate)} de marge · ${percentFormatter.format(row.costCoverage)} du CA couvert`
                      : "coût non renseigné",
                  value: row.margin,
                }))}
                limit={TOP_N}
                valueType="currency"
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                Marge par produit
              </Typography>
              <BarListChart
                items={topMarginByProduct.map((row) => ({
                  id: row.id,
                  label: row.label,
                  sublabel:
                    row.marginRate !== null
                      ? `${percentFormatter.format(row.marginRate)} de marge · ${percentFormatter.format(row.costCoverage)} du CA couvert`
                      : "coût non renseigné",
                  value: row.margin,
                }))}
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
        Réapprovisionnement). Classement par CA : un top-vendeur n&apos;est pas forcément le plus rentable, voir le
        classement par marge ci-dessous.
      </Typography>
      <AbcTable rows={abcRows} />

      <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
        Classification ABC par marge (par variante)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Même logique de Pareto, mais classée par marge plutôt que par CA.
        {marginAbc.excludedVariantCount > 0 &&
          ` ${formatNumber(marginAbc.excludedVariantCount)} variante(s) sans coût renseigné exclue(s) de ce classement (impossible de les classer par marge sans supposer un coût de 0).`}
      </Typography>
      <MarginAbcTable rows={marginAbc.rows} />
    </>
  );
}
