# AI Review Removal Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "AI Review Removal Assessment" to the Edit Entry modal that analyzes a TP/WO review's content plus its account's behavioral fields against real published guidelines, producing a structured, evidence-based verdict that can explicitly conclude "no clear removal reason detected."

**Architecture:** A new single-shot Supabase Edge Function (`review-removal-assessment`, mirrors `translate-review`'s shape — no tool-calling loop, no DB access, pure OpenAI proxy) receives the review text + this entry's own behavioral fields from the client, returns structured JSON via `gpt-4o` JSON mode. The frontend validates the shape, caches the result on the `entries` row (new columns, hash-gated staleness check), and renders it as a compact collapsible panel under the existing `ReviewTextBlock` in `EditEntryModal`.

**Tech Stack:** React 19 + TypeScript (frontend), Deno Edge Function + OpenAI `gpt-4o` (backend), Supabase Postgres (new columns on `entries`), Vitest (unit tests).

**Spec:** `docs/superpowers/specs/2026-08-14-ai-review-removal-assessment-design.md`

## Global Constraints

- TP and WO platforms only — wherever `getTabPlatforms(tab)` includes `'tp'` or `'wo'` (same gate `ReviewTextBlock` already uses in `EditEntryModal.tsx`). No AG/CG support.
- No cross-entry queries — behavioral input is limited to the single entry's own fields (`YES_NO_COLS` + `BEHAVIOR_EXTRA_COLS` from `src/lib/entryFieldSections.ts`). "Multiple reviews from the same environment" is explicitly out of scope for this plan.
- The "Analyze Review" button is always visible, regardless of the entry's current TP/WO status — framing (past-removal vs. forward-looking-risk) adapts server-side based on status, not visibility.
- `risk_score` is an integer 0-100 (higher = more risk).
- Never fabricate a Trustpilot or Wizard-of-Odds policy — TP responses cite only the fixed category list embedded in the system prompt; WO responses explicitly state no confirmed public policy framework exists.
- New DB columns live directly on `entries` (not a side table) — `ai_review_analysis jsonb`, `ai_review_analysis_hash text`, `ai_review_analysis_model text`, `ai_review_analysis_at timestamptz`. No RLS changes (existing "approved users can update entries" policy covers it).
- Saving a generated analysis does **not** create an `edit_log` audit entry — it's a derived/cached artifact, not a user edit to business data.
- Deployment (`supabase db push`, `supabase functions deploy`, Vercel env var) is explicitly deferred per this session's "local first" instruction — document as pending, do not run it.

---

### Task 1: Database migration + `Entry` type

**Files:**
- Create: `supabase/migrations/20260814150000_add_ai_review_analysis.sql`
- Modify: `src/types/entry.ts`

**Interfaces:**
- Produces: `Entry.ai_review_analysis: Record<string, unknown> | null`, `Entry.ai_review_analysis_hash: string | null`, `Entry.ai_review_analysis_model: string | null`, `Entry.ai_review_analysis_at: string | null` — all optional (`?:`) so the many existing test fixtures that construct `Entry` object literals across the repo (`queries.test.ts`, `brandExport.test.ts`, `scoreSummary.test.ts`, `scheduler/*.test.ts`) don't need updating.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260814150000_add_ai_review_analysis.sql
-- AI Review Removal Assessment: caches the structured AI analysis of a
-- single TP/WO review's content + behavioral evidence. Strictly 1:1 with
-- one entries row (same shape as last_edited_by/last_sync_tag), not a side
-- table — no RLS change needed, existing entries policies already cover
-- reads/writes to these columns.
alter table public.entries
  add column ai_review_analysis jsonb,
  add column ai_review_analysis_hash text,
  add column ai_review_analysis_model text,
  add column ai_review_analysis_at timestamptz;
```

- [ ] **Step 2: Update the `Entry` type**

Edit `src/types/entry.ts`:

```ts
export interface Entry {
  id: string;
  tab: string;
  sheet_row_id: string;
  data: Record<string, string | null>;
  updated_at: string;
  last_edited_by: 'dashboard' | 'sheet';
  last_sync_tag: string | null;
  ai_review_analysis?: Record<string, unknown> | null;
  ai_review_analysis_hash?: string | null;
  ai_review_analysis_model?: string | null;
  ai_review_analysis_at?: string | null;
}

export type EntryData = Record<string, string | null>;
```

- [ ] **Step 3: Verify the build still passes**

Run: `npm run build`
Expected: succeeds with no type errors (the 4 new fields are optional, so no existing `Entry` literal breaks).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260814150000_add_ai_review_analysis.sql src/types/entry.ts
git commit -m "feat: add ai_review_analysis columns to entries"
```

---

### Task 2: `src/lib/reviewRemovalAssessment.ts` — types, hashing, response validation, fetch

**Files:**
- Create: `src/lib/reviewRemovalAssessment.ts`
- Create: `src/lib/reviewRemovalAssessment.test.ts`

**Interfaces:**
- Consumes: `supabase`, `SUPABASE_ANON_KEY`, `REVIEW_REMOVAL_ASSESSMENT_URL` from `./supabase` (the last one added in Task 5 — for this task, mock it in the test the same way `reviewTranslation.test.ts` mocks `TRANSLATE_REVIEW_URL`; the real export doesn't need to exist yet for these tests to run, but **does** need to exist for `npm run build` to type-check this file's import — so add a temporary placeholder export in `src/lib/supabase.ts` in this task's Step 1, which Task 5 will replace with the fully-documented version).
- Produces (consumed by Task 3's `saveReviewAnalysis` and Task 6's component):
  - `type AssessmentSignal = { name: string; severity: 'low' | 'medium' | 'high'; evidence: string }`
  - `type ReviewRemovalAssessmentResult` — the full 12-key shape from the spec.
  - `hashAssessmentInput(input: { platform: 'tp' | 'wo'; reviewText: string; behavioralFields: Record<string, string | null> }): Promise<string>`
  - `isValidAssessmentResult(data: unknown): data is ReviewRemovalAssessmentResult`
  - `requestReviewRemovalAssessment(input: { platform: 'tp' | 'wo'; status: string; reviewText: string; behavioralFields: Record<string, string | null> }): Promise<{ analysis: ReviewRemovalAssessmentResult; model: string }>`

- [ ] **Step 1: Add a placeholder export to `src/lib/supabase.ts`**

Add near `TRANSLATE_REVIEW_URL` (Task 5 replaces this line with the fully-commented version — this is just so Task 2 type-checks in isolation):

```ts
export const REVIEW_REMOVAL_ASSESSMENT_URL = import.meta.env?.VITE_REVIEW_REMOVAL_ASSESSMENT_URL ?? '';
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/reviewRemovalAssessment.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({ data: { session: null } }),
}));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
  SUPABASE_ANON_KEY: 'test-anon-key',
  REVIEW_REMOVAL_ASSESSMENT_URL: 'https://example.com/review-removal-assessment',
}));

import {
  hashAssessmentInput,
  isValidAssessmentResult,
  requestReviewRemovalAssessment,
  type ReviewRemovalAssessmentResult,
} from './reviewRemovalAssessment';

const VALID_RESULT: ReviewRemovalAssessmentResult = {
  overall_result: 'no_clear_removal_reason',
  risk_score: 10,
  confidence: 'medium',
  content_assessment: {
    status: 'compliant',
    summary: 'Looks like a genuine experience.',
    signals: [{ name: 'Specific experience', severity: 'low', evidence: 'Mentions exact deposit/withdrawal amounts and dates.' }],
  },
  behavioral_assessment: {
    status: 'normal',
    summary: 'No unusual signals recorded.',
    signals: [],
  },
  likely_reason: 'No clear reason found.',
  policy_category: '',
  why_it_may_have_been_removed: 'No evidence points to a specific cause.',
  evidence_summary: 'Content is compliant; behavioral data shows nothing unusual.',
  alternative_explanation: 'Could be an unrelated moderation error.',
  recommendation: 'No action needed based on available evidence.',
  assessment_note: 'This is an AI assessment based on the available review, dashboard data, behavioral signals, and Trustpilot\'s published guidelines. It does not confirm Trustpilot\'s private/internal moderation decision.',
};

describe('hashAssessmentInput', () => {
  it('is deterministic for identical input', async () => {
    const input = { platform: 'tp' as const, reviewText: 'Great casino', behavioralFields: { 'Sticky IP (Mobile) (Y/N)': 'No' } };
    const a = await hashAssessmentInput(input);
    const b = await hashAssessmentInput(input);
    expect(a).toBe(b);
  });

  it('changes when reviewText changes', async () => {
    const a = await hashAssessmentInput({ platform: 'tp', reviewText: 'Great casino', behavioralFields: {} });
    const b = await hashAssessmentInput({ platform: 'tp', reviewText: 'Bad casino', behavioralFields: {} });
    expect(a).not.toBe(b);
  });

  it('changes when a behavioral field value changes', async () => {
    const a = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: { 'Sticky IP (Mobile) (Y/N)': 'No' } });
    const b = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: { 'Sticky IP (Mobile) (Y/N)': 'Yes' } });
    expect(a).not.toBe(b);
  });

  it('is unaffected by behavioral field key order', async () => {
    const a = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: { A: '1', B: '2' } });
    const b = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: { B: '2', A: '1' } });
    expect(a).toBe(b);
  });

  it('changes when platform changes', async () => {
    const a = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: {} });
    const b = await hashAssessmentInput({ platform: 'wo', reviewText: 'x', behavioralFields: {} });
    expect(a).not.toBe(b);
  });
});

describe('isValidAssessmentResult', () => {
  it('accepts a well-formed result', () => {
    expect(isValidAssessmentResult(VALID_RESULT)).toBe(true);
  });

  it('rejects a missing top-level key', () => {
    const { recommendation, ...rest } = VALID_RESULT;
    expect(isValidAssessmentResult(rest)).toBe(false);
  });

  it('rejects an invalid overall_result enum value', () => {
    expect(isValidAssessmentResult({ ...VALID_RESULT, overall_result: 'definitely_removed' })).toBe(false);
  });

  it('rejects an invalid confidence enum value', () => {
    expect(isValidAssessmentResult({ ...VALID_RESULT, confidence: 'certain' })).toBe(false);
  });

  it('rejects a non-array signals field', () => {
    expect(isValidAssessmentResult({
      ...VALID_RESULT,
      content_assessment: { ...VALID_RESULT.content_assessment, signals: 'none' },
    })).toBe(false);
  });

  it('rejects a malformed signal object (bad severity)', () => {
    expect(isValidAssessmentResult({
      ...VALID_RESULT,
      content_assessment: { ...VALID_RESULT.content_assessment, signals: [{ name: 'x', severity: 'extreme', evidence: 'y' }] },
    })).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidAssessmentResult(null)).toBe(false);
  });
});

describe('requestReviewRemovalAssessment', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it('returns the analysis and model on a successful response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ analysis: VALID_RESULT, model: 'gpt-4o' }),
    });

    const result = await requestReviewRemovalAssessment({ platform: 'tp', status: 'Removed', reviewText: 'x', behavioralFields: {} });

    expect(result.analysis).toEqual(VALID_RESULT);
    expect(result.model).toBe('gpt-4o');
  });

  it('sends the anon key and a bearer token to REVIEW_REMOVAL_ASSESSMENT_URL', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ analysis: VALID_RESULT, model: 'gpt-4o' }) });

    await requestReviewRemovalAssessment({ platform: 'tp', status: 'Removed', reviewText: 'x', behavioralFields: {} });

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/review-removal-assessment',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-anon-key', Authorization: expect.stringMatching(/^Bearer /) }),
      }),
    );
  });

  it('throws the standard friendly message on a non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });

    await expect(requestReviewRemovalAssessment({ platform: 'tp', status: 'Removed', reviewText: 'x', behavioralFields: {} }))
      .rejects.toThrow('Unable to generate an AI assessment right now. Please try again later.');
  });

  it('throws the standard friendly message when fetch itself rejects', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    await expect(requestReviewRemovalAssessment({ platform: 'tp', status: 'Removed', reviewText: 'x', behavioralFields: {} }))
      .rejects.toThrow('Unable to generate an AI assessment right now. Please try again later.');
  });

  it('throws the standard friendly message when the response analysis fails shape validation', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ analysis: { bad: true }, model: 'gpt-4o' }) });

    await expect(requestReviewRemovalAssessment({ platform: 'tp', status: 'Removed', reviewText: 'x', behavioralFields: {} }))
      .rejects.toThrow('Unable to generate an AI assessment right now. Please try again later.');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/reviewRemovalAssessment.test.ts`
Expected: FAIL — `Cannot find module './reviewRemovalAssessment'`.

- [ ] **Step 4: Implement `src/lib/reviewRemovalAssessment.ts`**

```ts
import { supabase, SUPABASE_ANON_KEY, REVIEW_REMOVAL_ASSESSMENT_URL } from './supabase';

export type OverallResult = 'likely_publishable' | 'uncertain' | 'likely_removal_risk' | 'no_clear_removal_reason';
export type Confidence = 'low' | 'medium' | 'high';
export type Severity = 'low' | 'medium' | 'high';
export type ContentStatus = 'compliant' | 'potential_concern' | 'likely_violation';
export type BehavioralStatus = 'normal' | 'potential_concern' | 'high_risk' | 'insufficient_data';

export interface AssessmentSignal {
  name: string;
  severity: Severity;
  evidence: string;
}

export interface ReviewRemovalAssessmentResult {
  overall_result: OverallResult;
  risk_score: number;
  confidence: Confidence;
  content_assessment: { status: ContentStatus; summary: string; signals: AssessmentSignal[] };
  behavioral_assessment: { status: BehavioralStatus; summary: string; signals: AssessmentSignal[] };
  likely_reason: string;
  policy_category: string;
  why_it_may_have_been_removed: string;
  evidence_summary: string;
  alternative_explanation: string;
  recommendation: string;
  assessment_note: string;
}

export interface AssessmentInput {
  platform: 'tp' | 'wo';
  reviewText: string;
  behavioralFields: Record<string, string | null>;
}

const ASSESSMENT_FAILURE_MESSAGE = 'Unable to generate an AI assessment right now. Please try again later.';

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Deliberately excludes `status` — a pure status change (e.g. Pending -> Removed)
// with no content/behavioral change should still surface the last cached
// assessment rather than discarding it. See design spec's "Staleness" section.
export async function hashAssessmentInput(input: AssessmentInput): Promise<string> {
  const sortedFields = Object.keys(input.behavioralFields).sort().reduce<Record<string, string | null>>((acc, k) => {
    acc[k] = input.behavioralFields[k];
    return acc;
  }, {});
  const canonical = JSON.stringify({ platform: input.platform, reviewText: input.reviewText, behavioralFields: sortedFields });
  return sha256Hex(canonical);
}

const OVERALL_RESULTS = new Set<string>(['likely_publishable', 'uncertain', 'likely_removal_risk', 'no_clear_removal_reason']);
const CONFIDENCES = new Set<string>(['low', 'medium', 'high']);
const SEVERITIES = new Set<string>(['low', 'medium', 'high']);
const CONTENT_STATUSES = new Set<string>(['compliant', 'potential_concern', 'likely_violation']);
const BEHAVIORAL_STATUSES = new Set<string>(['normal', 'potential_concern', 'high_risk', 'insufficient_data']);
const REQUIRED_STRING_FIELDS = [
  'likely_reason', 'policy_category', 'why_it_may_have_been_removed',
  'evidence_summary', 'alternative_explanation', 'recommendation', 'assessment_note',
] as const;

function isValidSignal(s: unknown): s is AssessmentSignal {
  if (!s || typeof s !== 'object') return false;
  const sig = s as Record<string, unknown>;
  return typeof sig.name === 'string' && SEVERITIES.has(sig.severity as string) && typeof sig.evidence === 'string';
}

function isValidSignalGroup(g: unknown, statuses: Set<string>): g is { status: string; summary: string; signals: AssessmentSignal[] } {
  if (!g || typeof g !== 'object') return false;
  const group = g as Record<string, unknown>;
  return statuses.has(group.status as string)
    && typeof group.summary === 'string'
    && Array.isArray(group.signals)
    && group.signals.every(isValidSignal);
}

export function isValidAssessmentResult(data: unknown): data is ReviewRemovalAssessmentResult {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (!OVERALL_RESULTS.has(d.overall_result as string)) return false;
  if (typeof d.risk_score !== 'number') return false;
  if (!CONFIDENCES.has(d.confidence as string)) return false;
  if (!isValidSignalGroup(d.content_assessment, CONTENT_STATUSES)) return false;
  if (!isValidSignalGroup(d.behavioral_assessment, BEHAVIORAL_STATUSES)) return false;
  return REQUIRED_STRING_FIELDS.every((k) => typeof d[k] === 'string');
}

export async function requestReviewRemovalAssessment(
  input: AssessmentInput & { status: string },
): Promise<{ analysis: ReviewRemovalAssessmentResult; model: string }> {
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* fall back to anon key */
  }

  let res: Response;
  try {
    res = await fetch(REVIEW_REMOVAL_ASSESSMENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error(ASSESSMENT_FAILURE_MESSAGE);
  }
  if (!res.ok) throw new Error(ASSESSMENT_FAILURE_MESSAGE);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(ASSESSMENT_FAILURE_MESSAGE);
  }
  const parsed = body as { analysis?: unknown; model?: unknown };
  if (!isValidAssessmentResult(parsed.analysis)) throw new Error(ASSESSMENT_FAILURE_MESSAGE);
  const model = typeof parsed.model === 'string' ? parsed.model : 'gpt-4o';
  return { analysis: parsed.analysis, model };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/reviewRemovalAssessment.test.ts`
Expected: PASS (all 17 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/reviewRemovalAssessment.ts src/lib/reviewRemovalAssessment.test.ts src/lib/supabase.ts
git commit -m "feat: add reviewRemovalAssessment lib (hashing, validation, fetch)"
```

---

### Task 3: `saveReviewAnalysis` in `src/lib/queries.ts`

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `supabase`, `invalidateTabCache` (both already defined in `queries.ts`), `ReviewRemovalAssessmentResult` from Task 2's `./reviewRemovalAssessment`.
- Produces: `saveReviewAnalysis(id: string, tab: string, analysis: ReviewRemovalAssessmentResult, hash: string, model: string): Promise<void>` — consumed by Task 6's component.

- [ ] **Step 1: Write the failing test**

`src/lib/queries.test.ts` already mocks `./supabase` at the top of the file (lines 4-19) with a `singletonFrom` spy plumbed into `supabase.from`, and separately stubs every other named export `queries.ts` imports from that module (`CHECK_STATUS_URL`, `CHECK_STATUS_BASE_URL`, etc.) — importing `./supabase` with an *incomplete* mock object breaks every other test in this file, since `queries.ts` imports all of those names at module load time. **Do not create a new test file with its own partial mock of `./supabase`** — append to this existing file instead, reusing `singletonFrom`.

Add `saveReviewAnalysis` to the existing import block (~line 21-32):

```ts
import {
  fetchBrandSchedule,
  fetchActiveBrandPlatformPauses,
  fetchRemovedPlatformBrands,
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  bulkUpsertBrandSchedule,
  computeTabKpisFromEntries,
  fetchBrandPlatformOverrides,
  setBrandPlatformOverride,
  clearBrandPlatformOverride,
  saveReviewAnalysis,
} from './queries';
```

Then add a new `import type` line and a new `describe` block anywhere after the existing `chain()` helper (~line 47):

```ts
import type { ReviewRemovalAssessmentResult } from './reviewRemovalAssessment.ts';

const SAMPLE_ANALYSIS = { overall_result: 'no_clear_removal_reason' } as unknown as ReviewRemovalAssessmentResult;

describe('saveReviewAnalysis', () => {
  it('updates the 4 analysis columns for the given entry id', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    singletonFrom.mockReturnValue({ update });

    await saveReviewAnalysis('entry-1', 'Rooster Partners', SAMPLE_ANALYSIS, 'hash-abc', 'gpt-4o');

    expect(singletonFrom).toHaveBeenCalledWith('entries');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      ai_review_analysis: SAMPLE_ANALYSIS,
      ai_review_analysis_hash: 'hash-abc',
      ai_review_analysis_model: 'gpt-4o',
    }));
    expect(eq).toHaveBeenCalledWith('id', 'entry-1');
  });

  it('throws if the update fails', async () => {
    const eq = vi.fn().mockResolvedValue({ error: new Error('db down') });
    const update = vi.fn().mockReturnValue({ eq });
    singletonFrom.mockReturnValue({ update });

    await expect(saveReviewAnalysis('entry-1', 'Rooster Partners', SAMPLE_ANALYSIS, 'hash-abc', 'gpt-4o'))
      .rejects.toThrow('db down');
  });
});
```

This adds only 2 new tests to the existing suite — every pre-existing test in the file is untouched.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/queries.test.ts -t saveReviewAnalysis`
Expected: FAIL — `saveReviewAnalysis is not exported` (the rest of the file's tests still pass, confirming the shared mock wasn't broken).

