"use client";

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import { formatCurrency } from "@/lib/format";
import { computeWeightedAverageCost } from "@/lib/purchaseIntakeCalc";
import {
  getPurchaseIntakeStatusAction,
  retryFailedLinesAction,
  startPurchaseIntakeAction,
  type PurchaseIntakeStatus,
} from "@/app/(dashboard)/reception-achats/purchaseIntakeActions";

export type PurchaseIntakeVariantRow = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  currentQuantity: number;
  currentCost: number | null;
};

type DraftInput = { qty: string; price: string };

const POLL_INTERVAL_MS = 1500;

/**
 * Une ligne par variante : champs éditables (qté achetée, prix d'achat) avec
 * un aperçu "nouveau coût" calculé en direct côté client (même fonction pure
 * que le serveur, src/lib/purchaseIntakeCalc.ts). Une fois le batch démarré,
 * chaque ligne concernée bascule vers son résultat (icône + coût appliqué)
 * via un rafraîchissement automatique (polling) - volontairement sobre, pas
 * de journal détaillé façon envoi SMS.
 */
export function PurchaseIntakeTable({ vendor, rows }: { vendor: string; rows: PurchaseIntakeVariantRow[] }) {
  const [inputs, setInputs] = useState<Record<string, DraftInput>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [batch, setBatch] = useState<PurchaseIntakeStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function updateInput(variantId: string, field: keyof DraftInput, value: string) {
    setInputs((prev) => ({ ...prev, [variantId]: { ...prev[variantId], [field]: value } }));
  }

  const lines = rows
    .map((row) => {
      const draft = inputs[row.variantId];
      const qty = draft ? Number(draft.qty) : NaN;
      const price = draft ? Number(draft.price) : NaN;
      if (!draft || !Number.isInteger(qty) || qty <= 0 || !(price > 0)) return null;
      return { row, quantityPurchased: qty, purchasePrice: price };
    })
    .filter((l): l is { row: PurchaseIntakeVariantRow; quantityPurchased: number; purchasePrice: number } => l !== null);

  const totalSpend = lines.reduce((sum, l) => sum + l.quantityPurchased * l.purchasePrice, 0);

  function startPolling(batchId: string) {
    async function poll() {
      const status = await getPurchaseIntakeStatusAction(batchId);
      setBatch(status);
      if (status.status !== "in_progress" && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }

  async function handleConfirmStart() {
    setIsStarting(true);
    setStartError(null);
    const result = await startPurchaseIntakeAction(
      vendor,
      lines.map((l) => ({
        variantId: l.row.variantId,
        quantityPurchased: l.quantityPurchased,
        purchasePrice: l.purchasePrice,
      })),
    );
    setIsStarting(false);
    if (!result.ok) {
      setStartError(result.error);
      return;
    }
    setConfirmOpen(false);
    startPolling(result.batchId);
  }

  async function handleRetryFailed() {
    if (!batch) return;
    const result = await retryFailedLinesAction(batch.id);
    if (result.ok) startPolling(batch.id);
  }

  const isRunning = !!batch && batch.status === "in_progress";
  const appliedCount = batch?.lines.filter((l) => l.status === "applied").length ?? 0;
  const failedCount = batch?.lines.filter((l) => l.status === "failed").length ?? 0;
  const totalLines = batch?.lines.length ?? 0;
  const percent = totalLines > 0 ? Math.round(((appliedCount + failedCount) / totalLines) * 100) : 0;
  const lineResultByVariant = new Map(batch?.lines.map((l) => [l.variantId, l]) ?? []);

  return (
    <Box>
      {batch && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
            <Typography variant="body2">
              {appliedCount + failedCount} / {totalLines} traités{isRunning ? " - mise à jour en cours..." : ""}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {percent}%
            </Typography>
          </Box>
          <LinearProgress variant="determinate" value={percent} sx={{ height: 8, borderRadius: 4 }} />
          {!isRunning && (
            <Alert severity={failedCount > 0 ? "warning" : "success"} sx={{ mt: 1.5 }}>
              Terminé : {appliedCount} appliqué(s){failedCount > 0 ? `, ${failedCount} échec(s)` : ""}.
              {failedCount > 0 && (
                <Button size="small" onClick={handleRetryFailed} sx={{ ml: 2 }}>
                  Réessayer les échecs
                </Button>
              )}
            </Alert>
          )}
        </Box>
      )}

      <TableContainer sx={{ bgcolor: "background.paper", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Produit</TableCell>
              <TableCell>SKU</TableCell>
              <TableCell align="right">Qté actuelle</TableCell>
              <TableCell align="right">Coût actuel</TableCell>
              <TableCell align="right">Qté achetée</TableCell>
              <TableCell align="right">Prix d&apos;achat</TableCell>
              <TableCell align="right">Nouveau coût</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const result = lineResultByVariant.get(row.variantId);
              const draft = inputs[row.variantId] ?? { qty: "", price: "" };
              const qtyNum = Number(draft.qty);
              const priceNum = Number(draft.price);
              const hasValidDraft = Number.isInteger(qtyNum) && qtyNum > 0 && priceNum > 0;
              const preview = hasValidDraft
                ? computeWeightedAverageCost(row.currentQuantity, row.currentCost, qtyNum, priceNum)
                : null;

              return (
                <TableRow key={row.variantId} hover>
                  <TableCell>
                    <Typography variant="body2">{row.productTitle}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.variantTitle}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.sku ?? "-"}</TableCell>
                  <TableCell align="right">{row.currentQuantity}</TableCell>
                  <TableCell align="right">
                    {row.currentCost !== null ? formatCurrency(row.currentCost, 2) : "-"}
                  </TableCell>

                  {result ? (
                    <>
                      <TableCell align="right">{result.quantityPurchased}</TableCell>
                      <TableCell align="right">{formatCurrency(result.purchasePrice, 2)}</TableCell>
                      <TableCell align="right">
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0.75 }}>
                          {result.status === "applied" && <CheckCircleIcon color="success" fontSize="small" />}
                          {result.status === "failed" && (
                            <Tooltip title={result.errorMessage ?? ""}>
                              <CancelIcon color="error" fontSize="small" />
                            </Tooltip>
                          )}
                          {result.status === "pending" && <CircularProgress size={14} />}
                          <Typography variant="body2" color={result.status === "failed" ? "error.main" : undefined}>
                            {result.status === "failed" ? "Échec" : formatCurrency(result.newCost, 2)}
                          </Typography>
                        </Box>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          value={draft.qty}
                          onChange={(e) => updateInput(row.variantId, "qty", e.target.value)}
                          sx={{ width: 90 }}
                          disabled={!!batch}
                          slotProps={{ htmlInput: { min: 0, step: 1 } }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          value={draft.price}
                          onChange={(e) => updateInput(row.variantId, "price", e.target.value)}
                          sx={{ width: 100 }}
                          disabled={!!batch}
                          slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {preview ? (
                          <Typography variant="body2" color="primary.main">
                            {formatCurrency(preview.newCost, 2)}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            -
                          </Typography>
                        )}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {!batch && (
        <Box sx={{ mt: 2 }}>
          <Button variant="contained" disabled={lines.length === 0} onClick={() => setConfirmOpen(true)}>
            Lancer la mise à jour ({lines.length} ligne{lines.length > 1 ? "s" : ""})
          </Button>
        </Box>
      )}

      <Dialog open={confirmOpen} onClose={() => (!isStarting ? setConfirmOpen(false) : undefined)} maxWidth="xs" fullWidth>
        <DialogTitle>Confirmer la réception</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            <strong>{lines.length}</strong> variante(s) de <strong>{vendor}</strong> vont être mises à jour sur
            Shopify (quantité + nouveau coût moyen), pour une dépense totale de{" "}
            <strong>{formatCurrency(totalSpend, 2)}</strong>. Cette action écrit réellement dans Shopify.
          </DialogContentText>
          {startError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {startError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={isStarting}>
            Annuler
          </Button>
          <Button variant="contained" onClick={handleConfirmStart} disabled={isStarting}>
            {isStarting ? <CircularProgress size={20} /> : "Confirmer"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
