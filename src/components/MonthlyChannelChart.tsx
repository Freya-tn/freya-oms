"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHANNEL_COLOR, CHART_INK } from "@/lib/theme/chartColors";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { MonthlyChannelPoint } from "@/lib/insights/channelComparison";

/** CA confirmé par mois pour une année, deux barres par mois (B2B/B2C) — un seul axe (TND), couleurs catégorielles fixes. */
export function MonthlyChannelChart({ data }: { data: MonthlyChannelPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
        <XAxis dataKey="monthLabel" stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_INK.axis }} />
        <YAxis
          stroke={CHART_INK.muted}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => formatNumber(v)}
        />
        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 13 }} />
        <Bar dataKey="B2B" name="B2B" fill={CHANNEL_COLOR.B2B} radius={[4, 4, 0, 0]} />
        <Bar dataKey="B2C" name="B2C" fill={CHANNEL_COLOR.B2C} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
