import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { daysAgo } from "./common";

const MARGIN_WINDOW_DAYS = 90;
// Nombre minimum de variantes costées avec vente sur la fenêtre pour que la
// moyenne/écart-type calculés aient un sens statistique — en dessous, on
// saute le check "marge anormalement haute" plutôt que de flaguer sur un
// échantillon trop petit pour être fiable.
const MIN_SAMPLE_FOR_ANOMALY = 5;
const HIGH_MARGIN_STDDEV_MULTIPLIER = 2;

export type AlertSeverity = "warning" | "serious";
export type AlertCategory = "missing-cost" | "margin-anomaly-high" | "margin-anomaly-negative";

export type Alert = {
  key: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  variantId: string;
  sku: string | null;
  productTitle: string;
  variantTitle: string;
  vendor: string | null;
  acknowledged: boolean;
};

const CATEGORY_META: Record<AlertCategory, { severity: AlertSeverity; title: (ctx: { sku: string | null }) => string }> = {
  "missing-cost": {
    severity: "warning",
    title: () => "Coût non renseigné",
  },
  "margin-anomaly-high": {
    severity: "warning",
    title: () => "Marge anormalement élevée",
  },
  "margin-anomaly-negative": {
    severity: "serious",
    title: () => "Marge négative (vendu à perte)",
  },
};

/** Variantes sans `cost` renseigné côté Shopify — alerte auto-résolue dès que le coût est rempli, pas besoin d'acquittement pour ce cas (mais possible si volontairement sans coût, ex: échantillon). */
async function getMissingCostAlerts(): Promise<Omit<Alert, "acknowledged">[]> {
  const variants = await prisma.variant.findMany({
    where: { cost: null },
    select: { id: true, sku: true, title: true, product: { select: { title: true, vendor: true } } },
  });

  return variants.map((v) => ({
    key: `missing-cost:${v.id}`,
    category: "missing-cost" as const,
    severity: CATEGORY_META["missing-cost"].severity,
    title: CATEGORY_META["missing-cost"].title({ sku: v.sku }),
    description: `${v.product.title} (${v.title}) n'a pas de coût de revient renseigné sur Shopify : la valeur de stock et la marge de ce produit sont sous-estimées/omises tant que ce n'est pas rempli.`,
    variantId: v.id,
    sku: v.sku,
    productTitle: v.product.title,
    variantTitle: v.title,
    vendor: v.product.vendor,
  }));
}

/**
 * Anomalies de marge : une marge très supérieure à la moyenne du catalogue
 * est souvent le signe d'une erreur de saisie de coût (ex: un zéro oublié)
 * plutôt qu'un vrai produit très rentable — à confirmer par un humain, pas à
 * corriger automatiquement. Une marge négative est un signal fort dans tous
 * les cas (vendu à perte), affichée qu'il y ait ou non assez de données pour
 * calculer une moyenne fiable.
 */
async function getMarginAnomalyAlerts(): Promise<Omit<Alert, "acknowledged">[]> {
  const since = daysAgo(MARGIN_WINDOW_DAYS);

  const rows = await prisma.$queryRaw<
    Array<{
      variantId: string;
      sku: string | null;
      title: string;
      productTitle: string;
      vendor: string | null;
      revenue: number;
      cost: number;
    }>
  >(Prisma.sql`
    SELECT
      li."variantId" AS "variantId",
      v.sku AS sku,
      v.title AS title,
      p.title AS "productTitle",
      p.vendor AS vendor,
      SUM(li."quantity" * li."unitPrice" - li."totalDiscount")::float AS revenue,
      SUM(li."quantity" * v.cost)::float AS cost
    FROM "OrderLineItem" li
    JOIN "Order" o ON o.id = li."orderId"
    JOIN "Variant" v ON v.id = li."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE o."isConfirmed" = true
      AND o."cancelledAt" IS NULL
      AND o."orderCreatedAt" >= ${since}
      AND li."variantId" IS NOT NULL
      AND v.cost IS NOT NULL
    GROUP BY li."variantId", v.sku, v.title, p.title, p.vendor
    HAVING SUM(li."quantity" * li."unitPrice" - li."totalDiscount") > 0
  `);

  const withRate = rows.map((r) => ({ ...r, marginRate: (r.revenue - r.cost) / r.revenue }));

  const alerts: Omit<Alert, "acknowledged">[] = [];

  // Marge négative : signal absolu, jamais besoin d'une moyenne pour le juger.
  for (const r of withRate) {
    if (r.marginRate < 0) {
      alerts.push({
        key: `margin-anomaly-negative:${r.variantId}`,
        category: "margin-anomaly-negative",
        severity: CATEGORY_META["margin-anomaly-negative"].severity,
        title: CATEGORY_META["margin-anomaly-negative"].title({ sku: r.sku }),
        description: `${r.productTitle} (${r.title}) a été vendu à perte sur les ${MARGIN_WINDOW_DAYS} derniers jours (marge ${(r.marginRate * 100).toFixed(0)}%) : vérifier le coût et le prix de vente.`,
        variantId: r.variantId,
        sku: r.sku,
        productTitle: r.productTitle,
        variantTitle: r.title,
        vendor: r.vendor,
      });
    }
  }

  // Marge anormalement haute : relatif à la moyenne du catalogue, seulement si l'échantillon est assez grand.
  if (withRate.length >= MIN_SAMPLE_FOR_ANOMALY) {
    const rates = withRate.map((r) => r.marginRate);
    const mean = rates.reduce((sum, r) => sum + r, 0) / rates.length;
    const variance = rates.reduce((sum, r) => sum + (r - mean) ** 2, 0) / rates.length;
    const stddev = Math.sqrt(variance);
    const threshold = mean + HIGH_MARGIN_STDDEV_MULTIPLIER * stddev;

    for (const r of withRate) {
      if (r.marginRate > threshold && r.marginRate >= 0) {
        alerts.push({
          key: `margin-anomaly-high:${r.variantId}`,
          category: "margin-anomaly-high",
          severity: CATEGORY_META["margin-anomaly-high"].severity,
          title: CATEGORY_META["margin-anomaly-high"].title({ sku: r.sku }),
          description: `${r.productTitle} (${r.title}) a une marge de ${(r.marginRate * 100).toFixed(0)}% sur les ${MARGIN_WINDOW_DAYS} derniers jours, largement au-dessus de la moyenne du catalogue (${(mean * 100).toFixed(0)}%) : vérifier que le coût saisi sur Shopify est correct avant de le prendre pour argent comptant.`,
          variantId: r.variantId,
          sku: r.sku,
          productTitle: r.productTitle,
          variantTitle: r.title,
          vendor: r.vendor,
        });
      }
    }
  }

  return alerts;
}

/** Toutes les alertes actives, avec leur statut d'acquittement (voir `AlertAcknowledgment`). */
export async function getAlerts(): Promise<Alert[]> {
  const [missingCost, marginAnomalies, acknowledgments] = await Promise.all([
    getMissingCostAlerts(),
    getMarginAnomalyAlerts(),
    prisma.alertAcknowledgment.findMany({ select: { alertKey: true } }),
  ]);

  const acknowledgedKeys = new Set(acknowledgments.map((a) => a.alertKey));
  const all = [...missingCost, ...marginAnomalies];

  return all
    .map((a) => ({ ...a, acknowledged: acknowledgedKeys.has(a.key) }))
    .sort((a, b) => {
      if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
      const severityOrder: Record<AlertSeverity, number> = { serious: 0, warning: 1 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
}
