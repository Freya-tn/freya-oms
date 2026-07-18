"use client";

import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { Chip, Link as MuiLink, Tooltip } from "@mui/material";
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
    field: "velocityPerDay",
    headerName: `Ventes/jour (${windowDays}j dispo)`,
    width: 160,
    type: "number",
    renderCell: (params) => {
      const { value, row } = params;
      if (value === null) return <span>-</span>;
      const text = (value as number).toFixed(2);
      const availableDaysNote =
        row.availableDays !== null
          ? `Calculée sur les ${row.availableDays} derniers jours où la variante a réellement eu du stock (pas des jours calendaires bruts).`
          : "Historique de disponibilité inconnu.";
      const confidenceNote = row.sufficientData
        ? ""
        : " Pas assez de jours de disponibilité réelle recensés pour en déduire un nombre de jours restants fiable : ce chiffre reste indicatif, mais aucune extrapolation n'est affichée dans la colonne \"Jours restants\".";
      return (
        <Tooltip title={availableDaysNote + confidenceNote}>
          <span>{text}</span>
        </Tooltip>
      );
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
