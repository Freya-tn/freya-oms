import { Card, CardContent, Grid, Typography } from "@mui/material";
import Inventory2Icon from "@mui/icons-material/Inventory2Outlined";
import ReportProblemIcon from "@mui/icons-material/ReportProblemOutlined";
import PaidIcon from "@mui/icons-material/PaidOutlined";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLongOutlined";
import CancelIcon from "@mui/icons-material/CancelOutlined";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCartOutlined";
import HourglassBottomIcon from "@mui/icons-material/HourglassBottomOutlined";
import { getOverviewKpis } from "@/lib/insights/overview";
import { getRevenueTrend } from "@/lib/insights/orderTrend";
import { getLastSyncStatus } from "@/lib/insights/syncStatus";
import { parsePeriodParam } from "@/lib/filterParams";
import { formatCurrency } from "@/lib/format";
import { KpiCard } from "@/components/KpiCard";
import { RevenueTrendChart } from "@/components/RevenueTrendChart";
import { FilterBar } from "@/components/FilterBar";
import { SyncStatusBar } from "@/components/SyncStatusBar";

export const dynamic = "force-dynamic";

const TREND_WINDOW_DAYS = 60;
const DEFAULT_WINDOW_DAYS = 30;
const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const params = await searchParams;
  const windowDays = parsePeriodParam(params.window, DEFAULT_WINDOW_DAYS);

  const [kpis, revenueTrend, syncStatuses] = await Promise.all([
    getOverviewKpis(windowDays),
    getRevenueTrend(TREND_WINDOW_DAYS),
    getLastSyncStatus(),
  ]);
  const revenue7d = kpis.totals7d.reduce((sum, t) => sum + t.revenue, 0);

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Overview
      </Typography>

      <SyncStatusBar statuses={syncStatuses} />

      <FilterBar vendors={[]} showVendorFilter={false} defaultPeriod={DEFAULT_WINDOW_DAYS} />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            label="Valeur du stock"
            value={formatCurrency(kpis.stockValue)}
            icon={<Inventory2Icon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            label="Variantes en rupture"
            value={String(kpis.outOfStockCount)}
            color={kpis.outOfStockCount > 0 ? "error" : undefined}
            icon={<ReportProblemIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard label="CA confirmé (7j)" value={formatCurrency(revenue7d)} icon={<PaidIcon />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            label={`CA confirmé (${windowDays}j)`}
            value={formatCurrency(kpis.revenue.current)}
            changeRatio={kpis.revenue.changeRatio}
            icon={<PaidIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            label={`Panier moyen (${windowDays}j)`}
            value={kpis.averageOrderValue !== null ? formatCurrency(kpis.averageOrderValue) : "-"}
            icon={<ReceiptLongIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            label={`Taux d'annulation (${windowDays}j)`}
            value={kpis.cancellationRate !== null ? percentFormatter.format(kpis.cancellationRate) : "-"}
            color={kpis.cancellationRate !== null && kpis.cancellationRate > 0.3 ? "warning" : undefined}
            changeRatio={
              kpis.cancellationRate !== null && kpis.cancellationRatePrevious !== null && kpis.cancellationRatePrevious > 0
                ? (kpis.cancellationRate - kpis.cancellationRatePrevious) / kpis.cancellationRatePrevious
                : null
            }
            higherIsBetter={false}
            icon={<CancelIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            label="Alertes réappro"
            value={String(kpis.reorderAlertsCount)}
            subtext={kpis.reorderCriticalCount > 0 ? `dont ${kpis.reorderCriticalCount} en rupture` : undefined}
            color={kpis.reorderCriticalCount > 0 ? "error" : kpis.reorderAlertsCount > 0 ? "warning" : undefined}
            href="/reorder"
            icon={<ShoppingCartIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            label="Produits dormants"
            value={String(kpis.dormantCount)}
            subtext={formatCurrency(kpis.dormantValue) + " immobilisés"}
            color={kpis.dormantCount > 0 ? "warning" : undefined}
            href="/dormants"
            icon={<HourglassBottomIcon />}
          />
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            CA confirmé ({TREND_WINDOW_DAYS} derniers jours)
          </Typography>
          <RevenueTrendChart data={revenueTrend} />
        </CardContent>
      </Card>
    </>
  );
}
