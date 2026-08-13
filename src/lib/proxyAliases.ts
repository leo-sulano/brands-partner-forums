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

// Adding a 5th active provider requires listing it here — any Proxy Used value that doesn't
// start with one of these names folds silently into NO_PROXY_LABEL, with no warning or telemetry.
const ACTIVE_PROXY_PROVIDERS = ['Enigma', 'Proxio', 'Proxylite', 'SpyderProxy'];

export const NO_PROXY_LABEL = 'No Proxy';

function isActiveProxyProvider(canonicalName: string): boolean {
  const lower = canonicalName.toLowerCase();
  return ACTIVE_PROXY_PROVIDERS.some((p) => lower.startsWith(p.toLowerCase()));
}

// A raw Proxy Used value, folded into the shared "No Proxy" bucket if it's blank, a redacted
// placeholder, or doesn't start with one of the 4 currently-active proxy providers (after
// typo-correction via PROXY_ALIASES) -- same rationale as resolveCountryLabel's "Unknown" in
// countryFlags.ts: turns "no real active proxy" into one real, filterable, canonicalizable
// identity instead of a value every proxy-identity consumer has to separately skip or fall
// silent on.
export function resolveProxyLabel(rawProxy: string | null | undefined): string {
  const trimmed = (rawProxy ?? '').trim();
  if (!trimmed || isRedactedProxyValue(trimmed)) return NO_PROXY_LABEL;

  // Check if the trimmed value starts with a known alias that maps to an active provider
  const trimmedLower = trimmed.toLowerCase();
  for (const [aliasKey, canonical] of Object.entries(PROXY_ALIASES)) {
    if (trimmedLower.startsWith(aliasKey.toLowerCase())) {
      if (isActiveProxyProvider(canonical)) {
        return trimmed;
      }
    }
  }

  // Otherwise, check if the value directly starts with an active provider
  return isActiveProxyProvider(trimmed) ? trimmed : NO_PROXY_LABEL;
}
