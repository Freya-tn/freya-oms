import { Card, CardContent, Grid, Typography } from "@mui/material";
import { getChannelTotals, getTopProductsByChannel } from "@/lib/insights/channelComparison";
import { getRevenueTrend } from "@/lib/insights/orderTrend";
import { getMarginByChannel } from "@/lib/insights/margin";
import { getVendorList } from "@/lib/insights/filters";
import { parsePeriodParam, parseVendorParam } from "@/lib/filterParams";
import { CHANNEL_COLOR } from "@/lib/theme/chartColors";
import { RevenueTrendChart } from "@/components/RevenueTrendChart";
import { FilterBar } from "@/components/FilterBar";
import { BarListChart } from "@/components/BarListChart";

export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_DAYS = 30;
const TREND_WINDOW_DAYS = 90;
const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });

export default async function B2bB2cPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; window?: string }>;
}) {
  const params = await searchParams;
  const vendor = parseVendorParam(params.vendor);
  const windowDays = parsePeriodParam(params.window, DEFAULT_WINDOW_DAYS);

  const [totals, topProducts, revenueTrend, marginByChannel, vendors] = await Promise.all([
    getChannelTotals(windowDays, { vendor }),
    getTopProductsByChannel(windowDays, 5, { vendor }),
    getRevenueTrend(TREND_WINDOW_DAYS),
    getMarginByChannel(windowDays, { vendor }),
    getVendorList(),
  ]);

  const revenueItems = totals.map((t) => ({ id: t.channel, label: t.channel, value: t.revenue, color: CHANNEL_COLOR[t.channel] }));
  const unitsItems = totals.map((t) => ({ id: t.channel, label: t.channel, value: t.units, color: CHANNEL_COLOR[t.channel] }));
  const marginItems = marginByChannel.map((m) => ({
    id: m.channel,
    label: m.channel,
    sublabel:
      m.marginRate !== null
        ? `${percentFormatter.format(m.marginRate)} de marge (calculée sur ${percentFormatter.format(m.costCoverage)} du CA, le reste n'a pas de coût connu)`
        : "coût non renseigné sur Shopify : marge impossible à calculer",
    value: m.margin,
    color: CHANNEL_COLOR[m.channel],
  }));

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        B2B vs B2C
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Commandes confirmées uniquement.
      </Typography>

      <FilterBar vendors={vendors} defaultPeriod={DEFAULT_WINDOW_DAYS} />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            CA confirmé ({TREND_WINDOW_DAYS} derniers jours)
          </Typography>
          <RevenueTrendChart data={revenueTrend} />
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={4}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                CA ({windowDays} derniers jours)
              </Typography>
              <BarListChart items={revenueItems} valueType="currency" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                Unités vendues ({windowDays} derniers jours)
              </Typography>
              <BarListChart items={unitsItems} valueType="units" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                Marge ({windowDays} derniers jours)
              </Typography>
              <BarListChart items={marginItems} valueType="currency" />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        {(["B2B", "B2C"] as const).map((channel) => (
          <Grid key={channel} size={{ xs: 12, md: 6 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                  Top produits : {channel}
                </Typography>
                <BarListChart
                  items={topProducts[channel].map((row) => ({
                    id: row.variantId,
                    label: `${row.productTitle} (${row.title})`,
                    sublabel: `${row.units} unités`,
                    value: row.revenue,
                    color: CHANNEL_COLOR[channel],
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
