import Link from "next/link";
import { Box, Card, CardContent, Chip, Grid, Tooltip, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBackOutlined";
import { getProductProfile } from "@/lib/insights/productProfile";
import { getProductSalesAndStockHistory } from "@/lib/insights/productHistory";
import { REORDER_SAFETY_DELAY_DAYS, TARGET_COVERAGE_DAYS, VELOCITY_WINDOW_DAYS } from "@/lib/insights/reorder";
import { formatCurrency, formatNumber, formatRelativeTime } from "@/lib/format";
import { STATUS, ABC_TIER_COLOR, SALE_TYPE_COLOR } from "@/lib/theme/chartColors";
import { parseAnalysisWindowParam } from "@/lib/filterParams";
import { KpiCard } from "@/components/KpiCard";
import { ProductHistoryChart } from "@/components/ProductHistoryChart";
import { AnalysisWindowControl } from "@/components/AnalysisWindowControl";

export const dynamic = "force-dynamic";

const DEFAULT_HISTORY_WINDOW_DAYS = 180;

const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });

const STOCK_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  rupture: { label: "Rupture", color: STATUS.critical },
  critical: { label: "Critique", color: STATUS.critical },
  low: { label: "Faible", color: STATUS.warning },
  ok: { label: "Ok", color: STATUS.good },
  unknown: { label: "Pas de vente récente", color: STATUS.warning },
};

const URGENCY_LABEL: Record<string, { label: string; color: string }> = {
  critical: { label: "Rupture", color: STATUS.critical },
  serious: { label: "Urgent", color: STATUS.serious },
  warning: { label: "À commander", color: STATUS.warning },
  good: { label: "OK", color: STATUS.good },
};

