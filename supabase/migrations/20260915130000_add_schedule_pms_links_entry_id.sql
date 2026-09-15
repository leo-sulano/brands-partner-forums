-- supabase/migrations/20260915130000_add_schedule_pms_links_entry_id.sql
-- Per-account PMS task cards (docs/superpowers/specs/2026-09-15-pms-per-account-tasks-design.md):
-- lets more than one PMS task exist for the same (tab, brand_key, platform, date)
-- combo, one per real account (entry), on top of the existing single "generic"
-- plan-level task. link_kind = 'generic' is the existing plan-level link
-- (unchanged behavior); link_kind = 'entry' is a new entry-tied link for one
-- specific account, with entry_id naming which account that is.
--
-- The old plain `unique (tab, brand_key, platform, date)` constraint is
-- replaced by two partial unique indexes, since Postgres allows multiple NULLs
-- under a plain unique constraint (which would have let duplicate generic
-- links slip through) but a partial index closes that gap while still allowing
-- many entry-tied rows per combo.

alter table public.schedule_pms_links
  add column entry_id uuid references public.entries(id) on delete set null;

-- link_kind, NOT `entry_id is null`, is the generic-vs-entry-tied
-- discriminator. entry_id can go NULL on its own via the FK's
-- `on delete set null` when an entries row is deleted; if nullness were the
-- discriminator, that delete would either abort on the one-generic-per-combo
-- unique index (when the combo already has a real generic link) or silently
-- promote an orphaned entry-tied row into what every code path reads as "the
-- generic link". An explicit column makes the FK's side effect inert: a link's
-- kind never changes behind the code's back. See the final-review C2 finding
-- and docs/superpowers/specs/2026-09-15-pms-per-account-tasks-design.md.
--
-- `default 'generic'` is correct for the pre-existing rows this backfills:
-- every schedule_pms_links row that existed before this feature was a
-- plan-level link. Application code never relies on the default -- both
-- insert call sites pass link_kind explicitly (src/lib/queries.ts's
-- insertSchedulePmsLink requires it) -- the default exists only to make this
-- `not null` add-column valid and to keep any future raw insert safe.
alter table public.schedule_pms_links
  add column link_kind text not null default 'generic'
    check (link_kind in ('generic', 'entry'));

alter table public.schedule_pms_links
  drop constraint schedule_pms_links_tab_brand_key_platform_date_key;

create unique index schedule_pms_links_one_generic_per_combo
  on public.schedule_pms_links (tab, brand_key, platform, date)
  where link_kind = 'generic';

create unique index schedule_pms_links_one_per_entry
  on public.schedule_pms_links (tab, brand_key, platform, date, entry_id)
  where link_kind = 'entry';
