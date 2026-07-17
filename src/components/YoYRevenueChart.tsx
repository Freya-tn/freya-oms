"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SEQUENTIAL_BLUE, CHART_INK } from "@/lib/theme/chartColors";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { RevenueByMonthYoY } from "@/lib/insights/seasonality";

// Rampe séquentielle complète, du plus clair au plus foncé — voir
// chartColors.ts. Les années sont réparties dessus (la plus ancienne =
// la plus claire, la plus récente = la plus foncée) plutôt que des teintes
// catégorielles distinctes : ce n'est pas une comparaison d'identités mais
// une progression dans le temps, même principe que la rampe ABC.
const RAMP_STEPS = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700] as const;

function colorForYearIndex(index: number, total: number): string {
  if (total <= 1) return SEQUENTIAL_BLUE[450];
  const stepIndex = Math.round((index / (total - 1)) * (RAMP_STEPS.length - 1));
  return SEQUENTIAL_BLUE[RAMP_STEPS[stepIndex]];
}

/** CA confirmé par mois, une ligne par année (voir docs/INSIGHTS.md, "Saisonnalité"). */
export function YoYRevenueChart({ data }: { data: RevenueByMonthYoY }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data.points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
        <Legend iconType="line" wrapperStyle={{ fontSize: 13 }} />
        {data.years.map((year, i) => (
          <Line
            key={year}
            type="monotone"
            dataKey={String(year)}
            name={String(year)}
            stroke={colorForYearIndex(i, data.years.length)}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
