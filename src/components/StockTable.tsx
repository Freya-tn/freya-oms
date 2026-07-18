"use client";

import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { Chip, Link as MuiLink } from "@mui/material";
import NextLink from "next/link";
import type { StockRow } from "@/lib/insights/stockDays";

function buildColumns(windowDays: number): GridColDef<StockRow>[] {
  return [
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
    field: "availableDays",
    headerName: "Historique disponible",
    description: `Nombre de jours de disponibilité réelle trouvés pour cette variante, sur les ${windowDays}j demandés (réglage ci-dessus). En dessous de ${windowDays}j, le calcul est basé sur moins de recul que demandé - réduisez la fenêtre pour retrouver une estimation fiable sur cette variante.`,
    width: 190,
    sortable: true,
    renderCell: (params) => {
      const { row } = params;
      if (row.availableDays === null) {
        return (
          <span title="Aucun historique de disponibilité trouvé pour cette variante.">
            <Chip label="Aucun historique" size="small" variant="outlined" color="warning" />
          </span>
        );
      }
      return (
        <span
          title={
            row.sufficientData
              ? `${row.availableDays}j de disponibilité réelle trouvés, la fenêtre de ${windowDays}j demandée est entièrement couverte.`
              : `Seulement ${row.availableDays}j de disponibilité réelle trouvés sur les ${windowDays}j demandés (max disponible pour cette variante) - réduisez la fenêtre d'analyse à ${row.availableDays}j ou moins pour obtenir une estimation fiable ici.`
          }
        >
          <Chip
            label={`${row.availableDays} / ${windowDays} j`}
            size="small"
            variant="outlined"
            color={row.sufficientData ? "default" : "warning"}
          />
        </span>
      );
    },
  },
  {
    field: "velocityPerDay",
    headerName: "Ventes/jour",
    width: 120,
    type: "number",
    renderCell: (params) => {
      const { value } = params;
      if (value === null) return <span>-</span>;
      return <span>{(value as number).toFixed(2)}</span>;
    },
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
}

export function StockTable({ rows, windowDays }: { rows: StockRow[]; windowDays: number }) {
  return (
    <DataGrid
      rows={rows}
      columns={buildColumns(windowDays)}
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
