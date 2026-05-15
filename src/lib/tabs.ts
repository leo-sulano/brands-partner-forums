export const OPERATIONAL_TABS = [
  'TP Brand Injection',
  'Rooster Partners',
  'Revolution Casino',
  'Trybet',
  'SilverPlay',
  'SuprPlay Limited',
] as const;

export type OperationalTab = (typeof OPERATIONAL_TABS)[number];

export function isOperationalTab(s: string): s is OperationalTab {
  return (OPERATIONAL_TABS as readonly string[]).includes(s);
}

// Slug helpers for URL routing. Spaces → '-', lowercase. Reversible via direct lookup.
export function tabToSlug(tab: string): string {
  return tab.toLowerCase().replace(/\s+/g, '-');
}

export function slugToTab(slug: string): OperationalTab | null {
  const decoded = decodeURIComponent(slug).toLowerCase();
  return OPERATIONAL_TABS.find((t) => tabToSlug(t) === decoded) ?? null;
}

// Sensitive-field heuristic for masked rendering.
const SENSITIVE_PATTERNS = /password|backup|authenticator|secret|token|2fa|otp/i;
export function isSensitiveHeader(header: string): boolean {
  return SENSITIVE_PATTERNS.test(header);
}

// Headers that are bookkeeping, not data — never rendered in the form.
const SKIP_HEADERS = new Set(['id', 'last_sync_tag', '']);
export function isEditableHeader(header: string): boolean {
  return !SKIP_HEADERS.has(header.trim());
}
