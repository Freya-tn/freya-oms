import { Card, CardContent, Grid, Typography } from "@mui/material";
import PaidIcon from "@mui/icons-material/PaidOutlined";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOffOutlined";
import { getSaleTypeTotals, getTopProductsBySaleType } from "@/lib/insights/blackMarketComparison";
import { getVendorList } from "@/lib/insights/filters";
import { parsePeriodParam, parseVendorParam } from "@/lib/filterParams";
import { SALE_TYPE_COLOR } from "@/lib/theme/chartColors";
import { formatCurrency } from "@/lib/format";
import { FilterBar } from "@/components/FilterBar";
import { KpiCard } from "@/components/KpiCard";
import { BarListChart } from "@/components/BarListChart";

export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_DAYS = 30;
const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });

const SALE_TYPE_LABEL: Record<"DECLARED" | "BLACK", string> = {
  DECLARED: "Déclaré",
  BLACK: "Black",
};

export default async function BlackMarketPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; window?: string }>;
}) {
  const params = await searchParams;
  const vendor = parseVendorParam(params.vendor);
  const windowDays = parsePeriodParam(params.window, DEFAULT_WINDOW_DAYS);

  const [totals, topProducts, vendors] = await Promise.all([
    getSaleTypeTotals(windowDays, { vendor }),
    getTopProductsBySaleType(windowDays, 5, { vendor }),
    getVendorList(),
  ]);

  const black = totals.find((t) => t.saleType === "BLACK");
  const declared = totals.find((t) => t.saleType === "DECLARED");
  const totalRevenue = (black?.revenue ?? 0) + (declared?.revenue ?? 0);
  const blackRatio = totalRevenue > 0 ? (black?.revenue ?? 0) / totalRevenue : null;

  const revenueItems = totals.map((t) => ({
    id: t.saleType,
    label: SALE_TYPE_LABEL[t.saleType],
    value: t.revenue,
    color: SALE_TYPE_COLOR[t.saleType],
  }));
  const unitsItems = totals.map((t) => ({
    id: t.saleType,
    label: SALE_TYPE_LABEL[t.saleType],
    value: t.units,
    color: SALE_TYPE_COLOR[t.saleType],
  }));

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Déclaré vs black
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Ventes dont le SKU commence par &quot;B_&quot; (vente non déclarée), comparées au reste du catalogue. Commandes
        confirmées uniquement. Dimension indépendante du canal B2B/B2C : une commande peut mélanger les deux.
      </Typography>

      <FilterBar vendors={vendors} defaultPeriod={DEFAULT_WINDOW_DAYS} />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <KpiCard
            label={`CA black (${windowDays}j)`}
            value={formatCurrency(black?.revenue ?? 0)}
            color={black && black.revenue > 0 ? "warning" : undefined}
            icon={<VisibilityOffIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <KpiCard
            label={`CA déclaré (${windowDays}j)`}
            value={formatCurrency(declared?.revenue ?? 0)}
            icon={<PaidIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <KpiCard
            label="Part du black dans le CA"
            value={blackRatio !== null ? percentFormatter.format(blackRatio) : "-"}
            color={blackRatio !== null && blackRatio > 0 ? "warning" : undefined}
            icon={<VisibilityOffIcon />}
          />
        </Grid>
      </Grid>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={4}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                CA ({windowDays} derniers jours)
              </Typography>
              <BarListChart items={revenueItems} valueType="currency" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                Unités vendues ({windowDays} derniers jours)
              </Typography>
              <BarListChart items={unitsItems} valueType="units" />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        {(["DECLARED", "BLACK"] as const).map((saleType) => (
          <Grid key={saleType} size={{ xs: 12, md: 6 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                  Top produits : {SALE_TYPE_LABEL[saleType]}
                </Typography>
                <BarListChart
                  items={topProducts[saleType].map((row) => ({
                    id: row.variantId,
                    label: `${row.productTitle} (${row.title})`,
                    sublabel: `${row.units} unités`,
                    value: row.revenue,
                    color: SALE_TYPE_COLOR[saleType],
                  }))}
                  valueType="currency"
                  emptyLabel="Aucune vente confirmée sur la période."
                />
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </>
  );
}
