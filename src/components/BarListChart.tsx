"use client";

import { Box, Tooltip, Typography } from "@mui/material";
import { SEQUENTIAL_BLUE } from "@/lib/theme/chartColors";
import { formatCurrency, formatNumber } from "@/lib/format";

export type BarListItem = {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
  /** Couleur de la barre pour CET item — pour une identité catégorielle (ex: B2B/B2C). Sinon la teinte unique par défaut. */
  color?: string;
};

const DEFAULT_BAR_COLOR = SEQUENTIAL_BLUE[450];
const MIN_VISIBLE_PERCENT = 3;

// Une fonction ne peut pas traverser la frontière Server -> Client Component
// (voir CLAUDE.md) : le format est choisi ici via un enum, jamais reçu en
// prop directement depuis une Server Component.
const FORMATTERS: Record<"currency" | "units", (value: number) => string> = {
  currency: formatCurrency,
  units: (value) => `${formatNumber(value)} unités`,
};

/**
 * Classement compact "label + mini-barre proportionnelle + valeur", sans
 * axe ni grille — le pattern le plus adapté pour un top-N textuel (produits,
 * marques, catégories). Un vrai bar chart recharts avec libellés Y longs
 * force soit à tronquer (perd l'info utile) soit à s'enrouler sur 2-3
 * lignes (prend une hauteur énorme pour rien) — décision équipe 2026-07-16,
 * voir docs/ARCHITECTURE.md.
 *
 * Pas de piste ("track") derrière la barre : une première version en
 * affichait une (façon "meter" de la skill dataviz), mais pour un classement
 * pur (pas de cible/plafond réel, juste une comparaison de magnitudes) une
 * barre pleine sur fond clair se lit comme une jauge de progression — sens
 * trompeur ici. Corrigé le 2026-07-17 : juste la barre, ancrée à gauche,
 * arrondie uniquement côté "pointe" (extrémité données), jamais des deux
 * côtés — un vrai trait de bar chart, pas un contrôle de progression.
 */
export function BarListChart({
  items,
  limit = 10,
  valueType = "currency",
  barColor = DEFAULT_BAR_COLOR,
  emptyLabel = "Aucune donnée sur la période.",
}: {
  items: BarListItem[];
  limit?: number;
  valueType?: "currency" | "units";
  barColor?: string;
  emptyLabel?: string;
}) {
  const formatValue = FORMATTERS[valueType];
  const top = items.slice(0, limit);
  const max = Math.max(...top.map((item) => item.value), 1);

  if (top.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyLabel}
      </Typography>
    );
  }

  return (
    <Box role="list">
      {top.map((item) => {
        const percent = Math.max(MIN_VISIBLE_PERCENT, Math.round((item.value / max) * 100));
        return (
          <Box
            key={item.id}
            role="listitem"
            tabIndex={0}
            sx={{
              py: 0.625,
              px: 0.75,
              mx: -0.75,
              borderRadius: 1.5,
              "&:hover, &:focus-visible": { bgcolor: "action.hover", outline: "none" },
            }}
          >
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, mb: 0.5 }}>
              <Tooltip title={item.label} enterDelay={400}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" noWrap sx={{ color: "text.primary" }}>
                    {item.label}
                  </Typography>
                  {item.sublabel && (
                    <Typography variant="caption" noWrap color="text.secondary" sx={{ display: "block" }}>
                      {item.sublabel}
                    </Typography>
                  )}
                </Box>
              </Tooltip>
              <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: "nowrap", color: "text.primary" }}>
                {formatValue(item.value)}
              </Typography>
            </Box>
            <Box sx={{ height: 6 }}>
              <Box
                sx={{
                  height: "100%",
                  width: `${percent}%`,
                  borderTopRightRadius: 3,
                  borderBottomRightRadius: 3,
                  bgcolor: item.color ?? barColor,
                }}
              />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
