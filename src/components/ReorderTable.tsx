"use client";

import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { Chip, Tooltip } from "@mui/material";
import ReportProblemIcon from "@mui/icons-material/ReportProblemOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmberOutlined";
import ScheduleIcon from "@mui/icons-material/ScheduleOutlined";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingFlatIcon from "@mui/icons-material/TrendingFlat";
import FiberNewIcon from "@mui/icons-material/FiberNew";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import { STATUS } from "@/lib/theme/chartColors";
import type { DemandTrend, ReorderRow, ReorderUrgency } from "@/lib/insights/reorder";

const URGENCY_META: Record<ReorderUrgency, { label: string; color: string; icon: React.ReactElement }> = {
  critical: { label: "Rupture", color: STATUS.critical, icon: <ReportProblemIcon fontSize="small" /> },
  serious: { label: "Urgent", color: STATUS.serious, icon: <WarningAmberIcon fontSize="small" /> },
  warning: { label: "À commander", color: STATUS.warning, icon: <ScheduleIcon fontSize="small" /> },
  good: { label: "OK", color: STATUS.good, icon: <ScheduleIcon fontSize="small" /> },
};

const TREND_META: Record<DemandTrend, { label: string; icon: React.ReactElement; color: string }> = {
  up: { label: "Demande en hausse (vs 30j précédents)", icon: <TrendingUpIcon fontSize="small" />, color: STATUS.good },
  down: { label: "Demande en baisse (vs 30j précédents)", icon: <TrendingDownIcon fontSize="small" />, color: STATUS.serious },
  stable: { label: "Demande stable", icon: <TrendingFlatIcon fontSize="small" />, color: "text.secondary" },
  new: { label: "Nouvelle demande (rien il y a 30-60j)", icon: <FiberNewIcon fontSize="small" />, color: STATUS.good },
  unknown: { label: "Historique insuffisant", icon: <HelpOutlineIcon fontSize="small" />, color: "text.secondary" },
};

const columns: GridColDef<ReorderRow>[] = [
  {
    field: "urgency",
    headerName: "Urgence",
    width: 150,
    renderCell: (params) => {
      const meta = URGENCY_META[params.value as ReorderUrgency];
      return (
        <Chip
          icon={meta.icon}
          label={meta.label}
          size="small"
          sx={{ bgcolor: meta.color, color: "#fff", "& .MuiChip-icon": { color: "#fff" } }}
        />
      );
    },
  },
  {
    field: "trend",
    headerName: "Tendance",
    width: 90,
    renderCell: (params) => {
      const meta = TREND_META[params.value as DemandTrend];
      return (
        <Tooltip title={meta.label}>
          <span style={{ color: meta.color, display: "flex", alignItems: "center", height: "100%" }}>{meta.icon}</span>
        </Tooltip>
      );
    },
  },
  { field: "sku", headerName: "SKU", width: 130 },
  { field: "vendor", headerName: "Marque", width: 130 },
  { field: "productTitle", headerName: "Produit", flex: 1, minWidth: 200 },
  { field: "title", headerName: "Variante", flex: 1, minWidth: 140 },
  { field: "inventoryQuantity", headerName: "Stock", width: 90, type: "number" },
  {
    field: "velocityPerDay",
    headerName: "Ventes/jour",
    width: 120,
    type: "number",
    valueFormatter: (value: number) => value.toFixed(2),
  },
  {
    field: "reorderPoint",
    headerName: "Seuil réappro",
    width: 130,
    type: "number",
    valueFormatter: (value: number) => Math.round(value).toString(),
  },
  {
    field: "suggestedOrderQty",
    headerName: "Qté suggérée",
    width: 140,
    type: "number",
    renderCell: (params) => <strong>{params.value as number}</strong>,
  },
  {
    field: "daysUntilStockout",
    headerName: "Jours avant rupture",
    width: 160,
    valueFormatter: (value: number | null) => (value === null ? "-" : Math.floor(value).toString()),
  },
];

export function ReorderTable({ rows }: { rows: ReorderRow[] }) {
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      getRowId={(row) => row.variantId}
      initialState={{
        pagination: { paginationModel: { pageSize: 25 } },
      }}
      pageSizeOptions={[25, 50, 100]}
      density="compact"
      autoHeight
    />
  );
}
