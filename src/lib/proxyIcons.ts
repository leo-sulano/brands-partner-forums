// Proxy names are free text with no guaranteed real-world domain (unlike
// Country, which has a fixed set of real countries with real flags). This
// guesses a domain from the proxy's name and fetches its favicon via the
// same Google favicon service already used for Platform Breakdown's real
// logos — a best-effort lookup, not a verified brand match. Callers must
// treat the result as a decoration that can be wrong or missing, and keep
// a generic fallback icon for when it is.
//
// Returns null for anything too short or non-alphanumeric to plausibly be
// a domain name (e.g. a masked/redacted proxy value like "*****") — no
// point guessing a domain for text that isn't a real name.
export function proxyIconUrl(rawProxyName: string): string | null {
  const slug = rawProxyName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (slug.length < 3) return null;
  return `https://www.google.com/s2/favicons?domain=${slug}.com&sz=64`;
}
