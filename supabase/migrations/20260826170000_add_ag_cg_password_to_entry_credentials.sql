-- Closes a real gap the previous 2 migrations missed: 'AG Password' and
-- 'CG Password' (the reviewer's own login for the AskGamblers/Casino Guru
-- platform, distinct from the review-account 'Password' already migrated)
-- are app-only fields — src/lib/entryFieldSections.ts's AG_SECTION/
-- CG_SECTION render them in EditEntryModal, but they never appear in any
-- tab's tab_schemas.headers (they aren't spreadsheet-imported columns), so
-- the live tab_schemas sweep that found the original 8 variants never
-- surfaced them. Caught by a live browser check of a real entry after the
-- first migration shipped, then confirmed at scale via a direct
-- entries.data query: 444 rows with a real AG Password value, 113 with CG
-- Password, still fully exposed via the public "anyone can read entries"
-- policy. A broader regex sweep of every distinct entries.data key
-- (pass|backup|auth|pin|secret|token|credential|2fa|otp and a second pass
-- for pwd|passcode|recovery|seed|api.?key|login|pin.?code|mfa) found
-- nothing else.
alter table public.entry_credentials
  add column ag_password text,
  add column cg_password text;

update public.entry_credentials ec
set ag_password = nullif(e.data->>'AG Password', ''),
    cg_password = nullif(e.data->>'CG Password', '')
from public.entries e
where e.id = ec.entry_id
  and ((e.data ? 'AG Password') or (e.data ? 'CG Password'));

-- Rows that have an AG/CG Password but had no entry_credentials row at all
-- yet (no Password/Backup Codes/Authenticator value to have created one
-- originally) need their own insert.
insert into public.entry_credentials (entry_id, tab, ag_password, cg_password)
select id, tab, nullif(data->>'AG Password', ''), nullif(data->>'CG Password', '')
from public.entries
where ((data ? 'AG Password') or (data ? 'CG Password'))
  and id not in (select entry_id from public.entry_credentials);

update public.entries
set data = data - 'AG Password' - 'CG Password'
where (data ? 'AG Password') or (data ? 'CG Password');

-- Widen the hard block from the previous migration to cover these 2 keys too.
alter table public.entries drop constraint entries_no_credential_keys;
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
    and not (data ? 'AG Password')
    and not (data ? 'CG Password')
  );
