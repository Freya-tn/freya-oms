"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STATUS, CHART_INK } from "@/lib/theme/chartColors";
import type { ReorderRow } from "@/lib/insights/reorder";

const URGENCY_BAR_COLOR: Record<string, string> = {
  critical: STATUS.critical,
  serious: STATUS.serious,
  warning: STATUS.warning,
};

// Largeur minimale affichée pour une barre, en jours, uniquement pour que
// les ruptures immédiates (0 jour) restent visibles sur le graphique. Le
// tooltip et le label affichent toujours la vraie valeur, jamais celle-ci.
const MIN_VISUAL_BAR_VALUE = 0.6;
// Hauteur par ligne assez généreuse pour un libellé "Produit (Variante)" qui
// s'enroule sur 2 lignes sans chevaucher sa voisine (même correction que la
// page Produits, voir docs/ARCHITECTURE.md).
const ROW_HEIGHT = 42;
const LIMIT = 8;

function formatDaysLabel(days: number): string {
  return days === 0 ? "Rupture" : `${Math.floor(days)} j`;
}

/** Top variantes par urgence (un seul axe : jours avant rupture), teinte = statut (jamais une identité catégorielle). */
export function TopUrgencyChart({ data }: { data: ReorderRow[] }) {
  const top = [...data]
    .filter((r) => r.daysUntilStockout !== null)
    .sort((a, b) => a.daysUntilStockout! - b.daysUntilStockout!)
    .slice(0, LIMIT)
    .map((r) => ({
      ...r,
      label: `${r.productTitle} (${r.title})`,
      daysUntilStockoutReal: r.daysUntilStockout!,
      daysUntilStockoutVisual: Math.max(r.daysUntilStockout!, MIN_VISUAL_BAR_VALUE),
    }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, top.length * ROW_HEIGHT)}>
      <BarChart data={top} layout="vertical" margin={{ top: 4, left: 12, right: 40, bottom: 0 }}>
        <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
        <XAxis
          type="number"
          stroke={CHART_INK.muted}
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: CHART_INK.axis }}
          label={{ value: "Jours avant rupture", position: "insideBottom", offset: -5, fontSize: 12, fill: CHART_INK.muted }}
        />
        <YAxis type="category" dataKey="label" width={210} stroke={CHART_INK.muted} fontSize={11} tickLine={false} axisLine={false} />
        <Tooltip formatter={(_value, _name, item) => formatDaysLabel(item.payload.daysUntilStockoutReal)} />
        <Bar dataKey="daysUntilStockoutVisual" radius={[0, 4, 4, 0]} barSize={14}>
          {top.map((entry) => (
            <Cell
              key={entry.variantId}
              fill={URGENCY_BAR_COLOR[entry.urgency] ?? STATUS.good}
              stroke={entry.daysUntilStockoutReal === 0 ? STATUS.critical : undefined}
              strokeWidth={entry.daysUntilStockoutReal === 0 ? 2 : 0}
            />
          ))}
          <LabelList
            dataKey="daysUntilStockoutReal"
            position="right"
            formatter={(value) => formatDaysLabel(Number(value))}
            style={{ fontSize: 12, fontWeight: 600, fill: CHART_INK.primary }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
