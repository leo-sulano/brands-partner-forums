-- Fixes a real gap the hardcoded-tab-rename feature's own final review
-- caught: this view's `where tab = 'TP Brand Injection'` predicate is a
-- literal string, so renaming that tab (via the new rename_hardcoded_tab
-- RPC) would silently rewrite entries.tab out from under it, making the
-- externally-hosted BIF Dashboard's query/subscription return zero rows
-- with no error on either side. `TP Brand Injection` is literally BITP,
-- the tab this whole feature was requested for.
--
-- rename_hardcoded_tab's own information_schema-driven loop can't fix this
-- itself -- a view exposes no `tab` column of its own for it to find. This
-- migration instead makes the view resolve the tab name it filters on
-- through hardcoded_tab_renames at query time, the same way the app's own
-- resolveHardcodedTabKey() resolves a live/current name back to its
-- permanent original -- here run in reverse (original -> current), since a
-- view has to match entries.tab's actual live value, not the permanent key.
-- A tab never renamed has no row in hardcoded_tab_renames, so the coalesce
-- falls back to the literal original name unchanged -- today's behavior,
-- byte for byte, until the first real rename of this tab.
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
where tab = coalesce(
  (select current_name from public.hardcoded_tab_renames where original_name = 'TP Brand Injection'),
  'TP Brand Injection'
);
