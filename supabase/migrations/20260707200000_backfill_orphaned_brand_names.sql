-- AddReviewAccountModal.tsx hardcoded the brand-name field key as 'Brand Name'
-- for every tab, but the real brand-identity column differs per tab (e.g.
-- 'Brands' for Rooster Partners/SilverPlay/Trybet, 'Brand / TP URL PAGE' for
-- TP Brand Injection). 12 rows created via "Add Review Account" ended up
-- brand-orphaned as a result: their brand text landed under a stray
-- 'Brand Name' key instead of the column the table view actually reads.
-- Move it to the correct column and drop the stray key. Scoped tightly so it
-- can only touch rows that actually have the bug (dashboard-created, real
-- column empty, stray key populated).
-- See docs/superpowers/specs/2026-07-07-unified-brand-link-design.md.

update public.entries
set data = (data - 'Brand Name') || jsonb_build_object('Brands', data->>'Brand Name')
where tab in ('Rooster Partners', 'SilverPlay', 'Trybet')
  and sheet_row_id like 'dashboard-%'
  and coalesce(data->>'Brands', '') = ''
  and coalesce(data->>'Brand Name', '') <> '';

update public.entries
set data = (data - 'Brand Name') || jsonb_build_object('Brand / TP URL PAGE', data->>'Brand Name')
where tab = 'TP Brand Injection'
  and sheet_row_id like 'dashboard-%'
  and coalesce(data->>'Brand / TP URL PAGE', '') = ''
  and coalesce(data->>'Brand Name', '') <> '';
