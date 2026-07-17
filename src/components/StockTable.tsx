"use client";

import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { Chip, Link as MuiLink } from "@mui/material";
import NextLink from "next/link";
import type { StockRow } from "@/lib/insights/stockDays";

const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });

const columns: GridColDef<StockRow>[] = [
  { field: "sku", headerName: "SKU", width: 140 },
  { field: "vendor", headerName: "Marque", width: 130 },
  {
    field: "productTitle",
    headerName: "Produit",
    flex: 1,
    minWidth: 200,
    renderCell: (params) => (
      <MuiLink component={NextLink} href={`/produit/${params.row.variantId}`} underline="hover">
        {params.value}
      </MuiLink>
    ),
  },
  { field: "title", headerName: "Variante", flex: 1, minWidth: 160 },
  { field: "inventoryQuantity", headerName: "Stock", width: 100, type: "number" },
  {
    field: "velocityPerDay",
    headerName: "Ventes/jour",
    width: 130,
    type: "number",
    valueFormatter: (value: number | null) => (value === null ? "-" : value.toFixed(2)),
  },
  {
    field: "sellThroughRate",
    headerName: "Taux d'écoulement",
    width: 150,
    type: "number",
    valueFormatter: (value: number | null) => (value === null ? "-" : percentFormatter.format(value)),
  },
  {
    field: "daysOfStock",
    headerName: "Jours restants",
    width: 150,
    renderCell: (params) => {
      const { value, row } = params;
      if (row.status === "rupture") {
        return <Chip label="Rupture" color="error" size="small" />;
      }
      if (row.status === "unknown" || value === null) {
        return <span>-</span>;
      }
      const days = Math.floor(value as number);
      const color = row.status === "critical" ? "error" : row.status === "low" ? "warning" : "success";
      return <Chip label={`${days} j`} color={color} size="small" />;
    },
  },
  {
    field: "estimatedStockoutDate",
    headerName: "Rupture estimée",
    width: 150,
    valueFormatter: (value: Date | null) => (value ? new Date(value).toLocaleDateString("fr-FR") : "-"),
  },
];

export function StockTable({ rows }: { rows: StockRow[] }) {
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      getRowId={(row) => row.variantId}
      initialState={{
        sorting: { sortModel: [{ field: "daysOfStock", sort: "asc" }] },
        pagination: { paginationModel: { pageSize: 25 } },
      }}
      pageSizeOptions={[25, 50, 100]}
      density="compact"
      autoHeight
    />
  );
}