- [ ] **Step 3: Implement `saveReviewAnalysis`**

Add to `src/lib/queries.ts`, near `updateEntryData` (after its closing brace, ~line 609). First add the type import at the top of the file alongside the existing type imports:

```ts
import type { ReviewRemovalAssessmentResult } from './reviewRemovalAssessment.ts';
```

Then the function:

```ts
// Caches a generated AI Review Removal Assessment on the entry. Deliberately
// not routed through logChange/edit_log — this is a derived/cached artifact
// regenerated from the entry's own existing fields, not a user edit to
// business data (see design spec's "Storage" section).
export async function saveReviewAnalysis(
  id: string,
  tab: string,
  analysis: ReviewRemovalAssessmentResult,
  hash: string,
  model: string,
): Promise<void> {
  const { error } = await supabase
    .from('entries')
    .update({
      ai_review_analysis: analysis,
      ai_review_analysis_hash: hash,
      ai_review_analysis_model: model,
      ai_review_analysis_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
  invalidateTabCache(tab);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/queries.test.ts -t saveReviewAnalysis`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: all existing tests still pass (including the rest of `queries.test.ts`), plus the 2 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add saveReviewAnalysis to queries.ts"
```

---

### Task 4: Edge Function `supabase/functions/review-removal-assessment/`

**Files:**
- Create: `supabase/functions/review-removal-assessment/index.ts`

**Interfaces:**
- Consumes: nothing from this repo's other code (self-contained, like `translate-review`).
- Produces: `POST /review-removal-assessment` accepting `{ platform: 'tp'|'wo', status: string, reviewText: string, behavioralFields: Record<string, string|null> }`, returning `{ analysis: <12-key JSON object>, model: string }` on success or `{ error: string }` with non-200 status on failure. This is the exact shape Task 2's `requestReviewRemovalAssessment` expects.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/review-removal-assessment/index.ts
// AI Review Removal Assessment proxy. Holds OPENAI_API_KEY (shared with
// ai-assistant/translate-review), calls OpenAI once per request in JSON
// mode, no streaming, no tool-calling loop, no DB access — all inputs
// (review text + this entry's own behavioral fields) arrive in the request
// body already.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MODEL = 'gpt-4o';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

const OUTPUT_SCHEMA = `{
  "overall_result": "likely_publishable | uncertain | likely_removal_risk | no_clear_removal_reason",
  "risk_score": <integer 0-100, higher = more risk>,
  "confidence": "low | medium | high",
  "content_assessment": {
    "status": "compliant | potential_concern | likely_violation",
    "summary": "<1-3 sentences>",
    "signals": [{ "name": "<short label>", "severity": "low | medium | high", "evidence": "<what in the text supports this>" }]
  },
  "behavioral_assessment": {
    "status": "normal | potential_concern | high_risk | insufficient_data",
    "summary": "<1-3 sentences>",
    "signals": [{ "name": "<short label>", "severity": "low | medium | high", "evidence": "<which field/value supports this>" }]
  },
  "likely_reason": "<short phrase>",
  "policy_category": "<one category from the list below, or the WO caveat text, or empty string if none applies>",
  "why_it_may_have_been_removed": "<1-3 sentences>",
  "evidence_summary": "<1-3 sentences summarizing all evidence considered, including what was NOT available>",
  "alternative_explanation": "<1-2 sentences on a non-policy explanation, e.g. platform moderation error>",
  "recommendation": "<1-2 sentences, actionable>",
  "assessment_note": "This is an AI assessment based on the available review, dashboard data, behavioral signals, and Trustpilot's published guidelines. It does not confirm Trustpilot's private/internal moderation decision."
}`;

const TP_GUIDELINE_CATEGORIES = `
Trustpilot's real published Guidelines for Reviewers require a review to
meet ALL of the following. Use ONLY these as "policy_category" values (or
empty string if none apply) — do not invent others:
- Genuine Experience: must be based on a real, first-hand purchase,
  service, or interaction with the business.
