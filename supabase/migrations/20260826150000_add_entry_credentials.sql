-- Closes a real, live data-exposure gap: public.entries is fully
-- public-readable via the anon key ("anyone can read entries", using (true))
-- — required for the external BIF Dashboard's live-update feature, which
-- subscribes to entries directly via postgres_changes (Realtime doesn't
-- support views, so it can't be pointed at a redacted view instead). That
-- means entries.data's credential fields (Password, Backup Codes,
-- Authenticator Backup, and Rooster Partners' distinct Casino Password) have
-- always been readable by anyone holding the anon key (public, bundled into
-- the front-end), independent of this dashboard's own login wall.
--
-- Real header spelling for each concept varies per tab (the same class of
-- inconsistency 'Account Surname ' — trailing space — already had): live
-- tab_schemas headers across the 33 real tabs use 'Backup Code' on some tabs
-- and 'Backup Codes' on others, and the 2FA field appears as 'Authenticator',
-- 'Authenticator Backup', 'Authenticator\nBackup' (literal embedded
-- newline), or 'Authenticator\n' depending on the tab. This migration's
-- one-time backfill normalizes every one of those variants found in live
-- data; src/lib/entryCredentials.ts is the single place new variants get
-- added going forward, mirrored by the write path (queries.ts's
-- insertEntry/updateEntryData) so a credential value can never land back in
-- entries.data on a later edit.
-- tab is denormalized from entries.tab (kept in sync by queries.ts on every
-- write, same shape as entry_review_analyses) so a per-tab fetch is a plain
-- .eq('tab', tab), not a join — entry_credentials is looked up once per tab
-- load, same access pattern as fetchEntryReviewAnalyses already has.
create table public.entry_credentials (
  entry_id              uuid primary key references public.entries(id) on delete cascade,
  tab                   text not null,
  password              text,
  casino_password       text,
  backup_codes          text,
  authenticator_backup  text,
  updated_at            timestamptz not null default now()
);

create index entry_credentials_tab_idx on public.entry_credentials (tab);

alter table public.entry_credentials enable row level security;

-- Deliberately NOT "anyone can read" — this is the whole point of the table.
create policy "approved users can read entry_credentials"
  on public.entry_credentials for select using (public.is_approved());
create policy "approved users can insert entry_credentials"
  on public.entry_credentials for insert with check (public.is_approved());
create policy "approved users can update entry_credentials"
  on public.entry_credentials for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete entry_credentials"
  on public.entry_credentials for delete using (public.is_approved());

-- One-time backfill: pull each known variant's non-blank value out of every
-- existing entries.data row. coalesce takes the first non-null variant present
-- on that row — a given tab's real headers only ever carry one spelling per
-- concept, so this never has to choose between two genuinely different values.
insert into public.entry_credentials (entry_id, tab, password, casino_password, backup_codes, authenticator_backup)
select
  id,
  tab,
  nullif(data->>'Password', ''),
  nullif(data->>'Casino Password', ''),
  nullif(coalesce(data->>'Backup Code', data->>'Backup Codes'), ''),
  nullif(coalesce(data->>'Authenticator', data->>'Authenticator Backup', data->>E'Authenticator\nBackup', data->>E'Authenticator\n'), '')
from public.entries
where (data ? 'Password') or (data ? 'Casino Password')
   or (data ? 'Backup Code') or (data ? 'Backup Codes')
   or (data ? 'Authenticator') or (data ? 'Authenticator Backup')
   or (data ? E'Authenticator\nBackup') or (data ? E'Authenticator\n')
on conflict (entry_id) do nothing;

-- Strip every known variant key out of entries.data now that its value (if
-- any) lives in entry_credentials — this is the actual fix: entries' public
-- "anyone can read" policy can no longer serve these values to anyone.
update public.entries
set data = data
  - 'Password' - 'Casino Password'
  - 'Backup Code' - 'Backup Codes'
  - 'Authenticator' - 'Authenticator Backup' - E'Authenticator\nBackup' - E'Authenticator\n'
where (data ? 'Password') or (data ? 'Casino Password')
   or (data ? 'Backup Code') or (data ? 'Backup Codes')
   or (data ? 'Authenticator') or (data ? 'Authenticator Backup')
   or (data ? E'Authenticator\nBackup') or (data ? E'Authenticator\n');
