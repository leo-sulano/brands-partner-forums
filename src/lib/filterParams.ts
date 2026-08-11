// Shared read/write contract for every multi-select filter's URL persistence:
// comma-separated within one param, [] means the param is omitted entirely.
// A bare single value (no comma) is indistinguishable from — and reads
// identically to — a pre-existing single-select filter's URL, so every
// existing bookmark/deep link keeps working with no code changes at the
// call site that built it.
export function readArrayParam(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.get(key);
  return raw ? raw.split(',').filter(Boolean) : [];
}

export function writeArrayParam(next: URLSearchParams, key: string, values: string[]): void {
  if (values.length > 0) next.set(key, values.join(',')); else next.delete(key);
}

// Migrates a legacy single-string localStorage field (or an already-migrated
// array field, or a missing field) into the array shape every filter now
// uses. Call this once at each readFiltersFromStorage call site rather than
// duplicating the check per field.
export function toArrayFilter(value: string[] | string | undefined | null): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}
