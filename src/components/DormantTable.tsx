"use client";

import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { Link as MuiLink } from "@mui/material";
import NextLink from "next/link";
import { formatCurrency, formatRelativeTime } from "@/lib/format";
import type { DormantRow } from "@/lib/insights/dormant";

const columns: GridColDef<DormantRow>[] = [
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
    headerName: "Ventes/jour (60j dispo)",
    description: "Unités vendues par jour, calculées sur les 60 derniers jours où la variante a réellement eu du stock (pas 60 jours calendaires).",
    width: 180,
    type: "number",
    valueFormatter: (value: number) => value.toFixed(3),
  },
  {
    field: "stockValue",
    headerName: "Argent immobilisé",
    width: 180,
    type: "number",
    valueFormatter: (value: number) => formatCurrency(value),
  },
  {
    field: "lastSaleAt",
    headerName: "Dernière vente",
    width: 150,
    valueFormatter: (value: Date | string | null) => (value ? formatRelativeTime(value) : "Jamais vendu"),
  },
];

export function DormantTable({ rows }: { rows: DormantRow[] }) {
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      getRowId={(row) => row.variantId}
      initialState={{
        sorting: { sortModel: [{ field: "stockValue", sort: "desc" }] },
        pagination: { paginationModel: { pageSize: 25 } },
      }}
      pageSizeOptions={[25, 50, 100]}
      density="compact"
      autoHeight
    />
  );
}
