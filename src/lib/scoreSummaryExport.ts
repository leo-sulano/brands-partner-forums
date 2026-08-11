import { successRatePct, type BrandSummary, type SuccessRate } from './scoreSummary';

export function buildScoreSummaryExportHeaders(maxScore: number, showStars: boolean): string[] {
  const headers = ['Tab', 'Brand'];
  if (showStars) {
    for (let s = maxScore; s >= 1; s--) headers.push(`${s} Star`);
    headers.push('Unrated', 'Stars Total');
  }
  headers.push('Published', 'Removed', 'Total', 'Success Rate %');
  return headers;
}

export function buildScoreSummaryExportRows(
  brands: BrandSummary[],
  maxScore: number,
  showStars: boolean,
  successRates: Map<string, SuccessRate>,
): string[][] {
  return brands.map((b) => {
    const row: string[] = [b.tab, b.brand];
    if (showStars) {
      for (let s = maxScore; s >= 1; s--) row.push(String(b.counts[s] ?? 0));
      row.push(String(b.unrated), String(b.total));
    }
    const sr = successRates.get(`${b.tab} ${b.brand}`);
    const live = sr?.live ?? 0;
    const removed = sr?.removed ?? 0;
    const pct = successRatePct(sr?.rate ?? null);
    row.push(String(live), String(removed), String(live + removed), pct == null ? '' : String(pct));
    return row;
  });
}
