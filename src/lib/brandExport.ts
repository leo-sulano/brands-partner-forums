import { getEntryCountry } from './tab-configs';
import { formatCellValue } from './format';
import type { Entry } from '../types/entry';

export function buildBrandRowsForExport(entries: Entry[], headers: string[], tab: string): string[][] {
  return entries.map((entry) =>
    headers.map((header) => {
      if (header === 'Country') return getEntryCountry(entry.data, tab);
      const raw = entry.data[header];
      return raw ? formatCellValue(raw) : '';
    }),
  );
}
