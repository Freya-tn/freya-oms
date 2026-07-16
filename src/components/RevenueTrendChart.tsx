"use client";

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHANNEL_COLOR, CHART_INK } from "@/lib/theme/chartColors";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { RevenueTrendPoint } from "@/lib/insights/orderTrend";

// Nombre de ticks visés sur l'axe X, quelle que soit la durée de la
// fenêtre — évite d'afficher une date par jour sur 90 jours (illisible).
const TARGET_TICK_COUNT = 8;

export function RevenueTrendChart({ data }: { data: RevenueTrendPoint[] }) {
  const tickInterval = Math.max(0, Math.ceil(data.length / TARGET_TICK_COUNT) - 1);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
          width={56}
          tickFormatter={(v: number) => formatNumber(v)}
        />
        <Tooltip
          labelFormatter={(d) => new Date(String(d)).toLocaleDateString("fr-FR")}
          formatter={(value) => formatCurrency(Number(value))}
        />
        <Legend iconType="line" wrapperStyle={{ fontSize: 13 }} />
        <Area
          type="monotone"
          dataKey="b2c"
          name="B2C"
          stackId="1"
          stroke={CHANNEL_COLOR.B2C}
          fill={CHANNEL_COLOR.B2C}
          fillOpacity={0.12}
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="b2b"
          name="B2B"
          stackId="1"
          stroke={CHANNEL_COLOR.B2B}
          fill={CHANNEL_COLOR.B2B}
          fillOpacity={0.12}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
