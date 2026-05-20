# Trustpilot Review Status Auto-Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect each Trustpilot review's current state (Published / Pending / Refused / Removed) by fetching the stored `profile_url`, and update the TP status column in the `entries` table — running daily via pg_cron and on demand via a UI button.

**Architecture:** A new Deno Edge Function `check-review-status` reads all `entries` rows that have a `Link to the profile` value and aren't already `Refused`, fetches each URL with a browser-like User-Agent, parses Trustpilot's embedded `__NEXT_DATA__` JSON to determine the review state, and writes back only changed statuses. A "Check Status" button in `BrandGroup.tsx` calls the function for the current tab; pg_cron fires it daily at 08:00 UTC for all tabs.

**Tech Stack:** Deno · Supabase Edge Functions · supabase-js v2 · React 19 · TypeScript · pg_cron · net extension · Lucide icons · existing Toast component

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `supabase/functions/check-review-status/parser.ts` | Pure TP HTML → status extraction |
| Create | `supabase/functions/check-review-status/parser_test.ts` | Unit tests for parser |
| Create | `supabase/functions/check-review-status/index.ts` | Edge Function entry point |
| Modify | `supabase/schema.sql` | Add pg_cron daily job |
| Modify | `.env.example` | Document new VITE_CHECK_STATUS_URL |
| Modify | `src/lib/supabase.ts` | Export CHECK_STATUS_URL constant |
| Modify | `src/lib/queries.ts` | Add triggerStatusCheck() |
| Modify | `src/pages/BrandGroup.tsx` | Add Check Status button + Toast |

---

### Task 1: TP HTML Parser Module

The parser extracts a review status from a raw Trustpilot HTML string. Pure function — no I/O, fully unit testable.

**Files:**
- Create: `supabase/functions/check-review-status/parser.ts`
- Create: `supabase/functions/check-review-status/parser_test.ts`

- [ ] **Step 1: Create parser.ts**

```typescript
export type TpStatus = 'Published' | 'Pending' | 'Refused' | 'Removed';

const STATE_MAP: Record<string, TpStatus> = {
  published: 'Published',
  pending: 'Pending',
  refused: 'Refused',
  archived: 'Removed',
  flagged: 'Removed',
  removed: 'Removed',
};

export function parseReviewStatus(html: string): TpStatus | null {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s,
  );
  if (!match) return null;

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }

  // deno-lint-ignore no-explicit-any
  const review = (data as any)?.props?.pageProps?.review;
  if (!review) return null;

  const rawState: string | undefined = review.state ?? review.status;
  if (!rawState) return null;

  return STATE_MAP[rawState.toLowerCase()] ?? null;
}
```

- [ ] **Step 2: Create parser_test.ts**

```typescript
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { parseReviewStatus } from './parser.ts';

function makeHtml(state: string): string {
  const payload = JSON.stringify({
    props: { pageProps: { review: { state } } },
  });
  return `<html><script id="__NEXT_DATA__" type="application/json">${payload}</script></html>`;
}

Deno.test('published → Published', () =>
  assertEquals(parseReviewStatus(makeHtml('published')), 'Published'));

Deno.test('pending → Pending', () =>
  assertEquals(parseReviewStatus(makeHtml('pending')), 'Pending'));

Deno.test('refused → Refused', () =>
  assertEquals(parseReviewStatus(makeHtml('refused')), 'Refused'));

Deno.test('archived → Removed', () =>
  assertEquals(parseReviewStatus(makeHtml('archived')), 'Removed'));

Deno.test('flagged → Removed', () =>
  assertEquals(parseReviewStatus(makeHtml('flagged')), 'Removed'));

Deno.test('unknown state → null', () =>
  assertEquals(parseReviewStatus(makeHtml('something_new')), null));

Deno.test('no __NEXT_DATA__ → null', () =>
  assertEquals(parseReviewStatus('<html><body>404</body></html>'), null));

Deno.test('malformed JSON → null', () => {
  const html = `<html><script id="__NEXT_DATA__" type="application/json">NOTJSON</script></html>`;
  assertEquals(parseReviewStatus(html), null);
});
```

- [ ] **Step 3: Run parser tests**

```bash
cd "supabase/functions/check-review-status"
deno test parser_test.ts
```

