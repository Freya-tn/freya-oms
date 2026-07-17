"use client";

import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { Chip } from "@mui/material";
import { ABC_TIER_COLOR } from "@/lib/theme/chartColors";
import { formatCurrency } from "@/lib/format";
import type { MarginAbcRow, MarginAbcTier } from "@/lib/insights/margin";

const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });

const TIER_LABEL: Record<MarginAbcTier, string> = {
  A: "A : priorité haute",
  B: "B : priorité moyenne",
  C: "C : priorité basse",
};

const columns: GridColDef<MarginAbcRow>[] = [
  {
    field: "tier",
    headerName: "Tier",
    width: 160,
    renderCell: (params) => {
      const tier = params.value as MarginAbcTier;
      return (
        <Chip
          label={TIER_LABEL[tier]}
          size="small"
          sx={{ bgcolor: ABC_TIER_COLOR[tier], color: tier === "C" ? "#0b0b0b" : "#fff" }}
        />
      );
    },
  },
  { field: "sku", headerName: "SKU", width: 130 },
  { field: "productTitle", headerName: "Produit", flex: 1, minWidth: 200 },
  { field: "title", headerName: "Variante", flex: 1, minWidth: 140 },
  {
    field: "margin",
    headerName: "Marge",
    width: 140,
    type: "number",
    valueFormatter: (value: number) => formatCurrency(value),
  },
  {
    field: "marginShare",
    headerName: "% de la marge",
    width: 130,
    valueFormatter: (value: number) => percentFormatter.format(value),
  },
  {
    field: "cumulativeShare",
    headerName: "% cumulé",
    width: 110,
    valueFormatter: (value: number) => percentFormatter.format(value),
  },
];

export function MarginAbcTable({ rows }: { rows: MarginAbcRow[] }) {
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      getRowId={(row) => row.variantId}
      initialState={{
        sorting: { sortModel: [{ field: "margin", sort: "desc" }] },
        pagination: { paginationModel: { pageSize: 25 } },
      }}
      pageSizeOptions={[25, 50, 100]}
      density="compact"
      autoHeight
    />
  );
}