export default async function ProductProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ variantId: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const { variantId } = await params;
  const { window: windowParam } = await searchParams;
  const historyWindowDays = parseAnalysisWindowParam(windowParam, DEFAULT_HISTORY_WINDOW_DAYS);
  const [profile, { points: history, summary: historySummary }] = await Promise.all([
    getProductProfile(variantId),
    getProductSalesAndStockHistory(variantId, historyWindowDays),
  ]);

  if (!profile) {
    return (
      <>
        <Typography variant="h4" component="h1" gutterBottom>
          Produit introuvable
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Cette variante n&apos;existe plus ou a été supprimée. <Link href="/stock">Retour au Stock</Link>.
        </Typography>
      </>
    );
  }

  const stockStatusMeta = profile.stock ? STOCK_STATUS_LABEL[profile.stock.status] : null;
  const urgencyMeta = profile.reorder ? URGENCY_LABEL[profile.reorder.urgency] : null;

  return (
    <>
      <Link
        href="/stock"
        style={{ display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 16, color: "inherit", textDecoration: "none" }}
      >
        <ArrowBackIcon fontSize="small" />
        <Typography variant="body2">Retour</Typography>
      </Link>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mb: 0.5 }}>
        <Typography variant="h4" component="h1">
          {profile.productTitle}
        </Typography>
        <Typography variant="h5" color="text.secondary">
          ({profile.title})
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 3 }}>
        {profile.sku && <Chip label={profile.sku} size="small" variant="outlined" />}
        {profile.vendor && <Chip label={profile.vendor} size="small" variant="outlined" />}
        {profile.productType && <Chip label={profile.productType} size="small" variant="outlined" />}
        <Chip
          label={profile.isBlackMarket ? "Black" : "Déclaré"}
          size="small"
          sx={{ bgcolor: profile.isBlackMarket ? SALE_TYPE_COLOR.BLACK : SALE_TYPE_COLOR.DECLARED, color: "#fff" }}
        />
        {profile.abc && (
          <Chip
            label={`ABC (CA) : ${profile.abc.tier}`}
            size="small"
            sx={{ bgcolor: ABC_TIER_COLOR[profile.abc.tier], color: profile.abc.tier === "C" ? "#0b0b0b" : "#fff" }}
          />
        )}
        {profile.marginAbc && (
          <Chip
            label={`ABC (marge) : ${profile.marginAbc.tier}`}
            size="small"
            sx={{ bgcolor: ABC_TIER_COLOR[profile.marginAbc.tier], color: profile.marginAbc.tier === "C" ? "#0b0b0b" : "#fff" }}
          />
        )}
        {profile.dormant && (
          <Chip label="Dormant / surstock" size="small" sx={{ bgcolor: STATUS.warning, color: "#fff" }} />
        )}
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard label="Stock actuel" value={formatNumber(profile.inventoryQuantity)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard label="Prix de vente" value={formatCurrency(profile.price)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard label="Coût de revient" value={profile.cost !== null ? formatCurrency(profile.cost) : "-"} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            label="Marge (90j)"
            value={profile.marginAbc ? formatCurrency(profile.marginAbc.margin) : "-"}
            subtext={profile.marginAbc ? `${percentFormatter.format(profile.marginAbc.marginShare)} de la marge du catalogue` : "coût non renseigné ou pas de vente costée"}
          />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Santé du stock
              </Typography>
              {profile.stock ? (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2" color="text.secondary">
                      Statut
                    </Typography>
                    {stockStatusMeta && (
                      <Chip label={stockStatusMeta.label} size="small" sx={{ bgcolor: stockStatusMeta.color, color: "#fff" }} />
                    )}
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2" color="text.secondary">
                      Vitesse de vente (30j)
                    </Typography>
                    <Typography variant="body2">
                      {profile.stock.velocityPerDay !== null ? `${profile.stock.velocityPerDay.toFixed(2)} unité(s)/jour` : "-"}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2" color="text.secondary">
                      Jours de stock restants
                    </Typography>
                    <Typography variant="body2">
                      {profile.stock.daysOfStock !== null ? `${Math.floor(profile.stock.daysOfStock)} j` : "-"}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2" color="text.secondary">
                      Dernière vente
                    </Typography>
                    <Typography variant="body2">
                      {profile.dormant?.lastSaleAt ? formatRelativeTime(profile.dormant.lastSaleAt) : "-"}
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Pas de données de stock.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Réapprovisionnement
              </Typography>
              {profile.reorder ? (
                <>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                      <Typography variant="body2" color="text.secondary">
                        Urgence
                      </Typography>
                      {urgencyMeta && (
                        <Chip label={urgencyMeta.label} size="small" sx={{ bgcolor: urgencyMeta.color, color: "#fff" }} />
                      )}
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                      <Tooltip title={`Calculée sur les ${VELOCITY_WINDOW_DAYS} derniers jours de disponibilité réelle (pas une fenêtre calendaire brute) - voir l'historique ci-dessous.`}>
                        <Typography variant="body2" color="text.secondary" sx={{ textDecoration: "underline dotted" }}>
                          Vitesse de vente utilisée
                        </Typography>
                      </Tooltip>
                      <Typography variant="body2">{profile.reorder.velocityPerDay.toFixed(2)} unité(s)/j</Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                      <Tooltip title={`Vitesse de vente x ${REORDER_SAFETY_DELAY_DAYS} j de délai fournisseur estimé (hypothèse globale, pas encore par marque) - en dessous de ce seuil, une commande est à prévoir.`}>
                        <Typography variant="body2" color="text.secondary" sx={{ textDecoration: "underline dotted" }}>
                          Seuil de réappro
                        </Typography>
                      </Tooltip>
                      <Typography variant="body2">{Math.round(profile.reorder.reorderPoint)} unités</Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                      <Tooltip title={`Quantité pour couvrir ${TARGET_COVERAGE_DAYS} j de vente après réception, stock actuel déduit.`}>
                        <Typography variant="body2" color="text.secondary" sx={{ textDecoration: "underline dotted" }}>
                          Quantité suggérée
                        </Typography>
                      </Tooltip>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {profile.reorder.suggestedOrderQty} unités
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                      <Typography variant="body2" color="text.secondary">
                        Jours avant rupture
                      </Typography>
                      <Typography variant="body2">
                        {profile.reorder.daysUntilStockout !== null ? `${Math.floor(profile.reorder.daysUntilStockout)} j` : "-"}
                      </Typography>
                    </Box>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
                    Basé sur les {VELOCITY_WINDOW_DAYS} derniers jours de disponibilité réelle, {REORDER_SAFETY_DELAY_DAYS} j de
                    délai fournisseur estimé, pour une couverture visée de {TARGET_COVERAGE_DAYS} j après réception (réglable
                    sur la page Réapprovisionnement).
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Pas d&apos;urgence de réapprovisionnement actuellement (vitesse de vente nulle ou stock suffisant, sur les{" "}
                  {VELOCITY_WINDOW_DAYS} derniers jours de disponibilité réelle).
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Historique ventes &amp; stock
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Comment ça marche : chaque barre est le nombre d&apos;unités vendues ce jour-là (commandes confirmées).
            Les bandes rouges marquent une rupture confirmée, les bandes grises une période sans suivi de stock
            (avant le début de l&apos;historique disponible pour cette variante) - jamais présentées comme une
            vraie quantité de stock, seulement disponible/en rupture/inconnu.
          </Typography>
          <AnalysisWindowControl defaultValue={historyWindowDays} />
          <Box sx={{ mt: 2 }}>
            <ProductHistoryChart data={history} />
          </Box>

          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <KpiCard label="Unités vendues" value={formatNumber(historySummary.totalUnitsSold)} subtext={`sur ${historySummary.daysInWindow} j`} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <KpiCard label="Chiffre d'affaires" value={formatCurrency(historySummary.totalRevenue)} subtext="commandes confirmées" />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <KpiCard label="Jours avec vente" value={String(historySummary.daysWithSales)} subtext={`sur ${historySummary.daysInWindow} j`} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <KpiCard
                label="Jours de rupture"
                value={String(historySummary.stockoutDays)}
                subtext="rupture confirmée"
                color={historySummary.stockoutDays > 0 ? "error" : undefined}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <KpiCard label="Jours disponible" value={String(historySummary.availableDays)} subtext="en stock confirmé" />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <KpiCard
                label="Meilleur jour"
                value={historySummary.bestDay ? `${historySummary.bestDay.unitsSold} unité(s)` : "-"}
                subtext={
                  historySummary.bestDay
                    ? new Date(historySummary.bestDay.date).toLocaleDateString("fr-FR")
                    : "aucune vente sur la période"
                }
              />
            </Grid>
          </Grid>

          {historySummary.unknownDays > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
              {historySummary.unknownDays} j sans suivi de stock sur la période (avant le début de l&apos;historique
              disponible pour cette variante) - ni comptés en rupture, ni en disponibilité.
            </Typography>
          )}
        </CardContent>
      </Card>
    </>
  );
}