Expected output: `ok | 8 passed | 0 failed`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/check-review-status/parser.ts supabase/functions/check-review-status/parser_test.ts
git commit -m "feat(check-review-status): add trustpilot HTML parser with unit tests"
```

---

### Task 2: Edge Function Entry Point

**Files:**
- Create: `supabase/functions/check-review-status/index.ts`

The function accepts an optional `{ tab }` body. Without it, all tabs are checked (for the scheduled run). With it, only entries from that tab are checked (for the UI button).

TP status columns vary by tab. The function checks each of these known column names and uses the first one found in the entry's data:
```
'TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status',
'Trust pilot Review Status', 'Review Status'
```

- [ ] **Step 1: Create index.ts**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseReviewStatus, type TpStatus } from './parser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DELAY_MS = 600;

const TP_STATUS_COLS = [
  'TP Review Status',
  'Trust Pilot Review Status',
  'Trustpilot Review Status',
  'Trust pilot Review Status',
  'Review Status',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function findStatusCol(data: Record<string, unknown>): string | null {
  return TP_STATUS_COLS.find((col) => col in data) ?? null;
}

async function fetchTpStatus(url: string): Promise<TpStatus | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'manual',
    });

    // 3xx redirect away from the review URL = review removed/gone
    if (res.status >= 301 && res.status <= 308) return 'Removed';
    if (res.status === 404) return 'Removed';
    if (res.status !== 200) return null; // unexpected — skip

    const html = await res.text();
    return parseReviewStatus(html);
  } catch {
    return null; // network error — skip, don't corrupt DB
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  let tab: string | undefined;
  try {
    const body = await req.json();
    tab = body?.tab;
  } catch {
    // no body or invalid JSON — run against all tabs (scheduled mode)
  }

  // Fetch entries that have a profile URL and are not in a final-refused state
  // deno-lint-ignore no-explicit-any
  let query = (admin as any).from('entries').select('id, tab, data');
  if (tab) query = query.eq('tab', tab);

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) return json({ error: fetchErr.message }, 500);

  // deno-lint-ignore no-explicit-any
  const entries: any[] = (rows ?? []).filter((e: any) => {
    const profileUrl = e.data?.['Link to the profile'];
    const statusCol = findStatusCol(e.data ?? {});
    if (!profileUrl || profileUrl.trim() === '') return false;
    if (!statusCol) return false; // no recognisable TP status column
    return e.data[statusCol] !== 'Refused';
  });

  let checked = 0;
  let updated = 0;
  let errors = 0;

  for (const entry of entries) {
    checked++;

    const rawUrl: string = entry.data['Link to the profile'].trim();
    const profileUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const statusCol = findStatusCol(entry.data)!;
    const currentStatus: string = entry.data[statusCol] ?? '';

    const newStatus = await fetchTpStatus(profileUrl);

    if (newStatus === null) {
      errors++;
    } else if (newStatus !== currentStatus) {
      const updatedData = { ...entry.data, [statusCol]: newStatus };
      const { error: updateErr } = await admin
        .from('entries')
        .update({ data: updatedData })
        .eq('id', entry.id);

      if (updateErr) errors++;
      else updated++;
    }

    // Rate-limit: wait between requests (skip after the last one)
    if (checked < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  return json({ checked, updated, errors });
});
```

- [ ] **Step 2: Smoke-test with supabase CLI**

In a separate terminal:
```bash
supabase functions serve check-review-status --no-verify-jwt
```

Then in another terminal:
```bash
curl -s -X POST http://localhost:54321/functions/v1/check-review-status \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

Expected: `{ "checked": <N>, "updated": <N>, "errors": <N> }` — no 500 errors, no stack traces.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/check-review-status/index.ts
git commit -m "feat(check-review-status): add edge function to auto-detect trustpilot review status"
```

---

### Task 3: Schema — pg_cron Daily Job

**Files:**
- Modify: `supabase/schema.sql`

**Prerequisites:** In the Supabase dashboard, enable the `pg_net` extension under Database → Extensions (it enables `net.http_post`). `pg_cron` is enabled by default on Supabase.

- [ ] **Step 1: Add cron job at the end of schema.sql**

```sql
-- ---------------------------------------------------------------------------
-- Daily Trustpilot review status check — runs at 08:00 UTC
-- Requires pg_cron and pg_net extensions to be enabled.
-- Replace the URL with your actual deployed function URL.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'check-tp-review-status-daily',
  '0 8 * * *',
  $$
    SELECT net.http_post(
      'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/check-review-status',
      '{}',
      'application/json'
    )
  $$
);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(schema): add pg_cron job for daily trustpilot review status check"
```

---

### Task 4: Client-Side Trigger — queries.ts + env

**Files:**
- Modify: `src/lib/supabase.ts`
- Modify: `src/lib/queries.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add CHECK_STATUS_URL export to src/lib/supabase.ts**

Add this line after the existing exports (after line 16):

```typescript
export const CHECK_STATUS_URL = import.meta.env.VITE_CHECK_STATUS_URL ?? '';
```

- [ ] **Step 2: Add triggerStatusCheck to src/lib/queries.ts**

Add this at the end of the file (after the existing `triggerSync` function):

```typescript
// ---------------------------------------------------------------------------
// TP review status check trigger
// ---------------------------------------------------------------------------

