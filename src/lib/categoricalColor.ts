// Validated 8-slot categorical palette (light mode) — colorblind-safe in
// adjacent order per the dataviz skill's palette.md. Country/Proxy Breakdown
// cards draw an unbounded, filter-dependent set of identities, so slots are
// assigned by a stable hash of each identity's key rather than by rank —
// a value keeps its color across re-renders even as filters reorder the list.
const CATEGORICAL_PALETTE = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
] as const;

export function categoricalColorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return CATEGORICAL_PALETTE[Math.abs(hash) % CATEGORICAL_PALETTE.length];
}
