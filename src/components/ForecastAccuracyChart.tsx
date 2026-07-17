"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SEQUENTIAL_BLUE, CHART_INK } from "@/lib/theme/chartColors";
import type { ForecastAccuracyPoint } from "@/lib/insights/forecast";

const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });

/**
 * Erreur de prévision (MAPE) par délai — un seul axe, une seule teinte
 * (magnitude d'erreur, pas une identité catégorielle). Le X décroît de
 * gauche à droite dans le temps réel (30j avant la fin du mois -> 0j) mais
 * on le trie du plus petit délai au plus grand pour lire "en approchant de
 * la fin du mois, l'erreur baisse" de gauche à droite comme une amélioration.
 */
export function ForecastAccuracyChart({ data }: { data: ForecastAccuracyPoint[] }) {
  const points = [...data].sort((a, b) => b.leadTimeDays - a.leadTimeDays);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
        <XAxis
          dataKey="leadTimeDays"
          stroke={CHART_INK.muted}
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: CHART_INK.axis }}
          tickFormatter={(v: number) => `${v} j avant`}
          reversed
        />
        <YAxis
          stroke={CHART_INK.muted}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => percentFormatter.format(v)}
        />
        <Tooltip
          formatter={(value, name) => (name === "mape" ? percentFormatter.format(Number(value)) : value)}
          labelFormatter={(label) => `Prévision faite ${label} j avant la fin du mois`}
        />
        <Line
          type="monotone"
          dataKey="mape"
          name="mape"
          stroke={SEQUENTIAL_BLUE[450]}
          strokeWidth={2}
          dot={{ r: 4, fill: SEQUENTIAL_BLUE[450], strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
