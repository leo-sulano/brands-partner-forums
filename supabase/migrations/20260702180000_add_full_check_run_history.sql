-- Full-check run history + per-run removed-entry snapshots, replacing the
-- client-only localStorage history on the Check Status page.
create table public.full_check_runs (
  id      uuid primary key default gen_random_uuid(),
  run_at  timestamptz not null default now(),
  scope   jsonb not null,  -- { tabsRun, tabsTotal, brandsRun, brandsTotal }
  summary jsonb not null   -- TabStatusRow[] as computed by fetchAllTabsStatusSummary
);
create index full_check_runs_run_at_idx on public.full_check_runs (run_at desc);

create table public.full_check_removed_entries (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.full_check_runs(id) on delete cascade,
  entry_id     uuid references public.entries(id) on delete set null,
  tab          text not null,
  brand        text,
  account_name text,
  platform     text not null check (platform in ('TP','AG','CG')),
  link         text,
  created_at   timestamptz not null default now()
);
create index full_check_removed_entries_run_idx on public.full_check_removed_entries (run_id, tab, brand);

alter table public.full_check_runs enable row level security;
alter table public.full_check_removed_entries enable row level security;

create policy "approved users can read full_check_runs"
  on public.full_check_runs for select using (public.is_approved());
create policy "approved users can insert full_check_runs"
  on public.full_check_runs for insert with check (public.is_approved());
create policy "approved users can delete full_check_runs"
  on public.full_check_runs for delete using (public.is_approved());

create policy "approved users can read full_check_removed_entries"
  on public.full_check_removed_entries for select using (public.is_approved());
create policy "approved users can insert full_check_removed_entries"
  on public.full_check_removed_entries for insert with check (public.is_approved());
create policy "approved users can delete full_check_removed_entries"
  on public.full_check_removed_entries for delete using (public.is_approved());
