// Proxy names are free text with no universal reference list (unlike
// countries, which have a fixed set of real countries — see
// countryFlags.ts). There's no comprehensive way to detect every typo or
// variant spelling of a proxy service's name up front, so aliases are
// added here one at a time as they're actually reported, rather than
// derived from a database. Unrecognized input passes through unchanged.
const PROXY_ALIASES: Record<string, string> = {
  'proylite': 'Proxylite',
};

export function canonicalProxyKey(rawProxy: string): string {
  const trimmed = rawProxy.trim();
  const canonical = PROXY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  return canonical.toLowerCase();
}

export function canonicalProxyName(rawProxy: string): string {
  const trimmed = rawProxy.trim();
  return PROXY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

// Some entries have "Proxy Used" recorded as a redacted placeholder
// (e.g. "*****") rather than a real proxy name — not a distinct proxy
// service, so it should be treated as if the field were blank everywhere
// proxy values are read.
export function isRedactedProxyValue(rawProxy: string): boolean {
  return /^\*+$/.test(rawProxy.trim());
}
