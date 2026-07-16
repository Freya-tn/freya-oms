import { Card, CardContent, Grid, Typography } from "@mui/material";
import PaidIcon from "@mui/icons-material/PaidOutlined";
import Inventory2Icon from "@mui/icons-material/Inventory2Outlined";
import HourglassBottomIcon from "@mui/icons-material/HourglassBottomOutlined";
import ReportProblemIcon from "@mui/icons-material/ReportProblemOutlined";
import { getDormantStock, getHistoryStartDate, groupDormantValueByVendor, summarizeDormantStock } from "@/lib/insights/dormant";
import { getVendorList } from "@/lib/insights/filters";
import { parseVendorParam } from "@/lib/filterParams";
import { formatCurrency, formatDate } from "@/lib/format";
import { DormantTable } from "@/components/DormantTable";
import { FilterBar } from "@/components/FilterBar";
import { BarListChart } from "@/components/BarListChart";
import { KpiCard } from "@/components/KpiCard";

export const dynamic = "force-dynamic";

export default async function DormantsPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string }>;
}) {
  const params = await searchParams;
  const vendor = parseVendorParam(params.vendor);

  const [rows, vendors, historyStart] = await Promise.all([
    getDormantStock({ vendor }),
    getVendorList(),
    getHistoryStartDate(),
  ]);
  const summary = summarizeDormantStock(rows);
  const vendorValues = groupDormantValueByVendor(rows);

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Produits dormants / surstock
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Variantes à rotation quasi nulle sur 60 jours, triées par valeur de stock immobilisée : de l&apos;argent déjà
        sorti pour acheter ce stock, qui ne revient pas tant qu&apos;il ne se vend pas.
      </Typography>

      <FilterBar vendors={vendors} showPeriodFilter={false} defaultPeriod={60} />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard label="Argent immobilisé" value={formatCurrency(summary.totalValue)} color="warning" icon={<PaidIcon />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard label="Variantes dormantes" value={String(summary.variantCount)} icon={<Inventory2Icon />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            label="Jamais vendues"
            value={String(summary.neverSoldCount)}
            subtext={historyStart ? `depuis le ${formatDate(historyStart)}` : undefined}
            color={summary.neverSoldCount > 0 ? "error" : undefined}
            icon={<ReportProblemIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            label="Valeur moyenne / variante"
            value={formatCurrency(summary.averageValue)}
            icon={<HourglassBottomIcon />}
          />
        </Grid>
      </Grid>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
            Argent immobilisé par marque
          </Typography>
          <BarListChart
            items={vendorValues.map((v) => ({ id: v.vendor, label: v.vendor, value: v.value }))}
            limit={8}
            valueType="currency"
          />
        </CardContent>
      </Card>

      <DormantTable rows={rows} />
    </>
  );
}
