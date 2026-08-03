# BIF Dashboard Integration: Read-Only Review Accounts View

## Problem

The client wants BITP ("BIF") brand-tab review-account data — accounts, agents,
proxies, brand links, and TP status — visible on a separate, already-existing
"BIF Dashboard" (hosted elsewhere, its own Supabase project) that today only shows
SEO rankings for those brands. Forums Dashboard is the sole place these accounts get
added/edited (no external sync exists for this data), so BIF needs a way to see
current state without this dashboard's team doing any extra manual step per change.

BIF already has its own Supabase-based backend and can reach this project's Supabase
project directly. The `entries` table (which holds this data, tab-scoped, one row per
account, real fields inside a `data jsonb` column) is already publicly readable — RLS
policy `"anyone can read entries" using (true)` — and already broadcasts live changes,
since `public.entries` was added to the `supabase_realtime` publication in
`supabase/migrations/20260528000000_enable_realtime_entries.sql`. So the only piece
missing is a stable, decoupled read surface: today BIF would have to read raw jsonb
keyed by this dashboard's internal column names (e.g. `'Brand / TP URL PAGE__href'`),
which could silently break if those names ever change here.

## Data model

New file, `supabase/migrations/<ts>_add_bif_review_accounts_view.sql`:

```sql
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
```

`security_invoker = true` means the view runs with the querying role's own
permissions rather than the view owner's, so it inherits `entries`' existing "anyone
can read" policy automatically — no new grants or RLS objects needed. Column names on
the view are stable, human-readable identifiers independent of this repo's internal
`data` jsonb keys, matching the pattern in [[Account Surname Trailing Space]] where the
underlying sheet-derived key names have drifted before.

No changes to `entries`, `tab-configs.ts`, or any application code in this repo — this
view has exactly one consumer (BIF Dashboard) and this dashboard's own UI never reads
it.

## Data flow

- **Initial load**: BIF queries `select * from bif_review_accounts` directly with its
  existing anon key (that key isn't tab-scoped, so BIF's query is what enforces the
  `TP Brand Injection` boundary — already true today for the raw `entries` table too).
- **Live updates**: `postgres_changes` on views isn't supported by Supabase Realtime,
  so BIF keeps subscribing to raw `entries` changes filtered to
  `tab=eq.'TP Brand Injection'` (already broadcasting, no change needed) purely as a
  "something changed" signal, then re-queries `bif_review_accounts` for the clean row
  data.

## Out of scope

- No join against `removed_platform_brands` (the TP-page-removed flag) — the view
  surfaces raw current state only. If BIF later needs to hide/flag brands whose TP
  page was pulled down, that's a small follow-on join, not needed for a first cut.
- No push/write path in either direction. BIF never writes to this Supabase project;
  this dashboard never writes to BIF's.
- No new table, no schema change to `entries`, no new RLS policy — the view is the
  entire change.
- No application code changes in this repo. BIF-side consumption code lives in BIF's
  own project.

## Testing

No DB credential is available in this session, consistent with prior migrations in
this repo (see history in `CLAUDE.md`) — the migration file will be applied manually
via the Supabase SQL Editor, then verified:

- `select * from public.bif_review_accounts limit 5;` returns rows whose values match
  what's currently visible in the TP Brand Injection tab in the app (spot-check a
  couple of known brands/accounts).
- Editing an account's Review Status in the app, then re-running the same select,
  shows the updated value with no propagation delay (it's a live view over `entries`,
  not a copy).
- From BIF's side (out of scope for this repo, but part of the acceptance check):
  confirm a `postgres_changes` subscription on `entries` filtered to
  `tab=eq.'TP Brand Injection'` fires on an edit made here, and BIF's refetch of
  `bif_review_accounts` reflects it.
