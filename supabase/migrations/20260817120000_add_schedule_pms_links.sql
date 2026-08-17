-- supabase/migrations/20260817120000_add_schedule_pms_links.sql
-- Schedule Planner -> PMS task sync (docs/superpowers/specs/2026-08-17-schedule-planner-pms-sync-design.md):
--
-- schedule_pms_links is the single source of truth for two questions:
--   - idempotency (push): has this exact (tab, brand_key, platform, date)
--     already got a PMS task, so a re-run of ensureWeekGenerated or a
--     repeated manual click never creates a duplicate?
--   - ownership (pull): which PMS task does this exact scheduled day belong
--     to, so a due-date edit made directly in PMS can be detected and
--     reflected back onto the calendar?
--
-- brand_key follows this project's standing convention (brand_schedule,
-- schedule_hidden_brands, etc.): raw `brand` stored, `brand_key` generated
-- (lower+trim) so brand matching is case/whitespace-insensitive everywhere.
--
-- Only the sync-schedule-pms and generate-weekly-schedule Edge Functions
-- (service-role client) ever write this table -- no browser code writes to
-- it directly. All four RLS policies are still defined explicitly, matching
-- every other flag table in this project (see schedule_hidden_brands),
-- rather than relying on "nothing browser-side ever calls insert/update/
-- delete" as an implicit guarantee.

create table public.schedule_pms_links (
  id          uuid primary key default gen_random_uuid(),
  tab         text not null,
  brand       text not null,
  brand_key   text generated always as (lower(btrim(brand))) stored,
  platform    text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  date        date not null,
  pms_task_id text not null,
  created_at  timestamptz not null default now(),
  unique (tab, brand_key, platform, date)
);

alter table public.schedule_pms_links enable row level security;

create policy "anyone can read schedule_pms_links"
  on public.schedule_pms_links for select using (true);
create policy "approved users can insert schedule_pms_links"
  on public.schedule_pms_links for insert with check (public.is_approved());
create policy "approved users can update schedule_pms_links"
  on public.schedule_pms_links for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete schedule_pms_links"
  on public.schedule_pms_links for delete using (public.is_approved());
