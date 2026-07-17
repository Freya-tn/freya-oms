"use client";

import { Button } from "@mui/material";
import DownloadIcon from "@mui/icons-material/DownloadOutlined";
import { toCsv, downloadCsv } from "@/lib/csv";
import type { ReorderRow, ReorderUrgency } from "@/lib/insights/reorder";

const URGENCY_LABEL: Record<ReorderUrgency, string> = {
  critical: "Rupture",
  serious: "Urgent",
  warning: "À commander",
  good: "OK",
};

/** Export CSV du bon de commande fournisseur — exporte exactement les lignes actuellement affichées (déjà filtrées par marque/couverture). */
export function ExportReorderCsvButton({ rows }: { rows: ReorderRow[] }) {
  const handleExport = () => {
    const csv = toCsv(
      rows.map((row) => ({
        sku: row.sku ?? "",
        marque: row.vendor ?? "",
        produit: row.productTitle,
        variante: row.title,
        stockActuel: row.inventoryQuantity,
        quantiteSuggeree: row.suggestedOrderQty,
        urgence: URGENCY_LABEL[row.urgency],
      })),
      [
        { key: "sku", label: "SKU" },
        { key: "marque", label: "Marque" },
        { key: "produit", label: "Produit" },
        { key: "variante", label: "Variante" },
        { key: "stockActuel", label: "Stock actuel" },
        { key: "quantiteSuggeree", label: "Quantité suggérée" },
        { key: "urgence", label: "Urgence" },
      ],
    );
    downloadCsv(csv, `reappro-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} disabled={rows.length === 0}>
      Exporter CSV
    </Button>
  );
}