export async function triggerStatusCheck(
  tab: string,
): Promise<{ checked: number; updated: number; errors: number }> {
  if (!CHECK_STATUS_URL) {
    throw new Error(
      'VITE_CHECK_STATUS_URL is not configured — check .env',
    );
  }
  const res = await fetch(CHECK_STATUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ tab }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Status check failed: ${res.status} ${body}`);
  }
  return res.json();
}
```

- [ ] **Step 3: Add CHECK_STATUS_URL to the import at the top of queries.ts**

The first line of `src/lib/queries.ts` currently reads:
```typescript
import { supabase, SYNC_FUNCTION_URL, PUSH_TO_SHEET_URL, SUPABASE_ANON_KEY } from './supabase';
```

Change it to:
```typescript
import { supabase, SYNC_FUNCTION_URL, PUSH_TO_SHEET_URL, SUPABASE_ANON_KEY, CHECK_STATUS_URL } from './supabase';
```

- [ ] **Step 4: Add VITE_CHECK_STATUS_URL to .env.example**

After the existing `VITE_PUSH_TO_SHEET_URL` line, add:

```
VITE_CHECK_STATUS_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/check-review-status
```

Also add the description comment on the line above `VITE_PUSH_TO_SHEET_URL`:

```
# VITE_CHECK_STATUS_URL: "Check Status" button — fetches live TP review state for the current tab
```

- [ ] **Step 5: Add VITE_CHECK_STATUS_URL to your local .env file**

```
VITE_CHECK_STATUS_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/check-review-status
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase.ts src/lib/queries.ts .env.example
git commit -m "feat(queries): add triggerStatusCheck and CHECK_STATUS_URL env export"
```

---

### Task 5: BrandGroup UI — Check Status Button

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

- [ ] **Step 1: Add imports**

In BrandGroup.tsx, the existing lucide-react import (line 3) currently includes: `CheckCircle2, XCircle, Circle, Building2, ExternalLink, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown, Search, X, Check, CalendarDays, Plus`.

Add `RefreshCw` to that import:

```typescript
import { CheckCircle2, XCircle, Circle, Building2, ExternalLink,
  ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown,
  Search, X, Check, CalendarDays, Plus, RefreshCw,
} from 'lucide-react';
```

Add Toast import after the existing component imports (after the `AddReviewAccountModal` import):

```typescript
import Toast, { type ToastKind } from '../components/Toast';
```

Add `triggerStatusCheck` to the queries import (line 11):

```typescript
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck } from '../lib/queries';
```

- [ ] **Step 2: Add state inside BrandGroup component**

After the existing state declarations (find the block with `useState` calls near the top of the `BrandGroup` function body), add:

```typescript
const [checkingStatus, setCheckingStatus] = useState(false);
const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
const [lastChecked, setLastChecked] = useState<string | null>(
  () => localStorage.getItem(`lastStatusCheck_${decodedTab}`) ?? null,
);
```

- [ ] **Step 3: Add handleCheckStatus handler**

Inside the BrandGroup component, just before the `return (` statement, add:

```typescript
async function handleCheckStatus() {
  setCheckingStatus(true);
  try {
    const result = await triggerStatusCheck(decodedTab);
    const now = new Date().toLocaleString();
    localStorage.setItem(`lastStatusCheck_${decodedTab}`, now);
    setLastChecked(now);
    const msg =
      result.updated > 0
        ? `${result.updated} review${result.updated !== 1 ? 's' : ''} updated`
        : 'All reviews up to date';
    setToast({ message: msg, kind: 'success' });
  } catch (err) {
    setToast({ message: 'Check failed — try again', kind: 'error' });
    console.error(err);
  } finally {
    setCheckingStatus(false);
  }
}
```

- [ ] **Step 4: Add Check Status button in the filter bar**

In the search + filter bar section (around line 1010, just after the closing `}` of the last `FilterDropdown` / `activePlatforms` conditional block and before the closing `</div>` of the filter bar), add:

```tsx
          <div className="h-4 w-px bg-slate-200 shrink-0" />
          <div className="flex items-center gap-2">
            {lastChecked && (
              <span className="text-xs text-slate-400 whitespace-nowrap">
                Last checked: {lastChecked}
              </span>
            )}
            <button
              type="button"
              onClick={handleCheckStatus}
              disabled={checkingStatus}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`size-3.5 ${checkingStatus ? 'animate-spin' : ''}`} />
              {checkingStatus ? 'Checking…' : 'Check Status'}
            </button>
          </div>
```

- [ ] **Step 5: Render Toast**

Near the bottom of the BrandGroup component's JSX return, just before the final closing `</div>` of the page wrapper, add:

```tsx
      {toast && (
        <Toast
          message={toast.message}
          kind={toast.kind}
          onClose={() => setToast(null)}
        />
      )}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no TypeScript errors, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat(ui): add Check Status button to BrandGroup for trustpilot review auto-detection"
```

---

## Deployment Checklist

After all tasks are committed:

- [ ] Deploy Edge Function: `supabase functions deploy check-review-status`
- [ ] Enable `pg_net` extension in Supabase Dashboard → Database → Extensions
- [ ] Run schema.sql cron section in the Supabase SQL editor to register the daily job
- [ ] Add `VITE_CHECK_STATUS_URL` to Vercel environment variables
- [ ] Redeploy frontend on Vercel
- [ ] Click "Check Status" on a tab with known profile URLs and confirm the toast shows correct counts
