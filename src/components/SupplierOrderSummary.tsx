"use client";

import NextLink from "next/link";
import {
  Chip,
  Link,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from "@mui/material";
import type { SupplierOrderSummary } from "@/lib/insights/reorder";

/**
 * Vue "commande à passer par fournisseur" (façon Assisty) : regroupe les
 * suggestions par marque. Cliquer sur une marque filtre la table détaillée
 * ci-dessous sur cette marque (même mécanisme que le filtre "Marque" en
 * haut de page, via `?vendor=`).
 */
export function SupplierOrderSummaryTable({ rows }: { rows: SupplierOrderSummary[] }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Marque</TableCell>
            <TableCell align="right">SKUs à commander</TableCell>
            <TableCell align="right">Unités suggérées</TableCell>
            <TableCell align="right">Dont ruptures</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.vendor} hover>
              <TableCell>
                <Tooltip title={`Voir les produits ${row.vendor}`}>
                  <Link
                    component={NextLink}
                    href={`?vendor=${encodeURIComponent(row.vendor)}`}
                    underline="hover"
                    sx={{ fontWeight: 600 }}
                  >
                    {row.vendor}
                  </Link>
                </Tooltip>
              </TableCell>
              <TableCell align="right">{row.skuCount}</TableCell>
              <TableCell align="right">
                <strong>{row.totalSuggestedUnits}</strong>
              </TableCell>
              <TableCell align="right">
                {row.criticalCount > 0 ? (
                  <Chip label={row.criticalCount} color="error" size="small" />
                ) : (
                  "-"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
