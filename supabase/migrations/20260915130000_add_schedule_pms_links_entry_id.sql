-- supabase/migrations/20260915130000_add_schedule_pms_links_entry_id.sql
-- Per-account PMS task cards (docs/superpowers/specs/2026-09-15-pms-per-account-tasks-design.md):
-- lets more than one PMS task exist for the same (tab, brand_key, platform, date)
-- combo, one per real account (entry), on top of the existing single "generic"
-- plan-level task. entry_id NULL = the existing generic link (unchanged
-- behavior); entry_id set = a new entry-tied link for one specific account.
--
-- The old plain `unique (tab, brand_key, platform, date)` constraint is
-- replaced by two partial unique indexes, since Postgres allows multiple NULLs
-- under a plain unique constraint (which would have let duplicate generic
-- links slip through) but a partial index with `where entry_id is null` closes
-- that gap while still allowing many entry-tied rows per combo.

alter table public.schedule_pms_links
  add column entry_id uuid references public.entries(id) on delete set null;

alter table public.schedule_pms_links
  drop constraint schedule_pms_links_tab_brand_key_platform_date_key;

create unique index schedule_pms_links_one_generic_per_combo
  on public.schedule_pms_links (tab, brand_key, platform, date)
  where entry_id is null;

create unique index schedule_pms_links_one_per_entry
  on public.schedule_pms_links (tab, brand_key, platform, date, entry_id)
  where entry_id is not null;
