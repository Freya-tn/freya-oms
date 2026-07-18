"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Box, Typography } from "@mui/material";
import { CHART_INK, STATUS } from "@/lib/theme/chartColors";
import { formatNumber } from "@/lib/format";
import type { ProductHistoryPoint } from "@/lib/insights/productHistory";

const TARGET_TICK_COUNT = 8;

type Band = { from: string; to: string; kind: "rupture" | "unknown" };

/** Regroupe les jours consécutifs de même disponibilité en bandes, pour éviter une ReferenceArea par jour (illisible, des centaines d'éléments sur 365j). */
function computeBands(data: ProductHistoryPoint[]): Band[] {
  const bands: Band[] = [];
  let current: Band | null = null;
  for (const point of data) {
    const kind = point.available === false ? "rupture" : point.available === null ? "unknown" : null;
    if (kind === null) {
      current = null;
      continue;
    }
    if (current && current.kind === kind) {
      current.to = point.date;
    } else {
      current = { from: point.date, to: point.date, kind };
      bands.push(current);
    }
  }
  return bands;
}

export function ProductHistoryChart({ data }: { data: ProductHistoryPoint[] }) {
  const tickInterval = Math.max(0, Math.ceil(data.length / TARGET_TICK_COUNT) - 1);
  const bands = computeBands(data);

  return (
    <Box>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
          {bands.map((band, i) => (
            <ReferenceArea
              key={i}
              x1={band.from}
              x2={band.to}
              strokeOpacity={0}
              fill={band.kind === "rupture" ? STATUS.critical : CHART_INK.muted}
              fillOpacity={band.kind === "rupture" ? 0.12 : 0.08}
            />
          ))}
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
            width={40}
            allowDecimals={false}
            tickFormatter={(v: number) => formatNumber(v)}
          />
          <Tooltip
            labelFormatter={(d) => new Date(String(d)).toLocaleDateString("fr-FR")}
            formatter={(value, name) => (name === "unitsSold" ? [formatNumber(Number(value)), "Unités vendues"] : [value, name])}
          />
          <Bar dataKey="unitsSold" name="unitsSold" fill={CHART_INK.primary} radius={[2, 2, 0, 0]} maxBarSize={14} />
        </ComposedChart>
      </ResponsiveContainer>
      <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
        <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
          <Box sx={{ width: 12, height: 12, bgcolor: STATUS.critical, opacity: 0.4, borderRadius: 0.5 }} />
          <Typography variant="caption" color="text.secondary">
            Rupture confirmée
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
          <Box sx={{ width: 12, height: 12, bgcolor: CHART_INK.muted, opacity: 0.3, borderRadius: 0.5 }} />
          <Typography variant="caption" color="text.secondary">
            Disponibilité inconnue (pas de suivi ce jour-là)
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
