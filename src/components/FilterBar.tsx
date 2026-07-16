"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Box, MenuItem, TextField } from "@mui/material";
import { PERIOD_OPTIONS } from "@/lib/filterParams";

const PERIOD_LABEL: Record<number, string> = {
  7: "7 derniers jours",
  30: "30 derniers jours",
  60: "60 derniers jours",
  90: "90 derniers jours",
  180: "180 derniers jours",
};

export type ExtraSelectFilter = {
  /** Clé du paramètre d'URL (ex: "category", "status"). */
  key: string;
  label: string;
  /** Libellé de l'option "pas de filtre" (ex: "Toutes les catégories"). */
  allLabel: string;
  options: Array<{ value: string; label: string }>;
};

/**
 * Filtres marque/période pilotés par l'URL (searchParams), pour que chaque
 * page reste une Server Component (données re-fetchées côté serveur au
 * changement de filtre, jamais de state client dupliqué). `extraFilters`
 * permet à une page d'ajouter des selects supplémentaires spécifiques (ex:
 * catégorie/statut stock sur la page Stock) sans dupliquer la logique
 * `router.replace`/URL déjà en place ici.
 */
export function FilterBar({
  vendors,
  showVendorFilter = true,
  showPeriodFilter = true,
  defaultPeriod,
  extraFilters = [],
}: {
  vendors: string[];
  showVendorFilter?: boolean;
  showPeriodFilter?: boolean;
  defaultPeriod: number;
  extraFilters?: ExtraSelectFilter[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentVendor = searchParams.get("vendor") ?? "all";
  const currentWindow = searchParams.get("window") ?? String(defaultPeriod);

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      // replace (pas push) pour ne pas empiler une entrée d'historique par
      // filtre changé, et scroll: false pour ne pas faire remonter la page
      // en haut à chaque changement (voir CLAUDE.md).
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
      {showVendorFilter && (
        <TextField
          select
          label="Marque"
          size="small"
          value={currentVendor}
          onChange={(e) => updateParam("vendor", e.target.value)}
          sx={{ width: { xs: "100%", sm: 220 } }}
        >
          <MenuItem value="all">Toutes les marques</MenuItem>
          {vendors.map((v) => (
            <MenuItem key={v} value={v}>
              {v}
            </MenuItem>
          ))}
        </TextField>
      )}
      {showPeriodFilter && (
        <TextField
          select
          label="Période"
          size="small"
          value={currentWindow}
          onChange={(e) => updateParam("window", e.target.value)}
          sx={{ width: { xs: "100%", sm: 220 } }}
        >
          {PERIOD_OPTIONS.map((days) => (
            <MenuItem key={days} value={String(days)}>
              {PERIOD_LABEL[days]}
            </MenuItem>
          ))}
        </TextField>
      )}
      {extraFilters.map((filter) => (
        <TextField
          key={filter.key}
          select
          label={filter.label}
          size="small"
          value={searchParams.get(filter.key) ?? "all"}
          onChange={(e) => updateParam(filter.key, e.target.value)}
          sx={{ width: { xs: "100%", sm: 220 } }}
        >
          <MenuItem value="all">{filter.allLabel}</MenuItem>
          {filter.options.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      ))}
    </Box>
  );
}
