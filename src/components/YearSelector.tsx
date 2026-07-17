"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MenuItem, TextField } from "@mui/material";

/**
 * Sélecteur d'année, piloté par l'URL (`?year=`) comme les autres filtres —
 * `router.replace` + `scroll: false` (voir CLAUDE.md) pour ne pas empiler
 * l'historique ni faire remonter la page à chaque changement. Scopé à sa
 * propre carte (comme `CoverageControl` sur la page Réappro), pas mêlé au
 * `FilterBar` principal de la page qui filtre autre chose (fenêtre glissante).
 */
export function YearSelector({ years, value }: { years: number[]; value: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <TextField
      select
      label="Année"
      size="small"
      value={value}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("year", e.target.value);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }}
      sx={{ width: 140 }}
    >
      {years.map((year) => (
        <MenuItem key={year} value={year}>
          {year}
        </MenuItem>
      ))}
    </TextField>
  );
}
