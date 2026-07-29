-- Final-review fix wave for the TP-removed brand flag feature
-- (docs/superpowers/specs/2026-07-29-tp-removed-brands-design.md).
--
-- Critical #1: setBrandTpRemoved's upsert (src/lib/queries.ts) issues
-- `INSERT ... ON CONFLICT (tab, brand) DO UPDATE` whenever the (tab, brand)
-- row already exists. Supabase's default upsert RLS check requires an UPDATE
-- policy to pass the conflict-row check — the original migration
-- (20260729130000) only added SELECT/INSERT/DELETE, so every re-flag of an
-- already-flagged brand fails with a 42501 RLS error. Add the missing policy.
create policy "approved users can update removed_tp_brands"
  on public.removed_tp_brands for update
  using (public.is_approved())
  with check (public.is_approved());

-- Critical #2: every read path (BrandGroup's isTpRemoved, scoreSummary.ts's
-- exclusion checks) matches brand names case-insensitively/trimmed via
-- tpRemovedKey in src/lib/removedTpBrands.ts. setBrandTpRemoved's writes did
-- not — they matched/stored the raw, unnormalized string. Real production
-- data already has drift (TP Affiliate's actual stored brand value is
-- "Online Casino Deutschland " with a trailing space, while the seed row has
-- none), so unchecking "TP page removed" for that brand issued a DELETE that
-- matched 0 rows — no error, but also no effect: the badge and Score Summary
-- exclusion silently persisted. Add a normalized, generated column and key
-- the uniqueness/lookup off it, mirroring tpRemovedKey's own normalization
-- (lowercase + trim on brand; tab stays exact/case-sensitive).
alter table public.removed_tp_brands
  add column brand_key text generated always as (lower(btrim(brand))) stored;

-- Replace the (tab, brand) uniqueness with (tab, brand_key) so two brand
-- strings differing only in case/whitespace can't produce duplicate rows,
-- and so the app's DELETE/upsert (now keyed on brand_key, see queries.ts)
-- has a matching constraint to upsert against.
alter table public.removed_tp_brands
  drop constraint removed_tp_brands_tab_brand_key;
alter table public.removed_tp_brands
  add constraint removed_tp_brands_tab_brand_key_key unique (tab, brand_key);
