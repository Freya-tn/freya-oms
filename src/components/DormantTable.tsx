"use client";

import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { formatCurrency, formatRelativeTime } from "@/lib/format";
import type { DormantRow } from "@/lib/insights/dormant";

const columns: GridColDef<DormantRow>[] = [
  { field: "sku", headerName: "SKU", width: 140 },
  { field: "vendor", headerName: "Marque", width: 130 },
  { field: "productTitle", headerName: "Produit", flex: 1, minWidth: 200 },
  { field: "title", headerName: "Variante", flex: 1, minWidth: 160 },
  { field: "inventoryQuantity", headerName: "Stock", width: 100, type: "number" },
  {
    field: "velocityPerDay",
    headerName: "Ventes/jour (60j)",
    width: 160,
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
