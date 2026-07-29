-- A brand's Trustpilot page can be delisted entirely (Trustpilot takes the
-- whole review page down), independent of any single review's status. This
-- table records that fact per (tab, brand) — a brand is flagged purely by a
-- row existing here. Toggling off deletes the row (see setBrandTpRemoved in
-- src/lib/queries.ts). Matching is case-insensitive/trimmed on brand, done in
-- src/lib/removedTpBrands.ts — every reader (BrandGroup's badge, Score
-- Summary's TP-view exclusion) goes through that shared helper.

create table public.removed_tp_brands (
  id          uuid primary key default gen_random_uuid(),
  tab         text not null,
  brand       text not null,
  removed_by  text,
  removed_at  timestamptz not null default now(),
  unique (tab, brand)
);

alter table public.removed_tp_brands enable row level security;

create policy "anyone can read removed_tp_brands"
  on public.removed_tp_brands for select using (true);
create policy "approved users can insert removed_tp_brands"
  on public.removed_tp_brands for insert with check (public.is_approved());
create policy "approved users can delete removed_tp_brands"
  on public.removed_tp_brands for delete using (public.is_approved());

-- Seed: brands whose TP page is already known to be delisted.
insert into public.removed_tp_brands (tab, brand) values
  ('TP Brand Injection', 'NovaJackpot Casino'),
  ('TP Brand Injection', 'Lapalingo Casino'),
  ('TP Brand Injection', 'Prive Casino'),
  ('TP Brand Injection', 'Rabona Casino'),
  ('TP Brand Injection', 'Monsterwin Casino'),
  ('TP Brand Injection', 'Cazeus Casino'),
  ('TP Affiliate', 'Deutschlands Online Casino Spielhalle 2026'),
  ('TP Affiliate', 'Bestes Online Casino Deutschland'),
  ('TP Affiliate', 'Bestes Online Casino Deutschland Spielhalle'),
  ('TP Affiliate', 'Online Casino Deutschland'),
  ('TP Affiliate', 'Best Online Casinos Review Nz'),
  ('Hanan', 'Pribet.com'),
  ('Hanan', 'WinMega.com'),
  ('Hanan', 'RealSpin.com')
on conflict (tab, brand) do nothing;
