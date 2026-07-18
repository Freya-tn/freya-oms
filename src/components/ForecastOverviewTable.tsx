"use client";

import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { Chip, Link as MuiLink } from "@mui/material";
import NextLink from "next/link";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingFlatIcon from "@mui/icons-material/TrendingFlat";
import { STATUS } from "@/lib/theme/chartColors";
import { formatCurrency } from "@/lib/format";
import type { ScopeForecastRow } from "@/lib/insights/forecast";

export type ForecastOverviewRow = ScopeForecastRow & { id: string; href: string };

function TrendChip({ growthFactor, growthTrusted }: { growthFactor: number; growthTrusted: boolean }) {
  if (!growthTrusted) {
    return <Chip label="Historique insuffisant" size="small" variant="outlined" />;
  }
  const percent = Math.round((growthFactor - 1) * 100);
  if (Math.abs(percent) < 5) {
    return <Chip icon={<TrendingFlatIcon fontSize="small" />} label="Stable" size="small" variant="outlined" />;
  }
  const up = percent > 0;
  return (
    <Chip
      icon={up ? <TrendingUpIcon fontSize="small" /> : <TrendingDownIcon fontSize="small" />}
      label={`${up ? "+" : ""}${percent}% vs an dernier`}
      size="small"
      sx={{
        bgcolor: up ? STATUS.good : STATUS.critical,
        color: "#fff",
        "& .MuiChip-icon": { color: "#fff" },
      }}
    />
  );
}

const columns: GridColDef<ForecastOverviewRow>[] = [
  {
    field: "label",
    headerName: "Périmètre",
    flex: 1,
    minWidth: 200,
    renderCell: (params) => (
      <MuiLink component={NextLink} href={params.row.href} underline="hover" sx={{ fontWeight: 600 }}>
        {params.value}
      </MuiLink>
    ),
  },
  {
    field: "trend",
    headerName: "Tendance (croissance)",
    width: 190,
    sortable: false,
    renderCell: (params) => (
      <TrendChip growthFactor={params.row.current.growthFactor} growthTrusted={params.row.current.growthTrusted} />
    ),
  },
  {
    field: "currentRevenue",
    headerName: "CA prévu (mois en cours)",
    width: 190,
    type: "number",
    valueGetter: (_v, row) => row.current.predictedRevenue,
    valueFormatter: (value: number) => formatCurrency(value),
  },
  {
    field: "currentActual",
    headerName: "dont déjà réel",
    width: 150,
    type: "number",
    valueGetter: (_v, row) => row.current.actualRevenueToDate,
    valueFormatter: (value: number) => formatCurrency(value),
  },
  {
    field: "nextRevenue",
    headerName: "CA prévu (mois prochain)",
    width: 190,
    type: "number",
    valueGetter: (_v, row) => row.next.predictedRevenue,
    valueFormatter: (value: number) => formatCurrency(value),
  },
  {
    field: "seasonal",
    headerName: "Saisonnalité (m. prochain)",
    width: 180,
    sortable: false,
    renderCell: (params) => {
      const { seasonalIndex, seasonalTrusted } = params.row.next;
      if (!seasonalTrusted) return <Chip label="Non fiable" size="small" variant="outlined" color="warning" />;
      const percent = Math.round((seasonalIndex - 1) * 100);
      return (
        <span title="Écart à la moyenne mensuelle, calculé sur au moins 3 années complètes.">
          <Chip
            label={percent === 0 ? "Mois moyen" : `${percent > 0 ? "+" : ""}${percent}%`}
            size="small"
            variant="outlined"
            color={percent > 0 ? "success" : percent < 0 ? "warning" : "default"}
          />
        </span>
      );
    },
  },
];

/** Vue d'ensemble GLOBAL + toutes les catégories en un coup d'œil, triable — répond à "plus qu'une seule estimation" (retour utilisateur 2026-07-18). Cliquer une ligne ouvre le détail (cartes ci-dessus) pour ce périmètre. */
export function ForecastOverviewTable({ rows }: { rows: ForecastOverviewRow[] }) {
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      initialState={{
        sorting: { sortModel: [{ field: "currentRevenue", sort: "desc" }] },
        pagination: { paginationModel: { pageSize: 25 } },
      }}
      pageSizeOptions={[25, 50]}
      density="compact"
      autoHeight
      hideFooter
    />
  );
}
