import { Box, Card, CardContent, Grid, Typography } from "@mui/material";
import { getChannelTotals, getMonthlyChannelBreakdown, getTopProductsByChannel } from "@/lib/insights/channelComparison";
import { getRevenueTrend } from "@/lib/insights/orderTrend";
import { getMarginByChannel } from "@/lib/insights/margin";
import { getVendorList } from "@/lib/insights/filters";
import { parsePeriodParam, parseVendorParam, parseYearParam } from "@/lib/filterParams";
import { CHANNEL_COLOR } from "@/lib/theme/chartColors";
import { formatCurrency, formatMarginSublabel } from "@/lib/format";
import { RevenueTrendChart } from "@/components/RevenueTrendChart";
import { FilterBar } from "@/components/FilterBar";
import { BarListChart } from "@/components/BarListChart";
import { MonthlyChannelChart } from "@/components/MonthlyChannelChart";
import { YearSelector } from "@/components/YearSelector";

export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_DAYS = 30;

export default async function B2bB2cPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; window?: string; year?: string }>;
}) {
  const params = await searchParams;
  const vendor = parseVendorParam(params.vendor);
  const windowDays = parsePeriodParam(params.window, DEFAULT_WINDOW_DAYS);
  const currentYear = new Date().getUTCFullYear();
  const year = parseYearParam(params.year, currentYear);

  const [totals, topProducts, revenueTrend, marginByChannel, vendors, monthlyChannel] = await Promise.all([
    getChannelTotals(windowDays, { vendor }),
    getTopProductsByChannel(windowDays, 5, { vendor }),
    getRevenueTrend(windowDays, { vendor }),
    getMarginByChannel(windowDays, { vendor }),
    getVendorList(),
    getMonthlyChannelBreakdown(year, { vendor }),
  ]);

  const revenueItems = totals.map((t) => ({ id: t.channel, label: t.channel, value: t.revenue, color: CHANNEL_COLOR[t.channel] }));
  const unitsItems = totals.map((t) => ({ id: t.channel, label: t.channel, value: t.units, color: CHANNEL_COLOR[t.channel] }));
  const marginItems = marginByChannel.map((m) => ({
    id: m.channel,
    label: m.channel,
    sublabel: formatMarginSublabel(m.marginRate, m.costCoverage),
    value: m.margin,
    color: CHANNEL_COLOR[m.channel],
  }));

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        B2B vs B2C
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Comment ça marche : une commande est B2B si elle porte le tag Shopify &quot;B2B&quot;, B2C sinon - dérivé une seule
        fois à la synchro, jamais recalculé ici. Commandes confirmées uniquement (paiement à la livraison :
        beaucoup de commandes non confirmées/annulées sont exclues). Le CA sans filtre marque correspond
        exactement aux rapports Shopify ; avec un filtre marque, il est recalculé ligne par ligne (légère
        sous-estimation possible des remises panier non allouées par Shopify au niveau produit). Toutes les
        courbes et tableaux ci-dessous suivent les filtres marque/période choisis.
      </Typography>

      <FilterBar vendors={vendors} defaultPeriod={DEFAULT_WINDOW_DAYS} />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            CA confirmé ({windowDays} derniers jours)
          </Typography>
          <RevenueTrendChart data={revenueTrend} />
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2, mb: 2 }}>
            <Typography variant="h6" sx={{ mb: 0 }}>
              Moyenne mensuelle par canal
            </Typography>
            <YearSelector years={[...new Set([...monthlyChannel.availableYears, year])].sort((a, b) => b - a)} value={year} />
          </Box>
          <Grid container spacing={4} sx={{ mb: 2 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="overline" color="text.secondary">
                B2B, moyenne / mois ({year}
                {monthlyChannel.monthsWithData < 12 ? `, sur ${monthlyChannel.monthsWithData} mois` : ""})
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, color: CHANNEL_COLOR.B2B }}>
                {formatCurrency(monthlyChannel.avgPerMonth.B2B)}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="overline" color="text.secondary">
                B2C, moyenne / mois ({year}
                {monthlyChannel.monthsWithData < 12 ? `, sur ${monthlyChannel.monthsWithData} mois` : ""})
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, color: CHANNEL_COLOR.B2C }}>
                {formatCurrency(monthlyChannel.avgPerMonth.B2C)}
              </Typography>
            </Grid>
          </Grid>
          <MonthlyChannelChart data={monthlyChannel.points} />
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
