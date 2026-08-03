-- Fixes a critical defect in the previous migration
-- (20260803160000_add_bif_review_accounts_view.sql): review_status read only
-- data->>'Review Status', but live-verification against real data found
-- ZERO of TP Brand Injection's 793 rows use that exact key — all 793 use
-- 'TP Review Status' instead. review_status was returning NULL for every
-- single row.
--
-- This tab's data has historically been written under several raw key
-- names for the same logical status field, all display-aliased to "TP
-- Status" in COLUMN_LABELS (tab-configs.ts). The app itself already
-- resolves this ambiguity via PLATFORM_STATUS_KEYS.tp + pick()
-- (src/lib/scoreSummary.ts) with this exact precedence order — mirrored
-- here via coalesce so the view can never drift from how the rest of the
-- app already reads this field. nullif(..., '') is used (not bare
-- coalesce) so an empty-string value doesn't win over a real value in a
-- lower-precedence key, matching pick()'s behavior of also skipping ''.
--
-- review_status is still free text from the same fixed vocabulary noted in
-- the original migration: Live, Published, Done, Pending, On Pause, Not
-- done, Not Published, Refused, Removed. No derived boolean is exposed.
create or replace view public.bif_review_accounts
with (security_invoker = true) as
select
  id,
  row_index,
  data->>'Account'                          as account,
  data->>'Country'                          as country,
  data->>'Proxy Used'                       as proxy_used,
  data->>'Account Name'                     as account_name,
  data->>'Agent'                            as agent,
  data->>'Brand / TP URL PAGE'              as brand_name,
  data->>'Brand / TP URL PAGE__href'        as brand_url,
  data->>'Trust Pilot'                      as trustpilot_added_date,
  data->>'Link to the profile'              as profile_link,
  coalesce(
    nullif(data->>'TP Review Status', ''),
    nullif(data->>'Trust Pilot Review Status', ''),
    nullif(data->>'Trustpilot Review Status', ''),
    nullif(data->>'Trust pilot Review Status', ''),
    nullif(data->>'Review Status', '')
  )                                          as review_status,
  updated_at
from public.entries
where tab = 'TP Brand Injection';
