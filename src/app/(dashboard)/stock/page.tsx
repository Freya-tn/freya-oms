import { Typography } from "@mui/material";
import { getStockOverview } from "@/lib/insights/stockDays";
import { getCategoryList, getVendorList } from "@/lib/insights/filters";
import { parseCategoryParam, parseStockStatusParam, parseVendorParam, STOCK_STATUS_OPTIONS } from "@/lib/filterParams";
import { StockTable } from "@/components/StockTable";
import { FilterBar } from "@/components/FilterBar";

export const dynamic = "force-dynamic";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; category?: string; status?: string }>;
}) {
  const params = await searchParams;
  const vendor = parseVendorParam(params.vendor);
  const category = parseCategoryParam(params.category);
  // "status" est un statut DÉRIVÉ (combine inventoryQuantity + vitesse de
  // vente calculée en JS) — impossible à pousser dans le WHERE Prisma sans
  // dupliquer la formule de daysOfStock en SQL. Filtré ici, côté serveur,
  // sur le résultat déjà calculé par getStockOverview — pas une exception à
  // la règle "toujours pousser le filtre en SQL" (qui vise vendor/catégorie,
  // des colonnes réelles), un cas structurellement différent. Voir
  // docs/INSIGHTS.md.
  const status = parseStockStatusParam(params.status);

  const [allRows, vendors, categories] = await Promise.all([
    getStockOverview({ vendor, category }),
    getVendorList(),
    getCategoryList(),
  ]);
  const rows = status ? allRows.filter((row) => row.status === status) : allRows;

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Stock
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Vitesse de vente calculée automatiquement : les ventes récentes comptent plus que les anciennes, sur un
        historique remontant jusqu&apos;à 1 an pour les produits déjà bien établis. Pour un produit ajouté récemment,
        seule sa vraie durée de vie est prise en compte (jamais diluée par une période où il n&apos;existait pas
        encore) - survolez la colonne &quot;Ventes/jour&quot; pour voir la fenêtre exacte utilisée pour chaque ligne.
      </Typography>
      <FilterBar
        vendors={vendors}
        showPeriodFilter={false}
        defaultPeriod={30}
        extraFilters={[
          {
            key: "category",
            label: "Catégorie",
            allLabel: "Toutes les catégories",
            options: categories.map((c) => ({ value: c, label: c })),
          },
          {
            key: "status",
            label: "Statut stock",
            allLabel: "Tous les statuts",
            options: STOCK_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
          },
        ]}
      />
      <StockTable rows={rows} />
    </>
  );
}
