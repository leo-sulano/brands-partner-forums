-- Read-only view for the separately-hosted BIF Dashboard to query/subscribe
-- to TP Brand Injection ("BIF") review-account data directly, without
-- depending on this repo's internal `data` jsonb key names.
--
-- `create or replace view` (not `create view`) so this migration stays safe
-- to re-run: it may be applied manually via the Supabase SQL Editor (no DB
-- credential is available in this session) and later re-applied by
-- `supabase db push` from a linked checkout without failing on
-- "relation already exists" and blocking every later migration.
--
-- trustpilot_added_date is raw text from mixed source formats: both
-- YYYY-MM-DD and day-first DD/MM/YYYY appear. Do not blindly cast to
-- date under a MDY DateStyle — DD/MM/YYYY values will parse wrong or
-- error. Parse day-first explicitly, or treat as opaque display text.
--
-- brand_url is the raw stored href only. The main app additionally
-- falls back to a code-side brand->URL map (BRAND_TP_URLS in
-- tab-configs.ts) when this is empty, so brand_url may be NULL here
-- for rows where the app still displays a working link.
--
-- review_status is free text from a fixed vocabulary in the source app:
-- Live, Published, Done, Pending, On Pause, Not done, Not Published,
-- Refused, Removed. No derived boolean (is_live/is_removed) is exposed —
-- BIF must classify these values itself if it needs that distinction.
--
-- No stable default ordering is guaranteed by Postgres for a view without
-- an ORDER BY. BIF should `order by row_index nulls last` when querying,
-- matching this app's own display order.
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
  data->>'Review Status'                    as review_status,
  updated_at
from public.entries
where tab = 'TP Brand Injection';
