"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Snackbar, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { formatRelativeTime } from "@/lib/format";
import { triggerSyncAction } from "@/app/(dashboard)/syncActions";
import type { SyncStatusRow } from "@/lib/insights/syncStatus";

const RESOURCE_LABEL: Record<string, string> = { PRODUCTS: "Produits", ORDERS: "Commandes" };

export function SyncStatusBar({ statuses }: { statuses: SyncStatusRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSync = () => {
    startTransition(async () => {
      const result = await triggerSyncAction();
      setFeedback(result.ok ? { ok: true, message: result.message } : { ok: false, message: result.error });
      router.refresh();
    });
  };

  const hasFailure = statuses.some((s) => s.status === "FAILED");

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3, flexWrap: "wrap" }}>
      <Typography variant="body2" color={hasFailure ? "error.main" : "text.secondary"}>
        {statuses
          .map((s) => `${RESOURCE_LABEL[s.resource] ?? s.resource} : ${formatRelativeTime(s.finishedAt ?? s.startedAt)}${s.status === "FAILED" ? " (échec)" : ""}`)
          .join(" · ")}
      </Typography>
      <Button
        size="small"
        variant="outlined"
        startIcon={<RefreshIcon sx={isPending ? { animation: "spin 1s linear infinite" } : undefined} />}
        onClick={handleSync}
        disabled={isPending}
        sx={{ "@keyframes spin": { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } } }}
      >
        {isPending ? "Synchronisation..." : "Actualiser"}
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
    </Box>
  );
}
