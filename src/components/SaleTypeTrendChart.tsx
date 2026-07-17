"use client";

import { Box, Paper, Typography } from "@mui/material";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SALE_TYPE_COLOR, CHART_INK } from "@/lib/theme/chartColors";
import { formatCurrency } from "@/lib/format";
import type { SaleTypeTrendPoint } from "@/lib/insights/blackMarketComparison";

const TARGET_TICK_COUNT = 8;
const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });

/**
 * Tooltip custom : le graphique n'affiche qu'un seul axe (le ratio, voir plus
 * bas), mais le montant absolu vendu ce jour-là (déclaré/black en TND) est
 * une information textuelle utile en plus du pourcentage — un tooltip n'est
 * pas un encodage visuel/axe, donc l'ajouter ici ne viole pas la règle "un
 * seul axe par graphique" (retour utilisateur 2026-07-17).
 */
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: SaleTypeTrendPoint }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;

  return (
    <Paper elevation={3} sx={{ p: 1.5, minWidth: 180 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        {new Date(label ?? point.date).toLocaleDateString("fr-FR")}
      </Typography>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
        <Typography variant="body2">Part du black</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {point.blackRatio !== null ? percentFormatter.format(point.blackRatio) : "-"}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
        <Typography variant="body2" sx={{ color: SALE_TYPE_COLOR.BLACK }}>
          CA black
        </Typography>
        <Typography variant="body2">{formatCurrency(point.black)}</Typography>
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
        <Typography variant="body2" sx={{ color: SALE_TYPE_COLOR.DECLARED }}>
          CA déclaré
        </Typography>
        <Typography variant="body2">{formatCurrency(point.declared)}</Typography>
      </Box>
    </Paper>
  );
}

/**
 * Part du CA venant du black, par jour — un seul axe (pourcentage), répond
 * directement à "est-ce que ça grossit ou diminue" (plus utile qu'un total
 * figé sur la période). Les jours sans vente n'ont pas de ratio (`null`,
 * jamais 0) : recharts laisse un vrai trou dans la ligne plutôt que de
 * suggérer "0% de black ce jour-là", ce qui serait faux. Le montant en TND
 * (déclaré/black) reste consultable dans le tooltip (voir `CustomTooltip`).
 */
export function SaleTypeTrendChart({ data }: { data: SaleTypeTrendPoint[] }) {
  const tickInterval = Math.max(0, Math.ceil(data.length / TARGET_TICK_COUNT) - 1);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
        <XAxis
          dataKey="date"
          stroke={CHART_INK.muted}
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: CHART_INK.axis }}
          interval={tickInterval}
          tickFormatter={(d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
        />
        <YAxis
          stroke={CHART_INK.muted}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => percentFormatter.format(v)}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="blackRatio"
          name="Part du black"
          stroke={SALE_TYPE_COLOR.BLACK}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
