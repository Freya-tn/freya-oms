// Génération CSV pure (pas d'import Prisma) — safe à importer depuis un
// Client Component. Séparateur `;` (pas `,`) : Excel en locale fr-FR
// utilise la virgule comme séparateur décimal, `,` comme délimiteur de
// colonnes casserait l'ouverture directe du fichier.
export type CsvColumn<T> = { key: keyof T; label: string };

function escapeCsvValue(value: string | number): string {
  const str = String(value);
  return /[",;\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toCsv<T extends Record<string, string | number>>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(";");
  const lines = rows.map((row) => columns.map((c) => escapeCsvValue(row[c.key])).join(";"));
  return [header, ...lines].join("\n");
}

/** Déclenche le téléchargement d'un CSV — BOM UTF-8 pour qu'Excel affiche correctement les accents. */
const UTF8_BOM = "﻿";

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([UTF8_BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
