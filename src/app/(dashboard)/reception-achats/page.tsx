import { Alert, Typography } from "@mui/material";
import { prisma } from "@/lib/db";
import { getVendorList } from "@/lib/insights/filters";
import { parseVendorParam } from "@/lib/filterParams";
import { FilterBar } from "@/components/FilterBar";
import { PurchaseIntakeTable, type PurchaseIntakeVariantRow } from "@/components/PurchaseIntakeTable";

export const dynamic = "force-dynamic";

export default async function ReceptionAchatsPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string }>;
}) {
  const params = await searchParams;
  const vendor = parseVendorParam(params.vendor);

  const [vendors, variants] = await Promise.all([
    getVendorList(),
    vendor
      ? prisma.variant.findMany({
          where: { product: { vendor } },
          select: {
            id: true,
            title: true,
            sku: true,
            inventoryQuantity: true,
            cost: true,
            product: { select: { title: true } },
          },
          orderBy: [{ product: { title: "asc" } }, { title: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  // Decimal (Prisma) -> number : seule forme sérialisable à travers la
  // frontière Server -> Client Component (voir convention `Number(v.cost)`
  // dans src/lib/insights/productProfile.ts).
  const rows: PurchaseIntakeVariantRow[] = variants.map((v) => ({
    variantId: v.id,
    productTitle: v.product.title,
    variantTitle: v.title,
    sku: v.sku,
    currentQuantity: v.inventoryQuantity,
    currentCost: v.cost !== null ? Number(v.cost) : null,
  }));

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Réception d&apos;achats
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Choisissez une marque, renseignez la quantité et le prix d&apos;achat pour les variantes réapprovisionnées.
        Le nouveau coût est une moyenne pondérée entre le stock existant et cet achat - Shopify (quantité et coût)
        est mis à jour automatiquement, au rythme imposé par l&apos;API Shopify.
      </Typography>

      <FilterBar vendors={vendors} showPeriodFilter={false} defaultPeriod={30} />

      {!vendor ? (
        <Alert severity="info">Choisissez une marque pour voir ses variantes.</Alert>
      ) : rows.length === 0 ? (
        <Alert severity="warning">Aucune variante trouvée pour cette marque.</Alert>
      ) : (
        <PurchaseIntakeTable key={vendor} vendor={vendor} rows={rows} />
      )}
    </>
  );
}
