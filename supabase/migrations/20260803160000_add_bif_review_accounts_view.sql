-- Read-only view for the separately-hosted BIF Dashboard to query/subscribe
-- to TP Brand Injection ("BIF") review-account data directly, without
-- depending on this repo's internal `data` jsonb key names.
create view public.bif_review_accounts
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
