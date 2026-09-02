-- Schedule Planner public-holiday blocking
-- (docs/superpowers/specs/2026-09-02-schedule-planner-public-holidays-design.md).
--
-- One row per non-working public holiday. Global (not per-tab): a "local"
-- holiday here means local to where the team physically sits, so it stops
-- the whole team's posting workload regardless of which tab is scheduled.
-- The Schedule Planner scheduler reads this table, converts any holiday that
-- falls on a Mon-Fri of the week being generated into an "unavailable day",
-- and load-balances that week's posts across the remaining working days.
--
-- Seeded below with FIXED-DATE national non-working holidays for 2026-2027
-- only. Movable national holidays (Holy Week, National Heroes Day, Eid'l
-- Fitr, Eid'l Adha, Chinese New Year, EDSA anniversary) AND all local/city
-- holidays are added by the team through the Public Holidays modal in the
-- app. Do NOT add "special working" days here -- this table is non-working
-- days only.

create table public.public_holidays (
  id         uuid primary key default gen_random_uuid(),
  date       date not null unique,
  name       text not null,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.public_holidays enable row level security;

create policy "anyone can read public_holidays"
  on public.public_holidays for select using (true);
create policy "approved users can insert public_holidays"
  on public.public_holidays for insert with check (public.is_approved());
create policy "approved users can update public_holidays"
  on public.public_holidays for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete public_holidays"
  on public.public_holidays for delete using (public.is_approved());

insert into public.public_holidays (date, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-04-09', 'Araw ng Kagitingan'),
  ('2026-05-01', 'Labor Day'),
  ('2026-06-12', 'Independence Day'),
  ('2026-08-21', 'Ninoy Aquino Day'),
  ('2026-11-01', 'All Saints'' Day'),
  ('2026-11-30', 'Bonifacio Day'),
  ('2026-12-08', 'Feast of the Immaculate Conception'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-30', 'Rizal Day'),
  ('2026-12-31', 'Last Day of the Year'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-04-09', 'Araw ng Kagitingan'),
  ('2027-05-01', 'Labor Day'),
  ('2027-06-12', 'Independence Day'),
  ('2027-08-21', 'Ninoy Aquino Day'),
  ('2027-11-01', 'All Saints'' Day'),
  ('2027-11-30', 'Bonifacio Day'),
  ('2027-12-08', 'Feast of the Immaculate Conception'),
  ('2027-12-25', 'Christmas Day'),
  ('2027-12-30', 'Rizal Day'),
  ('2027-12-31', 'Last Day of the Year')
on conflict (date) do nothing;
