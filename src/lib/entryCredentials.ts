// Canonical credential fields, split out of entries.data into the separate
// entry_credentials table (see the migration this shipped with) because
// entries itself is fully public-readable via the anon key — required for
// the external BIF Dashboard's live-update subscription, which can't target
// a view (Realtime doesn't support them) — so these fields were previously
// exposed to anyone holding the (public, front-end-bundled) anon key.
//
// Real header spelling for each concept varies per-tab, the same kind of
// inconsistency 'Account Surname ' (trailing space) already had: some tabs
// use 'Backup Code', others 'Backup Codes'; the 2FA field appears as
// 'Authenticator', 'Authenticator Backup', 'Authenticator\nBackup', or
// 'Authenticator\n' depending on the tab. This is the one place every known
// variant is resolved — extractCredentials splits them out of a write
// payload before it reaches entries.data, mergeCredentialsIntoData puts a
// fetched value back under whichever spelling a given tab's real headers
// use, so every existing UI call site keeps reading/writing entry.data[h]
// exactly as it always has.
//
// `ag_password`/`cg_password` are app-only fields (src/lib/entryFieldSections.ts's
// AG_SECTION/CG_SECTION) — the reviewer's own login for the AskGamblers/Casino
// Guru platform, distinct from `password` (the review-account email login) and
// from `casino_password` (Rooster Partners' separate in-casino account
// password). They never appear in any tab's tab_schemas headers (they aren't
// spreadsheet-imported columns), which is exactly why a live tab_schemas
// header sweep missed them on the first pass — confirmed live via a direct
// entries.data query instead (444/113 rows respectively) before adding them
// here. mergeCredentialsIntoData's headers.includes() check will never match
// either, so both always fall back to their one literal key — correct, since
// there's no per-tab spelling variance to resolve.
export type CredentialField =
  | 'password' | 'casino_password' | 'backup_codes' | 'authenticator_backup'
  | 'ag_password' | 'cg_password';

export const CREDENTIAL_FIELD_KEYS: Record<CredentialField, readonly string[]> = {
  password: ['Password'],
  // Rooster Partners is the one tab with a distinct in-casino account
  // password alongside its login 'Password' — kept as its own field so a
  // migration/merge can't silently overwrite one with the other.
  casino_password: ['Casino Password'],
  backup_codes: ['Backup Code', 'Backup Codes'],
  authenticator_backup: ['Authenticator', 'Authenticator Backup', 'Authenticator\nBackup', 'Authenticator\n'],
  ag_password: ['AG Password'],
  cg_password: ['CG Password'],
};

export interface EntryCredentials {
  password?: string | null;
  casino_password?: string | null;
  backup_codes?: string | null;
  authenticator_backup?: string | null;
  ag_password?: string | null;
  cg_password?: string | null;
}

const CREDENTIAL_FIELD_ENTRIES = Object.entries(CREDENTIAL_FIELD_KEYS) as [CredentialField, readonly string[]][];

// Splits any credential-shaped keys out of a write payload (from
// AddReviewAccountModal/EditEntryModal, keyed by whatever header spelling
// that tab uses) into their canonical entry_credentials shape, returning the
// remaining fields unchanged. Call this before writing to entries.data so a
// credential value can never land back in that publicly-readable table.
//
// A field is only set on `credentials` (even to null) when one of its keys
// was actually present in `fields` — that's what lets clearing a field in
// the UI (a present key with a blank/null value) correctly clear it in
// entry_credentials too, while a tab that never had this concept at all
// (the key never present) leaves that column untouched by the caller's
// upsert instead of being wrongly reset to null.
export function extractCredentials(fields: Record<string, string | null>): {
  credentials: EntryCredentials;
  rest: Record<string, string | null>;
} {
  const rest = { ...fields };
  const credentials: EntryCredentials = {};
  for (const [field, keys] of CREDENTIAL_FIELD_ENTRIES) {
    let present = false;
    let value: string | null = null;
    for (const key of keys) {
      if (!(key in rest)) continue;
      present = true;
      const v = rest[key];
      delete rest[key];
      if (v != null && v !== '') value = v;
    }
    if (present) credentials[field] = value;
  }
  return { credentials, rest };
}

// Merges a fetched entry_credentials row back onto `data` under whichever
// real header spelling `headers` (that tab's live tab_schemas headers) uses
// for each concept, so every existing reader (AddReviewAccountModal,
// EditEntryModal, BrandGroup.tsx's table cells, CSV/Excel export) keeps
// working with zero changes. Falls back to a field's first known key when
// none of its variants are present in `headers` — e.g. tab_schemas hasn't
// caught up yet, or a brand-new dashboard-only tab with no live headers.
export function mergeCredentialsIntoData(
  data: Record<string, string | null>,
  credentials: EntryCredentials | null | undefined,
  headers: readonly string[],
): Record<string, string | null> {
  if (!credentials) return data;
  let merged: Record<string, string | null> | null = null;
  for (const [field, keys] of CREDENTIAL_FIELD_ENTRIES) {
    const value = credentials[field];
    if (value == null) continue;
    if (!merged) merged = { ...data };
    const key = keys.find((k) => headers.includes(k)) ?? keys[0];
    merged[key] = value;
  }
  return merged ?? data;
}
