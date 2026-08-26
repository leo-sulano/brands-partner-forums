-- Defense-in-depth follow-up to 20260826150000_add_entry_credentials.sql: that
-- migration's own strip step (and two manual corrective re-runs the same
-- session) each found a small, unexplained handful of pre-existing rows its
-- UPDATE had silently failed to touch despite matching its WHERE clause —
-- root cause never identified. Rather than keep chasing individual
-- stragglers by hand, this adds a hard constraint: entries.data can never
-- contain any of the 8 known credential-key spellings again, checked by
-- Postgres itself, not by a manual query someone has to remember to re-run.
-- Adding this constraint also validates every existing row against it, so
-- applying this migration is itself the definitive proof of whether any
-- leak remains at the moment it runs.
--
-- Any future write path that still tries to put one of these keys into
-- entries.data (the frontend's insertEntry/updateEntryData already route
-- them to entry_credentials instead — src/lib/entryCredentials.ts — but this
-- also covers scripts/check_review_status.py's direct REST PATCH and any
-- write path not yet audited) now fails loudly with a constraint violation
-- instead of silently leaking the value via entries' public "anyone can
-- read" policy.
alter table public.entries
  add constraint entries_no_credential_keys check (
    not (data ? 'Password')
    and not (data ? 'Casino Password')
    and not (data ? 'Backup Code')
    and not (data ? 'Backup Codes')
    and not (data ? 'Authenticator')
    and not (data ? 'Authenticator Backup')
    and not (data ? E'Authenticator\nBackup')
    and not (data ? E'Authenticator\n')
  );
