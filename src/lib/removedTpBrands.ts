// A brand's Trustpilot page can be delisted entirely (Trustpilot removed the
// whole review page), independent of any single review's status. Flagged
// brands live in the `removed_tp_brands` table, keyed by (tab, brand). This
// key format is the single shared definition of that match — every reader
// (BrandGroup's badge, scoreSummary's TP-view exclusion) goes through it so
// they can't drift out of sync with each other or with what's actually
// stored in the table.

export function tpRemovedKey(tab: string, brand: string): string {
  return `${tab}::${brand.trim().toLowerCase()}`;
}

export function buildRemovedTpBrandSet(rows: { tab: string; brand: string }[]): Set<string> {
  return new Set(rows.map((r) => tpRemovedKey(r.tab, r.brand)));
}
