-- Schedule Planner moves from one recurring Mon-Fri template per (tab, brand)
-- to real per-week tracking (docs/superpowers/specs/2026-07-31-schedule-planner-per-week-design.md),
-- matching how the source spreadsheet (csv/Scheduled_Planner.xlsx) actually
-- tracked a distinct status per calendar week. Existing rows were all
-- written during the week of 2026-07-27 (the initial csv migration plus
-- some live usage on TP Brand Injection) -- backfill them to that week
-- before the column becomes NOT NULL, so nothing already saved is lost or
-- silently reassigned to the wrong week.

alter table public.brand_schedule add column week_start date;
update public.brand_schedule set week_start = '2026-07-27' where week_start is null;
alter table public.brand_schedule alter column week_start set not null;

alter table public.brand_schedule drop constraint brand_schedule_tab_brand_key_key;
alter table public.brand_schedule
  add constraint brand_schedule_tab_brand_key_week_start_key
  unique (tab, brand_key, week_start);
