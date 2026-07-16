import { prisma } from "@/lib/db";

/** Liste des marques distinctes présentes en base (hors exclues), triée. Pour peupler le filtre vendor. */
export async function getVendorList(): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: { vendor: { not: null } },
    select: { vendor: true },
    distinct: ["vendor"],
  });
  return rows
    .map((r) => r.vendor)
    .filter((v): v is string => !!v)
    .sort((a, b) => a.localeCompare(b));
}

/** Liste des catégories (Product.productType) distinctes présentes en base, triée. Pour peupler le filtre catégorie (page Stock). */
export async function getCategoryList(): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: { productType: { not: null } },
    select: { productType: true },
    distinct: ["productType"],
  });
  return rows
    .map((r) => r.productType)
    .filter((v): v is string => !!v)
    .sort((a, b) => a.localeCompare(b));
}
