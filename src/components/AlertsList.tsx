"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Card, CardContent, Chip, Typography } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import { STATUS } from "@/lib/theme/chartColors";
import { acknowledgeAlert, unacknowledgeAlert } from "@/app/(dashboard)/alertes/actions";
import type { Alert as AlertItem, AlertCategory, AlertSeverity } from "@/lib/insights/alerts";

const SEVERITY_META: Record<AlertSeverity, { label: string; color: string }> = {
  serious: { label: "Sérieux", color: STATUS.critical },
  warning: { label: "À vérifier", color: STATUS.warning },
};

const CATEGORY_LABEL: Record<AlertCategory, string> = {
  "missing-cost": "Coût manquant",
  "margin-anomaly-high": "Marge anormalement élevée",
  "margin-anomaly-negative": "Marge négative (vendu à perte)",
};

function AlertRow({ alert }: { alert: AlertItem }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      if (alert.acknowledged) await unacknowledgeAlert(alert.key);
      else await acknowledgeAlert(alert.key);
      router.refresh();
    });
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 2,
        py: 1.5,
        borderBottom: "1px solid",
        borderColor: "divider",
        opacity: alert.acknowledged ? 0.55 : 1,
        "&:last-of-type": { borderBottom: "none" },
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5, flexWrap: "wrap" }}>
          <Chip
            label={SEVERITY_META[alert.severity].label}
            size="small"
            sx={{ bgcolor: SEVERITY_META[alert.severity].color, color: "#fff" }}
          />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {alert.productTitle} ({alert.variantTitle})
          </Typography>
          {alert.sku && (
            <Typography variant="caption" color="text.secondary">
              {alert.sku}
            </Typography>
          )}
        </Box>
        <Typography variant="body2" color="text.secondary">
          {alert.description}
        </Typography>
      </Box>
      <Button
        size="small"
        variant={alert.acknowledged ? "outlined" : "contained"}
        startIcon={alert.acknowledged ? <ReplayIcon /> : <CheckCircleOutlineIcon />}
        onClick={toggle}
        disabled={isPending}
        sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
      >
        {alert.acknowledged ? "Rouvrir" : "Marquer comme vérifié"}
      </Button>
    </Box>
  );
}

export function AlertsList({ alerts }: { alerts: AlertItem[] }) {
  if (alerts.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Aucune alerte pour le moment.
      </Typography>
    );
  }

  const byCategory = new Map<AlertCategory, AlertItem[]>();
  for (const alert of alerts) {
    const list = byCategory.get(alert.category) ?? [];
    list.push(alert);
    byCategory.set(alert.category, list);
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {[...byCategory.entries()].map(([category, items]) => (
        <Card key={category}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
              {CATEGORY_LABEL[category]} ({items.length})
            </Typography>
            <Box>
              {items.map((alert) => (
                <AlertRow key={alert.key} alert={alert} />
              ))}
            </Box>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}
