# BIF Dashboard Review Accounts View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single read-only Postgres view, `public.bif_review_accounts`, that exposes TP Brand Injection (BIF) tab review-account data under stable column names so the separately-hosted BIF Dashboard can query/subscribe to it directly.

**Architecture:** One new Supabase migration file creates the view over the existing `public.entries` table, filtered to `tab = 'TP Brand Injection'`, flattening the `data jsonb` column into named columns. `security_invoker = true` means the view inherits `entries`' existing "anyone can read" RLS policy — no new RLS objects. No application code in this repo touches or reads this view; BIF Dashboard is its only consumer.

**Tech Stack:** Postgres (Supabase), SQL migration file only — no TypeScript/React changes.

## Global Constraints

- No new tables, no new RLS policies, no changes to `entries` or any TypeScript file in this repo — the view is the entire change (per spec's "Out of scope").
- View must use `with (security_invoker = true)` so it relies on `entries`' existing `"anyone can read entries" using (true)` policy rather than defining new grants.
- Column names on the view must be stable/generic identifiers (e.g. `review_status`), independent of the `data` jsonb's internal key names (e.g. `'Review Status'`), so future renames in `tab-configs.ts` only require touching this one view.
- No DB credential is available in this session — the migration is applied manually via the Supabase SQL Editor by the user, not via `supabase db push` from this session.

---

### Task 1: Add the `bif_review_accounts` migration

**Files:**
- Create: `supabase/migrations/20260803160000_add_bif_review_accounts_view.sql`

**Interfaces:**
- Consumes: `public.entries(id uuid, tab text, data jsonb, updated_at timestamptz, row_index integer)` — existing table, defined in `supabase/schema.sql:13-24`.
- Produces: `public.bif_review_accounts` view with columns `id, row_index, account, country, proxy_used, account_name, agent, brand_name, brand_url, trustpilot_added_date, profile_link, review_status, updated_at` — this is the full, final interface BIF Dashboard consumes. No later task changes it.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Verify the file was written correctly**

Run: `cat "supabase/migrations/20260803160000_add_bif_review_accounts_view.sql"` (or open it in the editor) and confirm:
- The `create view` statement matches exactly what's above (no typos in the `data->>'...'` key names — they must match `TAB_COLUMN_CONFIGS['TP Brand Injection']` in `src/lib/tab-configs.ts:66-76` exactly, including spacing, e.g. `'Brand / TP URL PAGE'` not `'Brand/TP URL Page'`).
- `with (security_invoker = true)` is present on the `create view` line.
- The `where tab = 'TP Brand Injection'` clause is present.

There is no automated test for this step — a SQL view can't be executed or type-checked without a live database connection, and none is available in this session (see Global Constraints).

- [ ] **Step 3: Commit**

```bash
git add "supabase/migrations/20260803160000_add_bif_review_accounts_view.sql"
git commit -m "$(cat <<'EOF'
feat: add read-only bif_review_accounts view for BIF Dashboard

Exposes TP Brand Injection tab review-account data (account, agent,
proxy, brand link, TP status) under stable column names so the
separately-hosted BIF Dashboard can query/subscribe directly instead
of depending on this repo's internal jsonb key names. security_invoker
means it inherits entries' existing public-read RLS policy, so no new
RLS objects are needed.
EOF
)"
```

### Task 2: Apply and verify the migration (manual, user-run)

This task has no code changes — it's the verification step from the spec, and must be run by the user since this session has no DB credential.

**Steps for the user to run, in the Supabase SQL Editor for this project (`https://krxnupmhfiduduvvlumc.supabase.co`):**

- [ ] **Step 1: Apply the migration**

Paste the contents of `supabase/migrations/20260803160000_add_bif_review_accounts_view.sql` into the SQL Editor and run it.

- [ ] **Step 2: Spot-check the view returns real data**

Run:
```sql
select * from public.bif_review_accounts limit 5;
```
Expected: 5 rows, each with an `account`, `review_status`, and other fields matching what's visible for those same accounts in the TP Brand Injection tab in the app (open the tab in another window and compare a couple of rows by account name).

- [ ] **Step 3: Verify the `anon` key can actually read the view**

The Step 2 spot-check runs in the Supabase SQL Editor, which executes as a superuser/service role — it proves the view's SQL is valid but nothing about whether BIF Dashboard's actual access path (the `anon` key over the REST API) can read it. Run this directly (from any shell, not the SQL Editor):

```bash
curl "https://krxnupmhfiduduvvlumc.supabase.co/rest/v1/bif_review_accounts?limit=1" \
  -H "apikey: sb_publishable_kuWqqYdxhcN1_GHhIFa4mA_PcV0XPs-" \
  -H "Authorization: Bearer sb_publishable_kuWqqYdxhcN1_GHhIFa4mA_PcV0XPs-"
```

Expected: HTTP 200 with a JSON array (not a 401/403 permission error). This is what settles whether `security_invoker` inheriting `entries`' "anyone can read" policy is sufficient on its own, without adding any new `grant` statement to the migration (the plan's Global Constraints deliberately rely on the existing policy rather than defining new grants — `entries` itself has no explicit grant and already works via the anon key, so the view is expected to behave the same way).

- [ ] **Step 4: Measure the `brand_url` NULL gap**

```sql
select count(*) filter (where brand_url is null) from public.bif_review_accounts;
```

`brand_url` only exposes the raw stored href — the main app additionally falls back to a code-side brand→URL map (`BRAND_TP_URLS` in `src/lib/tab-configs.ts`) when that jsonb key is empty, so some rows here will show `brand_url = NULL` even though the app displays a working link for that brand. Run this count so BIF knows the size of that gap before building against the column.

- [ ] **Step 5: Confirm live reads (no caching/staleness)**

In the app, edit one TP Brand Injection entry's Review Status to a different value and save. Re-run the Step 2 query (or `select account, review_status from public.bif_review_accounts where account = '<the account you edited>'`) and confirm the new value shows immediately — the view reads live off `entries`, so there's no propagation delay to check for.

- [ ] **Step 6: (Out of scope for this repo, informational) BIF-side confirmation**

From BIF Dashboard's own codebase/session: confirm a `postgres_changes` subscription on `public.entries` filtered to `tab=eq.'TP Brand Injection'` fires when the Step 3 edit is made, and that re-querying `bif_review_accounts` from BIF's side reflects it. This closes the loop on the "live" requirement from the spec but is verified in BIF's project, not this one.

---

## Self-Review Notes

- **Spec coverage:** The spec's "Data model" section maps to Task 1's view SQL exactly (all 9 tracked fields + `id`/`row_index`/`updated_at`). The spec's "Data flow" (initial load + realtime-as-signal) requires no code here — it's BIF-side and is called out as informational in Task 2 Step 4. The spec's "Out of scope" items (no `removed_platform_brands` join, no write path, no new table/RLS, no app code) are satisfied by there being exactly one file in this plan. The spec's "Testing" section maps 1:1 to Task 2's steps.
- **Placeholder scan:** No TBD/TODO; the only bracketed value (`20260803160000`) is a real timestamp chosen to sort after the last existing migration (`20260801090000`), not a placeholder to fill in later.
- **Type consistency:** Column names introduced in Task 1 (`account`, `country`, `proxy_used`, `account_name`, `agent`, `brand_name`, `brand_url`, `trustpilot_added_date`, `profile_link`, `review_status`, `updated_at`, `row_index`, `id`) are the same set referenced in Task 2's verification queries — no drift.
