"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Box, Chip, Slider, Typography } from "@mui/material";
import QueryStatsOutlinedIcon from "@mui/icons-material/QueryStatsOutlined";
import { ANALYSIS_WINDOW_DAYS_MAX, ANALYSIS_WINDOW_DAYS_MIN } from "@/lib/filterParams";

const MARKS = [14, 30, 60, 90, 120, 180].map((value) => ({
  value,
  label: value === 180 ? "180j (max)" : `${value}j`,
}));

/**
 * Fenêtre d'analyse (jours de disponibilité réelle utilisés pour la vitesse
 * de vente / tendance / point de commande) — ajustable par l'utilisateur,
 * pilotée par l'URL (`?window=`) comme les autres filtres. Distincte de
 * `CoverageControl` (qui règle la couverture cible, pas la période
 * d'observation). Voir docs/INSIGHTS.md, section 5.
 */
export function AnalysisWindowControl({ defaultValue }: { defaultValue: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [localValue, setLocalValue] = useState(defaultValue);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
        <QueryStatsOutlinedIcon fontSize="small" color="primary" />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Période d&apos;analyse (vitesse de vente)
        </Typography>
        <Chip
          label={`${localValue} j`}
          size="small"
          color="primary"
          variant="outlined"
          sx={{ fontWeight: 600 }}
        />
      </Box>
      <Slider
        value={localValue}
        onChange={(_e, value) => setLocalValue(value as number)}
        onChangeCommitted={(_e, value) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("window", String(value));
          // replace + scroll:false : évite d'empiler l'historique et de
          // faire remonter la page en haut à chaque relâchement du slider.
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        }}
        min={ANALYSIS_WINDOW_DAYS_MIN}
        max={ANALYSIS_WINDOW_DAYS_MAX}
        step={2}
        marks={MARKS}
        valueLabelDisplay="auto"
        valueLabelFormat={(value) => `${value}j`}
        size="small"
        sx={{
          maxWidth: 480,
          "& .MuiSlider-markLabel": { fontSize: 12, color: "text.secondary" },
          "& .MuiSlider-mark": { width: 4, height: 4, borderRadius: "50%" },
        }}
      />
    </Box>
  );
}
