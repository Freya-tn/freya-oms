import { Card, CardContent, Divider, Typography } from "@mui/material";
import { getStockOverview, STOCK_VELOCITY_WINDOW_DAYS } from "@/lib/insights/stockDays";
import { getCategoryList, getVendorList } from "@/lib/insights/filters";
import {
  parseAnalysisWindowParam,
  parseCategoryParam,
  parseStockStatusParam,
  parseVendorParam,
  STOCK_STATUS_OPTIONS,
} from "@/lib/filterParams";
import { StockTable } from "@/components/StockTable";
import { FilterBar } from "@/components/FilterBar";
import { AnalysisWindowControl } from "@/components/AnalysisWindowControl";

export const dynamic = "force-dynamic";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; category?: string; status?: string; window?: string }>;
}) {
  const params = await searchParams;
  const vendor = parseVendorParam(params.vendor);
  const category = parseCategoryParam(params.category);
  const windowDays = parseAnalysisWindowParam(params.window, STOCK_VELOCITY_WINDOW_DAYS);
  // "status" est un statut DÉRIVÉ (combine inventoryQuantity + vitesse de
  // vente calculée en JS) — impossible à pousser dans le WHERE Prisma sans
  // dupliquer la formule de daysOfStock en SQL. Filtré ici, côté serveur,
  // sur le résultat déjà calculé par getStockOverview — pas une exception à
  // la règle "toujours pousser le filtre en SQL" (qui vise vendor/catégorie,
  // des colonnes réelles), un cas structurellement différent. Voir
  // docs/INSIGHTS.md.
  const status = parseStockStatusParam(params.status);

  const [allRows, vendors, categories] = await Promise.all([
    getStockOverview({ vendor, category, windowDays }),
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
        Comment ça marche : la vitesse de vente est calculée sur les {windowDays} derniers jours où chaque variante
        a réellement eu du stock (pas {windowDays} jours calendaires bruts) - une rupture récente ne fait jamais
        croire à tort qu&apos;un produit se vend moins bien. Même logique et même réglage que la page
        Réapprovisionnement. Une variante trop récente ou sans assez de recul affiche &quot;-&quot; plutôt qu&apos;un
        chiffre peu fiable.
      </Typography>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            Filtres &amp; paramètres
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
          <Divider sx={{ my: 2 }} />
          <AnalysisWindowControl defaultValue={windowDays} />
        </CardContent>
      </Card>
      <StockTable rows={rows} windowDays={windowDays} />
    </>
  );
}
