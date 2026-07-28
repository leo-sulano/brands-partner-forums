export const OPERATIONAL_TABS = [
  'TP Brand Injection',
  'TP Affiliate',
  'Rooster Partners',
  'Revolution Casino',
  'Trybet',
  'SilverPlay',
  'SuprPlay Limited',
  'HazEmirates UAE',
  'Hanan',
  'Wizard of Odds',
  'GRG - Gulf Recovery Group',
] as const;

export type OperationalTab = (typeof OPERATIONAL_TABS)[number];

export function isOperationalTab(s: string): s is OperationalTab {
  return (OPERATIONAL_TABS as readonly string[]).includes(s);
}

// Slug helpers for URL routing. Spaces → '-', lowercase. Reversible via direct lookup.
// Manual overrides for tabs whose display name doesn't map to a clean slug (e.g. " - " separators).
const SLUG_OVERRIDES: Partial<Record<OperationalTab, string>> = {
  'GRG - Gulf Recovery Group': 'gulf-recovery-group',
};

export function tabToSlug(tab: string): string {
  return SLUG_OVERRIDES[tab as OperationalTab] ?? tab.toLowerCase().replace(/\s+/g, '-');
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

// Display-only rename: what a user reads on screen for these two tabs. The
// canonical identifier itself (DB `tab` column, URL slug, OPERATIONAL_TABS
// entry, tab-configs.ts keys) stays the original string everywhere else —
// this is purely a rendering lookup.
const TAB_DISPLAY_NAMES: Partial<Record<OperationalTab, string>> = {
  'TP Affiliate': 'FTP',
  'TP Brand Injection': 'BITP',
};

export function tabDisplayName(tab: string): string {
  return TAB_DISPLAY_NAMES[tab as OperationalTab] ?? tab;
}
