"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Box, Chip, Slider, Typography } from "@mui/material";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import { COVERAGE_DAYS_MAX, COVERAGE_DAYS_MIN } from "@/lib/filterParams";

const MARKS = [30, 45, 60, 90, 120, 150, 180].map((value) => ({ value, label: `${value}j` }));

/**
 * Couverture cible du réappro (jours de vente à couvrir après une
 * commande) — ajustable par l'utilisateur, pilotée par l'URL (`?coverage=`)
 * comme les autres filtres. Voir docs/INSIGHTS.md, section 5.
 */
export function CoverageControl({ defaultValue }: { defaultValue: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [localValue, setLocalValue] = useState(defaultValue);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
        <ScheduleOutlinedIcon fontSize="small" color="primary" />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Couverture cible après commande
        </Typography>
        <Chip
          label={`${localValue} j · ~${Math.round(localValue / 30)} mois`}
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
          params.set("coverage", String(value));
          // replace + scroll:false : évite d'empiler l'historique et de
          // faire remonter la page en haut à chaque relâchement du slider.
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        }}
        min={COVERAGE_DAYS_MIN}
        max={COVERAGE_DAYS_MAX}
        step={15}
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
