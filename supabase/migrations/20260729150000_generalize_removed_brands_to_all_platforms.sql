-- Generalizes the TP-only "page removed" flag (removed_tp_brands, added in
-- 20260729130000 + 20260729140000) to independently cover all 4 platforms:
-- TrustPilot, AskGamblers, CasinoGuru, Wizard of Odds. A brand's page on any
-- one platform can be delisted without implying anything about its pages on
-- the others — each (tab, brand, platform) triple is flagged independently.
--
-- Existing rows (all TP-only, from the original feature) backfill to
-- platform = 'tp' automatically — zero behavior change for brands already
-- flagged before this migration.

alter table public.removed_tp_brands rename to removed_platform_brands;

alter table public.removed_platform_brands
  add column platform text not null default 'tp'
    check (platform in ('tp', 'ag', 'cg', 'wo'));
alter table public.removed_platform_brands alter column platform drop default;

-- Widen uniqueness from (tab, brand_key) to (tab, brand_key, platform) — the
-- same brand can now have independent rows per platform.
alter table public.removed_platform_brands
  drop constraint removed_tp_brands_tab_brand_key_key;
alter table public.removed_platform_brands
  add constraint removed_platform_brands_tab_brand_key_platform_key
    unique (tab, brand_key, platform);

-- Rename the 4 RLS policies to match the new table name (cosmetic only — no
-- permission logic changes; Postgres ties policies to the table by OID, not
-- name, so this step is purely for readability, not required for the table
-- to keep working).
alter policy "anyone can read removed_tp_brands"
  on public.removed_platform_brands rename to "anyone can read removed_platform_brands";
alter policy "approved users can insert removed_tp_brands"
  on public.removed_platform_brands rename to "approved users can insert removed_platform_brands";
alter policy "approved users can update removed_tp_brands"
  on public.removed_platform_brands rename to "approved users can update removed_platform_brands";
alter policy "approved users can delete removed_tp_brands"
  on public.removed_platform_brands rename to "approved users can delete removed_platform_brands";
