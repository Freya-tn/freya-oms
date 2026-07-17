import { Card, CardContent, Grid, Typography } from "@mui/material";
import { getAbcClassification } from "@/lib/insights/abc";
import { getVendorBreakdown } from "@/lib/insights/vendorBreakdown";
import { getRevenueByProduct, getRevenueByCategory } from "@/lib/insights/productBreakdown";
import { getMarginByProduct, getMarginByVendor, getAbcClassificationByMargin } from "@/lib/insights/margin";
import { getVendorList } from "@/lib/insights/filters";
import { parsePeriodParam, parseVendorParam } from "@/lib/filterParams";
import { formatNumber, formatMarginSublabel } from "@/lib/format";
import { AbcTable } from "@/components/AbcTable";
import { MarginAbcTable } from "@/components/MarginAbcTable";
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
        Marge (ce qui reste après avoir payé le produit)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Marge = chiffre d&apos;affaires moins le coût d&apos;achat du produit (le prix payé au fournisseur). Un produit
        peut faire beaucoup de CA (voir &quot;Top produits&quot; ci-dessus) tout en étant peu rentable, et inversement.
        Ce calcul n&apos;est possible que sur les ventes dont le coût est renseigné sur Shopify : quand ce n&apos;est
        pas le cas pour une partie des ventes, le taux de marge affiché précise entre parenthèses sur quelle part du CA
        il est réellement basé, pour ne jamais laisser croire à une rentabilité connue à 100%.
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
                  sublabel: formatMarginSublabel(row.marginRate, row.costCoverage),
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
                  sublabel: formatMarginSublabel(row.marginRate, row.costCoverage),
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
        Classement des produits par importance dans le CA (par variante)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Chaque variante (taille/format compris) est classée en 3 groupes selon sa contribution au chiffre
        d&apos;affaires total : <strong>A</strong> regroupe les produits qui, ensemble, font déjà 80% du CA - à ne
        jamais laisser en rupture ; <strong>B</strong> les 15% suivants ; <strong>C</strong> le reste, une
        contribution marginale. Utile pour les décisions de réapprovisionnement (voir la page Réapprovisionnement).
        Attention : un produit qui vend beaucoup (tier A) n&apos;est pas forcément celui qui rapporte le plus une fois
        son coût déduit - voir le classement par marge ci-dessous.
      </Typography>
      <AbcTable rows={abcRows} />

      <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
        Le même classement, mais par rentabilité réelle (marge) plutôt que par CA
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Mêmes groupes A/B/C qu&apos;au-dessus (A = les produits qui font ensemble 80% de la marge totale, B = les 15%
        suivants, C = le reste), mais triés par ce qui reste après avoir payé le coût du produit, pas par ce qui a été
        vendu. Un produit qui se vend beaucoup peut très bien ne pas être ici en tier A si sa marge réelle est faible.
        {marginAbc.excludedVariantCount > 0 &&
          ` ${formatNumber(marginAbc.excludedVariantCount)} variante(s) sans coût renseigné sur Shopify sont exclues de ce classement (impossible de calculer une marge sans connaître le coût réel).`}
      </Typography>
      <MarginAbcTable rows={marginAbc.rows} />
    </>
  );
}
