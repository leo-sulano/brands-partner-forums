// Canonical per-header field categorization, shared by EditEntryModal (form
// section grouping) and Brand Tabs' CSV/Excel export (column ordering) — kept
// in one place so the two surfaces can't independently drift on what counts
// as TP/AG/CG vs a general "Behavior Flags" field.

export const YES_NO_COLS = new Set([
  'Register from Google acount',
  'Leaving Review After redirected from  welcome Email',
  'Sticky IP (Mobile) (Y/N)',
  'Photo in Account?',
  'Opening the account via "usefull"',
  'Opening the account via "Register" when leaving review',
  'Scrolling and houvering?',
  'Smart Paste?/ Paste as human typing?',
  'Native Language?',
]);

export const TP_SECTION = new Set([
  'Score added', 'Trust Pilot', 'TP Review Status', 'Link to the profile',
  'Removed / Not Published / stil published date', 'Removed/ Not Pub./Published',
  'TP Score added',
]);

export const AG_SECTION = new Set([
  'Ask Gambler review added', 'AG Review Status', 'AG Review Link',
  'AG User', 'AG Password', 'AG Link', 'AG Added',
]);

export const CG_SECTION = new Set([
  'Casino Guru review added', 'CG Review Status', 'CG Review Link',
  'CG User', 'CG Password', 'CG Link', 'CG Added',
]);

// Bucketed alongside YES_NO_COLS under the "Behavior Flags" section — these
// aren't yes/no dropdowns, so they still render as plain/sensitive text
// inputs in the modal, just grouped under the same section heading. Covers
// both the raw sheet-import header ('Desktop/Mobile') and the newer key
// AddReviewAccountModal writes ('Mobile or deskstop ?') for the same field.
export const BEHAVIOR_EXTRA_COLS = new Set([
  'Backup Codes',
  'Authenticator Backup',
  'Redirection from Search Engine (which one?)',
  'Redirection Word used (Casino, Trustpilot)',
  'Redirection Word Used',
  'Reveiw Language',
  'Desktop/Mobile',
  'Mobile or deskstop ?',
  'Mentioning time frames',
  'Mentioning Amounts?',
  'Mentioning Agent name?',
  'Short review / Long',
  'Short review  / Long',
]);

export function isYesNoCol(h: string) {
  return YES_NO_COLS.has(h) || YES_NO_COLS.has(h.replace(/^`/, ''));
}

export function isBehaviorExtraCol(h: string) {
  return BEHAVIOR_EXTRA_COLS.has(h) || BEHAVIOR_EXTRA_COLS.has(h.trim().replace(/\s+/g, ' '));
}

export type EntrySection = 'account' | 'tp' | 'ag' | 'cg' | 'yesno';

// Which section a header belongs to — Account Details, one of the 3 platform
// groups, or the general "Behavior Flags" bucket. Falls back to 'account' for
// anything unrecognized (identity/account columns, and — since there's no
// dedicated Wizard of Odds bucket — that platform's own columns too).
export function sectionOf(h: string): EntrySection {
  if (isYesNoCol(h) || isBehaviorExtraCol(h)) return 'yesno';
  if (AG_SECTION.has(h)) return 'ag';
  if (CG_SECTION.has(h)) return 'cg';
  if (TP_SECTION.has(h)) return 'tp';
  const l = h.toLowerCase();
  if (l.includes('ask gambler') || (l.startsWith('ag ') && !l.includes('agent'))) return 'ag';
  if (l.includes('casino guru') || l.startsWith('cg ')) return 'cg';
  if (l.includes('trust pilot') || l.startsWith('tp ') || l === 'score added') return 'tp';
  return 'account';
}
