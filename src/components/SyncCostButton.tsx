"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Snackbar } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { triggerProductSyncAction } from "@/app/(dashboard)/syncActions";

/** Resynchronise juste les produits (coût inclus, voir docs/SHOPIFY_SYNC.md) — pour voir tout de suite l'effet d'un coût corrigé sur Shopify sans attendre le prochain poll automatique. */
export function SyncCostButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSync = () => {
    startTransition(async () => {
      const result = await triggerProductSyncAction();
      setFeedback(result.ok ? { ok: true, message: result.message } : { ok: false, message: result.error });
      router.refresh();
    });
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<RefreshIcon sx={isPending ? { animation: "spin 1s linear infinite" } : undefined} />}
        onClick={handleSync}
        disabled={isPending}
        sx={{ "@keyframes spin": { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } } }}
      >
        {isPending ? "Resynchronisation..." : "Resynchroniser les coûts"}
      </Button>

      {feedback && (
        <Snackbar
          open
          autoHideDuration={6000}
          onClose={() => setFeedback(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert severity={feedback.ok ? "success" : "error"} onClose={() => setFeedback(null)} sx={{ width: "100%" }}>
            {feedback.message}
          </Alert>
        </Snackbar>
      )}
    </>
  );
}