- Relevance: must relate to the reviewer's own experience with that
  specific business, not a general or unrelated opinion.
- No Promotional/Spam Content: must not exist mainly to advertise, contain
  marketing language, links, contact details, or be posted for
  compensation/incentive without clear disclosure.
- No Conflict of Interest: not from a competitor, employee, or anyone with
  an undisclosed business relationship to the company.
- No Defamatory, Offensive, or Illegal Content: no hate speech, threats,
  harassment, discrimination, or unlawful content.
- No Personal/Private Data: must not expose private information about an
  identifiable individual.
- One Review Per Experience: a reviewer should not post multiple reviews
  for the same single experience.
`;

const WO_POLICY_CAVEAT = `
Wizard of Odds does not have a confirmed, publicly documented review
moderation policy equivalent to Trustpilot's Guidelines for Reviewers. Do
NOT invent or imply a specific Wizard of Odds policy. Set "policy_category"
to "No confirmed Wizard of Odds policy framework available" and reason only
from general genuine-review integrity principles for the content
assessment (real, specific personal experience; free of promotional/spam
language; not generic or templated).
`;

const AI_RULES = `
Rules you MUST follow:
- Analyze evidence rather than assume a violation — a review being
  Removed/Refused does not by itself prove anything was wrong with it.
- Distinguish content problems from behavioral problems; they are separate
  assessments and can disagree.
- Consider both positive and negative evidence — note what looks fine, not
  only what looks concerning.
- Explain exactly what evidence led to each conclusion; never assert a
  finding without pointing to the specific text or field supporting it.
- Reference the applicable guideline category when possible (Trustpilot
  reviews only).
- If evidence is genuinely insufficient or the review looks compliant, say
  so plainly ("no_clear_removal_reason") — do not manufacture a
  justification.
- Never fabricate a Trustpilot or Wizard of Odds policy beyond what is
  given to you above.
- Never claim certainty about the platform's actual internal moderation
  decision — you only have partial, indirect evidence.
- Never automatically classify a review as fake.
- Never assume a positive, short, or generic-sounding review is
  automatically suspicious or removable.
- Never assume a single behavioral signal alone proves manipulation — these
  are indicators only, weigh them alongside the content.
- Give every signal an explicit severity (low/medium/high) and evidence.
- Always state an overall confidence level (low/medium/high).
`;

function buildSystemPrompt(platform: 'tp' | 'wo', status: string): string {
  const removedLike = /remov|refus|reject/i.test(status);
  const framing = removedLike
    ? `This review's current recorded status is "${status || 'unknown'}" (a removed/refused-type status). Frame "likely_reason" and "why_it_may_have_been_removed" as explaining why the review may have been removed — or state plainly that no clear reason is evident.`
    : `This review's current recorded status is "${status || 'unknown'}" (not a removed/refused-type status). Frame "likely_reason" and "why_it_may_have_been_removed" as a forward-looking risk read — what WOULD put this review at risk if it were reviewed today — or state that no meaningful risk is evident. Do not claim the review was actually removed.`;

  const platformLabel = platform === 'wo' ? 'Wizard of Odds' : 'Trustpilot';

  return [
    `You are an evidence-based review compliance analyst for an internal dashboard. You analyze one ${platformLabel} review's content and its account's recorded behavioral data, and assess whether the available evidence explains a possible removal — or, if not removed, a removal risk.`,
    ``,
    `CORE PRINCIPLE: Do NOT assume "the review was removed, therefore something is wrong with it." Instead ask "does the available evidence explain this?" Concluding no clear reason is evident is a fully valid, expected outcome — do not reverse-engineer a justification for a removal.`,
    ``,
    framing,
    ``,
    platform === 'tp' ? TP_GUIDELINE_CATEGORIES : WO_POLICY_CAVEAT,
    AI_RULES,
    `Return ONLY a single JSON object matching exactly this shape (fill in every field; do not add or omit keys):`,
    OUTPUT_SCHEMA,
  ].join('\n');
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (!req.headers.get('authorization')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: 'Assessment not configured' }, 500);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const platform = body?.platform;
  const status = typeof body?.status === 'string' ? body.status : '';
  const reviewText = typeof body?.reviewText === 'string' ? body.reviewText : '';
  const behavioralFields = body?.behavioralFields && typeof body.behavioralFields === 'object' ? body.behavioralFields : {};

  if (platform !== 'tp' && platform !== 'wo') {
    return jsonResponse({ error: 'platform must be "tp" or "wo"' }, 400);
  }
  if (!reviewText.trim()) {
    return jsonResponse({ error: 'Missing reviewText' }, 400);
  }
  if (reviewText.length > 10000) {
    return jsonResponse({ error: 'Review text is too long to analyze' }, 400);
  }

  const userPayload = JSON.stringify({ reviewText, behavioralFields }, null, 2);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt(platform, status) },
          { role: 'user', content: `Review and behavioral data:\n${userPayload}` },
        ],
        max_tokens: 1800,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    if (data.choices?.[0]?.finish_reason === 'length') {
      return jsonResponse({ error: 'Assessment response was too long to complete' }, 500);
    }
    const raw = data.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') throw new Error('No content in response');
    let analysis: unknown;
    try {
      analysis = JSON.parse(raw);
    } catch {
      throw new Error('Model did not return valid JSON');
    }
    return jsonResponse({ analysis, model: MODEL });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Assessment failed' }, 500);
  }
});
```

- [ ] **Step 2: Type-check the function**

Run: `deno check supabase/functions/review-removal-assessment/index.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/review-removal-assessment/index.ts
git commit -m "feat: add review-removal-assessment Edge Function"
```

---

### Task 5: Wire the Edge Function URL into `src/lib/supabase.ts` and `.env.example`

**Files:**
- Modify: `src/lib/supabase.ts` (replace Task 2's placeholder line)
- Modify: `.env.example`

**Interfaces:**
- Produces: `REVIEW_REMOVAL_ASSESSMENT_URL: string` (already consumed since Task 2 by `reviewRemovalAssessment.ts`).

- [ ] **Step 1: Replace the placeholder export**

In `src/lib/supabase.ts`, find the line added in Task 2 (`export const REVIEW_REMOVAL_ASSESSMENT_URL = ...`) — it sits near `TRANSLATE_REVIEW_URL`. Replace it with the fully-commented version, matching the style of the other Edge Function URL exports in that file:

```ts
// review-removal-assessment Edge Function URL (gpt-4o proxy). Set in Vercel env
// once the `review-removal-assessment` function is deployed. Empty string means
// the "Analyze Review" button always fails with the standard error message.
export const REVIEW_REMOVAL_ASSESSMENT_URL = import.meta.env?.VITE_REVIEW_REMOVAL_ASSESSMENT_URL ?? '';
```

- [ ] **Step 2: Document the env var in `.env.example`**

Add after the `VITE_TRANSLATE_REVIEW_URL` block:

```
# VITE_REVIEW_REMOVAL_ASSESSMENT_URL : "Analyze Review" button in the Edit Entry modal
#   (AI Review Removal Assessment). The review-removal-assessment Edge Function holds
#   OPENAI_API_KEY (shared with ai-assistant/translate-review — already set) and needs
#   no other secrets.
VITE_REVIEW_REMOVAL_ASSESSMENT_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/review-removal-assessment
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (Task 2's tests, which mock `./supabase` entirely, are unaffected by this change).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.ts .env.example
git commit -m "docs: document VITE_REVIEW_REMOVAL_ASSESSMENT_URL"
```

---

### Task 6: `src/components/ReviewRemovalAssessment.tsx`

**Files:**
- Create: `src/components/ReviewRemovalAssessment.tsx`

**Interfaces:**
- Consumes: `Entry` (`../types/entry`), `isYesNoCol`/`isBehaviorExtraCol` (`../lib/entryFieldSections`), `hashAssessmentInput`/`requestReviewRemovalAssessment`/`ReviewRemovalAssessmentResult`/`AssessmentSignal` (`../lib/reviewRemovalAssessment`), `saveReviewAnalysis` (`../lib/queries`).
- Produces: `export default function ReviewRemovalAssessment(props: { entry: Entry; tab: string; platform: 'tp' | 'wo'; status: string; reviewText: string; headers: string[]; fields: Record<string, string>; disabled?: boolean })` — consumed by Task 7's `EditEntryModal.tsx`.

No automated test for this file — matches this repo's established convention of verifying page/modal-level presentational components (`BrandGroup.tsx`, `Overview.tsx`) via `npm run build` + manual check rather than component tests (no `.test.tsx` files exist anywhere in `src/components/` today).

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, ChevronDown } from 'lucide-react';
import type { Entry } from '../types/entry';
import { isYesNoCol, isBehaviorExtraCol } from '../lib/entryFieldSections';
import {
  hashAssessmentInput,
  requestReviewRemovalAssessment,
  type ReviewRemovalAssessmentResult,
  type AssessmentSignal,
} from '../lib/reviewRemovalAssessment';
import { saveReviewAnalysis } from '../lib/queries';

const ASSESSMENT_FAILURE_MESSAGE = 'Unable to generate an AI assessment right now. Please try again later.';

interface Props {
  entry: Entry;
  tab: string;
  platform: 'tp' | 'wo';
  status: string;
  reviewText: string;
  headers: string[];
  fields: Record<string, string>;
  disabled?: boolean;
}

const OVERALL_META: Record<ReviewRemovalAssessmentResult['overall_result'], { emoji: string; label: string }> = {
  likely_publishable: { emoji: '🟢', label: 'Likely Publishable' },
  uncertain: { emoji: '🟡', label: 'Uncertain / Insufficient Evidence' },
  likely_removal_risk: { emoji: '🔴', label: 'Likely Removal Risk' },
  no_clear_removal_reason: { emoji: '⚪', label: 'No Clear Removal Reason' },
};

const CONTENT_STATUS_META: Record<ReviewRemovalAssessmentResult['content_assessment']['status'], { emoji: string; label: string }> = {
  compliant: { emoji: '🟢', label: 'Compliant' },
  potential_concern: { emoji: '🟡', label: 'Potential Concern' },
  likely_violation: { emoji: '🔴', label: 'Likely Policy Issue' },
};

const BEHAVIORAL_STATUS_META: Record<ReviewRemovalAssessmentResult['behavioral_assessment']['status'], { emoji: string; label: string }> = {
  normal: { emoji: '🟢', label: 'Normal' },
  potential_concern: { emoji: '🟠', label: 'Potential Concern' },
  high_risk: { emoji: '🔴', label: 'High Risk' },
  insufficient_data: { emoji: '⚪', label: 'Insufficient Data' },
};

function riskBucket(score: number): { emoji: string; label: string } {
  if (score >= 70) return { emoji: '🔴', label: 'High' };
  if (score >= 40) return { emoji: '🟠', label: 'Medium' };
  return { emoji: '🟢', label: 'Low' };
}

function behavioralFieldsFrom(headers: string[], fields: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const h of headers) {
    if (isYesNoCol(h) || isBehaviorExtraCol(h)) out[h] = fields[h] || null;
  }
  return out;
}

function SignalBadge({ signal }: { signal: AssessmentSignal }) {
  const icon = signal.severity === 'low' ? '✓' : '⚠';
  const color = signal.severity === 'high'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : signal.severity === 'medium'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span title={signal.evidence} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {icon} {signal.name}
    </span>
  );
}

export default function ReviewRemovalAssessment({ entry, tab, platform, status, reviewText, headers, fields, disabled }: Props) {
  const [result, setResult] = useState<ReviewRemovalAssessmentResult | null>(
    (entry.ai_review_analysis as ReviewRemovalAssessmentResult | undefined) ?? null,
  );
  // Tracked as state (not read directly off the `entry` prop on every render)
  // so a successful analyze/re-analyze can update the "last saved" baseline
  // without mutating the prop object — React props are treated as read-only.
  const [savedHash, setSavedHash] = useState<string | null>(entry.ai_review_analysis_hash ?? null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const behavioralFields = useMemo(() => behavioralFieldsFrom(headers, fields), [headers, fields]);

  useEffect(() => {
    let cancelled = false;
    hashAssessmentInput({ platform, reviewText, behavioralFields }).then((h) => {
      if (!cancelled) setCurrentHash(h);
    });
    return () => {
      cancelled = true;
    };
  }, [platform, reviewText, behavioralFields]);

  const isStale = result !== null && currentHash !== null && savedHash !== currentHash;
  const hasFreshResult = result !== null && !isStale;

  async function handleAnalyze() {
    if (!reviewText.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { analysis, model } = await requestReviewRemovalAssessment({ platform, status, reviewText, behavioralFields });
      const hash = currentHash ?? (await hashAssessmentInput({ platform, reviewText, behavioralFields }));
      await saveReviewAnalysis(entry.id, tab, analysis, hash, model);
      setResult(analysis);
      setSavedHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : ASSESSMENT_FAILURE_MESSAGE);
    } finally {
      setLoading(false);
    }
  }

  if (!reviewText.trim() && !result) return null;

  return (
    <div className="mt-3 rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">AI Review Removal Assessment</span>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={disabled || loading || !reviewText.trim()}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />}
          {loading ? 'Analyzing…' : hasFreshResult ? '↻ Re-analyze' : '🤖 Analyze Review'}
        </button>
      </div>

      {error && (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
      )}

      {result && (
        <div className="mt-3 space-y-2">
          {isStale && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
              Outdated — review data changed since this assessment was generated.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
            <span>Risk: {riskBucket(result.risk_score).emoji} {riskBucket(result.risk_score).label}</span>
            <span>Assessment: {OVERALL_META[result.overall_result].emoji} {OVERALL_META[result.overall_result].label}</span>
            <span>Confidence: {result.confidence.charAt(0).toUpperCase() + result.confidence.slice(1)}</span>
          </div>

          <div className="text-xs text-slate-600">
            <div><span className="font-medium text-slate-700">Likely Reason:</span> {result.likely_reason || '—'}</div>
            <div className="mt-0.5"><span className="font-medium text-slate-700">Why:</span> {result.why_it_may_have_been_removed || '—'}</div>
          </div>

          {(result.content_assessment.signals.length > 0 || result.behavioral_assessment.signals.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {[...result.content_assessment.signals, ...result.behavioral_assessment.signals]
                .sort((a, b) => (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0))
                .slice(0, 6)
                .map((s, i) => <SignalBadge key={`${s.name}-${i}`} signal={s} />)}
            </div>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            <ChevronDown className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'Hide AI Assessment' : 'View AI Assessment'}
          </button>

          {expanded && (
            <div className="space-y-2 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              <div>
                <span className="font-medium text-slate-700">
                  Content Assessment ({CONTENT_STATUS_META[result.content_assessment.status].emoji} {CONTENT_STATUS_META[result.content_assessment.status].label}):
                </span>{' '}
                {result.content_assessment.summary}
              </div>
              <div>
                <span className="font-medium text-slate-700">
                  Behavioral Assessment ({BEHAVIORAL_STATUS_META[result.behavioral_assessment.status].emoji} {BEHAVIORAL_STATUS_META[result.behavioral_assessment.status].label}):
                </span>{' '}
                {result.behavioral_assessment.summary}
              </div>
              <div><span className="font-medium text-slate-700">Policy Category:</span> {result.policy_category || '—'}</div>
              <div><span className="font-medium text-slate-700">Evidence:</span> {result.evidence_summary || '—'}</div>
              <div><span className="font-medium text-slate-700">Alternative Explanation:</span> {result.alternative_explanation || '—'}</div>
              <div><span className="font-medium text-slate-700">Recommendation:</span> {result.recommendation || '—'}</div>
              <div className="pt-1 text-[11px] italic text-slate-400">{result.assessment_note}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ReviewRemovalAssessment.tsx
git commit -m "feat: add ReviewRemovalAssessment component"
```

---

### Task 7: Wire into `EditEntryModal.tsx`

**Files:**
- Modify: `src/components/EditEntryModal.tsx`

**Interfaces:**
- Consumes: `ReviewRemovalAssessment` (Task 6), `pick`/`PLATFORM_STATUS_KEYS` (`../lib/scoreSummary`, `PLATFORM_STATUS_KEYS` already partially imported — add `pick` and `PLATFORM_STATUS_KEYS` to the existing import line).

- [ ] **Step 1: Extend the existing `scoreSummary` import**

In `src/components/EditEntryModal.tsx` line 11, change:

```ts
import { PLATFORM_LABEL, PLATFORM_SHORT_LABEL, PLATFORM_REVIEW_TEXT_KEYS, type Platform } from '../lib/scoreSummary';
```

to:

```ts
import { PLATFORM_LABEL, PLATFORM_SHORT_LABEL, PLATFORM_REVIEW_TEXT_KEYS, PLATFORM_STATUS_KEYS, pick, type Platform } from '../lib/scoreSummary';
```

- [ ] **Step 2: Add the component import**

Add near the other component imports (after the `ReviewTextBlock` import, line 10):

```ts
import ReviewRemovalAssessment from './ReviewRemovalAssessment';
```

- [ ] **Step 3: Render it under `ReviewTextBlock` in the TP/WO section**

Replace the existing block (lines 443-451):

```tsx
              {(tabPlatforms.includes('tp') || tabPlatforms.includes('wo')) && (
                <div className="mt-3">
                  <ReviewTextBlock
                    value={fields[tabPlatforms.includes('wo') ? 'WO Review Text' : 'TP Review Text'] ?? ''}
                    onChange={(v) => setFields((f) => ({ ...f, [tabPlatforms.includes('wo') ? 'WO Review Text' : 'TP Review Text']: v }))}
                    disabled={saving}
                  />
                </div>
              )}
```

with:

```tsx
              {(tabPlatforms.includes('tp') || tabPlatforms.includes('wo')) && (() => {
                const activePlatform: Platform = tabPlatforms.includes('wo') ? 'wo' : 'tp';
                const reviewTextKey = activePlatform === 'wo' ? 'WO Review Text' : 'TP Review Text';
                return (
                  <div className="mt-3">
                    <ReviewTextBlock
                      value={fields[reviewTextKey] ?? ''}
                      onChange={(v) => setFields((f) => ({ ...f, [reviewTextKey]: v }))}
                      disabled={saving}
                    />
                    <ReviewRemovalAssessment
                      entry={entry}
                      tab={selectedTab || currentTab || entry.tab}
                      platform={activePlatform}
                      status={pick(fields, PLATFORM_STATUS_KEYS[activePlatform]) ?? ''}
                      reviewText={fields[reviewTextKey] ?? ''}
                      headers={headers}
                      fields={fields}
                      disabled={saving}
                    />
                  </div>
                );
              })()}
```

Note: `pick()` expects `Record<string, string | null>`; `fields` is `Record<string, string>`, which structurally satisfies it (every `string` value is a valid `string | null`).

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (no existing `EditEntryModal` tests exist to update — confirmed no `.test.tsx` files exist in `src/components/`).

- [ ] **Step 6: Commit**

```bash
git add src/components/EditEntryModal.tsx
git commit -m "feat: wire ReviewRemovalAssessment into EditEntryModal"
```

---

### Task 8: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: every test passes, including all tests added in Tasks 2 and 3.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: succeeds with zero TypeScript errors.

- [ ] **Step 3: Type-check the new Edge Function again**

Run: `deno check supabase/functions/review-removal-assessment/index.ts`
Expected: no errors (re-confirms Task 4 after later edits touched neighboring files).

- [ ] **Step 4: Whole-branch self-review against the spec**

Re-read `docs/superpowers/specs/2026-08-14-ai-review-removal-assessment-design.md` section by section and confirm each requirement has a corresponding implemented piece:
- Scope gate (TP+WO only, via `getTabPlatforms`) — Task 7.
- Status-based framing (removal-explanation vs. forward-looking-risk) — Task 4's `buildSystemPrompt`.
- Fixed TP guideline list / WO no-policy caveat — Task 4.
- All "AI Rules" — Task 4's `AI_RULES` constant.
- Output JSON schema (12 keys, `risk_score` 0-100) — Task 2's type + Task 4's prompt.
- Hash-based staleness, excluding `status` — Task 2's `hashAssessmentInput` + Task 6's `isStale`.
- Storage on `entries` columns, no audit log — Task 1 + Task 3.
- Compact 4-row UI + expandable detail — Task 6.
- Button always visible, not gated by status — Task 7 (no status check gates rendering).
- No cross-entry query — confirmed absent from Task 2/4/6.

- [ ] **Step 5: Note deployment as pending (do not run)**

Confirm no deploy commands were run this session (`supabase db push`, `supabase functions deploy review-removal-assessment`, Vercel env var) — this matches the explicit "local first" instruction for this task. Leave a one-line note for the task-history log (outside this plan) that these 3 steps are the pending manual follow-up, mirroring how `generate-weekly-schedule`'s deploy is tracked as a Known Issue.

- [ ] **Step 6: Manual smoke check (once deployed, later — not part of this task's completion)**

Documented for whoever runs the deploy: open a real Removed/Refused TP entry and a real compliant Live TP entry, click "🤖 Analyze Review" on each, confirm the four acceptance-criteria scenarios from the spec (bad content / good content+suspicious behavior / good content+normal behavior / insufficient evidence) render sensibly, and that "No Clear Removal Reason" is actually reachable on the compliant entry rather than merely theoretically allowed by the prompt.
