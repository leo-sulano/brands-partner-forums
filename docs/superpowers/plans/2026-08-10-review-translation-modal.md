# Original Review Content + On-Demand English Translation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each review's original-language text in the Edit Entry modal, per platform,
with an on-demand "Translate to English" button — never automatic, never in the table.

**Architecture:** A pure-logic module (`src/lib/reviewTranslation.ts`) handles language
detection (via the `franc-min` package) and the translation network call; a presentational
`ReviewTextBlock` component renders one platform's text + button; `EditEntryModal.tsx` wires
one block into each of its existing Trust Pilot/AskGamblers/Casino Guru section blocks. A new
minimal Supabase Edge Function (`translate-review`) proxies the actual OpenAI call, modeled
directly on the existing `ai-assistant` function's auth/CORS/secret pattern.

**Tech Stack:** Vite/React/TypeScript, Tailwind v4, Vitest, `franc-min` (new dependency),
Supabase Edge Functions (Deno), OpenAI gpt-4o-mini.

## Global Constraints

- Review content never appears in the review table — only inside `EditEntryModal.tsx`.
- Translation happens only on button click — never automatically when the modal opens.
- Button visibility: hidden for English/undetermined-language text, shown otherwise.
- Original text always stays visible after translating; translation renders below it.
- No review content → exactly the text "No review content available." (per platform slot).
- Translation failure → exactly the text "Unable to translate this review at the moment.
  Please try again later." Button stays clickable for retry.
- Translation is never persisted (no DB write, no cross-session cache) — ephemeral per modal
  open, matching the approved design's explicit YAGNI call.
- No cleanup/stripping of known per-platform noise (AG's "Helpful (N)", CG's appended reply,
  WO's leading header) — display raw stored text as-is; this is explicitly out of scope.
- No new automated test coverage for React component rendering (`ReviewTextBlock.tsx`,
  `EditEntryModal.tsx` changes) — this repo has no `@testing-library/react` dependency and no
  precedent `.test.tsx` files; do not add that dependency as a side effect of this task. All
  new automated tests live in the pure-logic module only.
- Do not deploy the new Edge Function or set the Vercel env var as part of this plan's
  execution — both are explicit, separately-confirmed steps (Task 5 of this plan).

---

### Task 1: `reviewTranslation.ts` — language-detection gate

**Files:**
- Create: `src/lib/reviewTranslation.ts`
- Test: `src/lib/reviewTranslation.test.ts`

**Interfaces:**
- Consumes: `franc` from the `franc-min` npm package (new dependency this task installs).
- Produces: `export function shouldShowTranslateButton(text: string): boolean` — Task 3
  (`ReviewTextBlock.tsx`) imports and calls this exact name/signature.

- [ ] **Step 1: Install the real dependency**

Run: `npm install franc-min`
Expected: `package.json`'s `dependencies` (not `devDependencies`) gains `"franc-min": "^6.2.0"`
(or whatever the installed version resolves to), `package-lock.json` updates accordingly.
Do not hand-edit either file — let `npm install` write them.

- [ ] **Step 2: Write the failing test**

Create `src/lib/reviewTranslation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldShowTranslateButton } from './reviewTranslation';

describe('shouldShowTranslateButton', () => {
  it('returns false for English text', () => {
    expect(shouldShowTranslateButton(
      'This is a genuinely nice casino with fast withdrawals and great support.'
    )).toBe(false);
  });

  it('returns true for German text', () => {
    expect(shouldShowTranslateButton(
      'Das Casino ist sehr gut. Die Auszahlungen waren schnell und der Kundenservice war hilfreich.'
    )).toBe(true);
  });

  it('returns true for Spanish text', () => {
    expect(shouldShowTranslateButton(
      'Este casino es muy bueno. Los retiros fueron rápidos y el servicio al cliente fue muy útil.'
    )).toBe(true);
  });

  it('returns false for very short/undetermined text (assume English rather than false-positive the button)', () => {
    expect(shouldShowTranslateButton('ok')).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(shouldShowTranslateButton('')).toBe(false);
  });
});
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `npx vitest run src/lib/reviewTranslation.test.ts`
Expected: FAIL — `reviewTranslation.ts` does not exist yet / `shouldShowTranslateButton` is
not exported.

- [ ] **Step 3: Implement `shouldShowTranslateButton`**

Create `src/lib/reviewTranslation.ts`:

```ts
import { franc } from 'franc-min';

// franc returns an ISO 639-3 code ('eng', 'deu', ...), or 'und' when the input
// is too short/ambiguous to classify (its own default minLength is 10 chars).
// Treat 'und' the same as English — assuming English on genuinely short text
// avoids a false-positive Translate button on e.g. a two-word review, at the
// cost of occasionally hiding the button on a short but real non-English one.
export function shouldShowTranslateButton(text: string): boolean {
  if (!text) return false;
  const lang = franc(text);
  return lang !== 'eng' && lang !== 'und';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/reviewTranslation.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/reviewTranslation.ts src/lib/reviewTranslation.test.ts
git commit -m "feat: add shouldShowTranslateButton language-detection gate"
```

---

### Task 2: `TRANSLATE_REVIEW_URL` env var + `translateReviewText` network call

**Files:**
- Modify: `src/lib/supabase.ts:38` (add after the existing `AI_ASSISTANT_URL` export, which is
  currently the file's last line)
- Modify: `src/lib/reviewTranslation.ts` (add to the file from Task 1)
- Modify: `src/lib/reviewTranslation.test.ts` (add to the file from Task 1)

**Interfaces:**
- Consumes: `supabase`, `SUPABASE_ANON_KEY`, `TRANSLATE_REVIEW_URL` from `./supabase`
  (the last two added/used here for the first time).
- Produces: `export async function translateReviewText(text: string): Promise<string>` —
  Task 3 (`ReviewTextBlock.tsx`) imports and calls this exact name/signature. Resolves to the
  English translation string, or rejects with `Error('Unable to translate this review at the
  moment. Please try again later.')` on any failure.

- [ ] **Step 1: Add the env var export**

In `src/lib/supabase.ts`, append after the existing line 38
(`export const AI_ASSISTANT_URL = import.meta.env?.VITE_AI_ASSISTANT_URL ?? '';`):

```ts

// Translate-review Edge Function URL (gpt-4o-mini proxy). Set in Vercel env once the
// `translate-review` function is deployed. Empty string means the Translate button's
// click always fails with the standard "unable to translate" message.
export const TRANSLATE_REVIEW_URL = import.meta.env?.VITE_TRANSLATE_REVIEW_URL ?? '';
```

- [ ] **Step 2: Write the failing tests**

Add to the top of `src/lib/reviewTranslation.test.ts`, before the existing `describe`
block — this file now needs to mock `./supabase` (following the exact pattern
`src/lib/queries.test.ts` already uses for the same module):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({ data: { session: null } }),
}));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
  SUPABASE_ANON_KEY: 'test-anon-key',
  TRANSLATE_REVIEW_URL: 'https://example.com/translate-review',
}));

import { shouldShowTranslateButton, translateReviewText } from './reviewTranslation';
```

(Remove the old plain `import { shouldShowTranslateButton } from './reviewTranslation';`
line from Task 1 — it's replaced by the line above, which imports both functions.)

Add a new `describe` block at the end of the file:

```ts
describe('translateReviewText', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it('returns the translation on a successful response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ translation: 'The casino is very good.' }),
    });

    const result = await translateReviewText('Das Casino ist sehr gut.');

    expect(result).toBe('The casino is very good.');
  });

  it('sends the anon key and a bearer token to TRANSLATE_REVIEW_URL', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ translation: 'ok' }),
    });

    await translateReviewText('some text');

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/translate-review',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-anon-key' }),
      }),
    );
  });

  it('throws the standard friendly message on a non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });

    await expect(translateReviewText('text')).rejects.toThrow(
      'Unable to translate this review at the moment. Please try again later.',
    );
  });

  it('throws the standard friendly message when fetch itself rejects', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    await expect(translateReviewText('text')).rejects.toThrow(
      'Unable to translate this review at the moment. Please try again later.',
    );
  });

  it('throws the standard friendly message when the response has no translation field', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(translateReviewText('text')).rejects.toThrow(
      'Unable to translate this review at the moment. Please try again later.',
    );
  });
});
```

- [ ] **Step 2b: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/reviewTranslation.test.ts`
Expected: the 5 `shouldShowTranslateButton` tests still pass; the 5 new `translateReviewText`
tests FAIL — `translateReviewText` is not exported yet.

- [ ] **Step 3: Implement `translateReviewText`**

Add to `src/lib/reviewTranslation.ts`:

```ts
import { supabase, SUPABASE_ANON_KEY, TRANSLATE_REVIEW_URL } from './supabase';

const TRANSLATE_FAILURE_MESSAGE = 'Unable to translate this review at the moment. Please try again later.';

export async function translateReviewText(text: string): Promise<string> {
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* fall back to anon key */
  }

  try {
    const res = await fetch(TRANSLATE_REVIEW_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(TRANSLATE_FAILURE_MESSAGE);
    const data = await res.json();
    if (typeof data.translation !== 'string') throw new Error(TRANSLATE_FAILURE_MESSAGE);
    return data.translation;
  } catch {
    throw new Error(TRANSLATE_FAILURE_MESSAGE);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/reviewTranslation.test.ts`
Expected: PASS, all 10 tests green (5 from Task 1 + 5 new).

- [ ] **Step 5: Run the full frontend suite and build to confirm no regression**

Run: `npm test` then `npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase.ts src/lib/reviewTranslation.ts src/lib/reviewTranslation.test.ts
git commit -m "feat: add translateReviewText network call to translate-review Edge Function"
```

---

### Task 3: `ReviewTextBlock` component

**Files:**
- Create: `src/components/ReviewTextBlock.tsx`

**Interfaces:**
- Consumes: `shouldShowTranslateButton`, `translateReviewText` from `../lib/reviewTranslation`
  (both from Tasks 1-2).
- Produces: `export default function ReviewTextBlock({ text }: { text: string | null })` —
  Task 4 (`EditEntryModal.tsx`) imports and renders this exact component with this exact prop.

No automated test for this file — component rendering has no test precedent in this repo
(see Global Constraints). Verify by reading the code carefully and via the manual/Playwright
check in Task 6.

- [ ] **Step 1: Implement the component**

Create `src/components/ReviewTextBlock.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Loader2, Languages } from 'lucide-react';
import { shouldShowTranslateButton, translateReviewText } from '../lib/reviewTranslation';

interface Props {
  text: string | null;
}

export default function ReviewTextBlock({ text }: Props) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showButton = useMemo(() => (text ? shouldShowTranslateButton(text) : false), [text]);

  if (!text) {
    return <p className="text-xs text-slate-400 italic">No review content available.</p>;
  }

  async function handleTranslate() {
    if (!text) return;
    setTranslating(true);
    setError(null);
    try {
      const result = await translateReviewText(text);
      setTranslated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to translate this review at the moment. Please try again later.');
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {text}
      </div>

      {showButton && !translated && (
        <button
          type="button"
          onClick={handleTranslate}
          disabled={translating}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
        >
          {translating ? <Loader2 className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
          {translating ? 'Translating…' : 'Translate to English'}
        </button>
      )}

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {translated && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">English Translation</label>
          <div className="whitespace-pre-wrap rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-700">
            {translated}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run the full frontend suite and build to confirm no regression**

Run: `npm test` then `npm run build`
Expected: both pass. (`Languages` icon: confirm it exists in the installed `lucide-react`
version by checking the build output — if it doesn't exist, the build fails with a clear
import error; substitute a similarly-appropriate icon already used elsewhere in this repo,
e.g. `Globe`, and note the substitution in your report.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ReviewTextBlock.tsx
git commit -m "feat: add ReviewTextBlock display + translate-on-demand component"
```

---

### Task 4: Wire `ReviewTextBlock` into `EditEntryModal.tsx`

**Files:**
- Modify: `src/components/EditEntryModal.tsx`

**Interfaces:**
- Consumes: `getReviewText` from `../lib/scoreSummary` (already exports it; the file already
  imports `PLATFORM_LABEL, type Platform` from the same module — extend that import line).
  `ReviewTextBlock` from `../components/ReviewTextBlock` (Task 3).
- Produces: nothing new for later tasks — this is the final wiring point.

No automated test — same reasoning as Task 3.

Confirmed this session by reading `src/lib/tab-configs.ts:635-645`: `getTabPlatforms(tab)`
returns `['wo']` only when `tab === 'Wizard of Odds'` (exact match); every other tab always
includes `'tp'` in its returned array. The two are mutually exclusive — a tab's `tabPlatforms`
never contains both `'tp'` and `'wo'` at once. This means the Trust-Pilot-section block can
safely pick its platform with a simple ternary (see Step 1 below) rather than needing to
handle both simultaneously.

Also confirmed: every tab in `TAB_COLUMN_CONFIGS` includes at least one Trust-Pilot-bucketed
field (e.g. `'TP Review Status'`, `'Trust Pilot'`), so `sections.tp.length > 0` is always true
for the `'tp'`/`'wo'` case whenever this modal is open on an operational tab — no change to
the existing `{sections.X.length > 0 && (...)}` gating is needed; the new block simply renders
inside the already-rendered section.

- [ ] **Step 1: Add imports**

In `src/components/EditEntryModal.tsx`, change line 10 from:

```ts
import { PLATFORM_LABEL, type Platform } from '../lib/scoreSummary';
```

to:

```ts
import { PLATFORM_LABEL, getReviewText, type Platform } from '../lib/scoreSummary';
```

Add a new import after line 9 (`import { PASTE_OFFSET_MAP } from '../lib/paste-map';`):

```ts
import ReviewTextBlock from './ReviewTextBlock';
```

- [ ] **Step 2: Render a block in the Trust Pilot / Wizard of Odds section**

Find this existing block (around line 393-401 as of this session — re-read the live file
first, since line numbers may have shifted):

```tsx
          {/* Trust Pilot / Wizard of Odds */}
          {sections.tp.length > 0 && (
            <>
              <SectionHeading label={currentTab === 'Wizard of Odds' ? 'Wizard of Odds' : 'Trust Pilot'} />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.tp.map((h) => renderField(h))}
              </div>
            </>
          )}
```

Replace it with (adds a `ReviewTextBlock` after the existing field grid, only when the tab's
active platform set includes `'tp'` or `'wo'`):

```tsx
          {/* Trust Pilot / Wizard of Odds */}
          {sections.tp.length > 0 && (
            <>
              <SectionHeading label={currentTab === 'Wizard of Odds' ? 'Wizard of Odds' : 'Trust Pilot'} />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.tp.map((h) => renderField(h))}
              </div>
              {(tabPlatforms.includes('tp') || tabPlatforms.includes('wo')) && (
                <div className="mt-3">
                  <ReviewTextBlock
                    text={getReviewText(entry.data, tabPlatforms.includes('wo') ? 'wo' : 'tp')}
                  />
                </div>
              )}
            </>
          )}
```

- [ ] **Step 3: Render a block in the AskGamblers section**

Find:

```tsx
          {/* AskGamblers */}
          {sections.ag.length > 0 && (
            <>
              <SectionHeading label="AskGamblers" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.ag.map((h) => renderField(h))}
              </div>
            </>
          )}
```

Replace with:

```tsx
          {/* AskGamblers */}
          {sections.ag.length > 0 && (
            <>
              <SectionHeading label="AskGamblers" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.ag.map((h) => renderField(h))}
              </div>
              <div className="mt-3">
                <ReviewTextBlock text={getReviewText(entry.data, 'ag')} />
              </div>
            </>
          )}
```

- [ ] **Step 4: Render a block in the Casino Guru section**

Find:

```tsx
          {/* Casino Guru */}
          {sections.cg.length > 0 && (
            <>
              <SectionHeading label="Casino Guru" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.cg.map((h) => renderField(h))}
              </div>
            </>
          )}
```

Replace with:

```tsx
          {/* Casino Guru */}
          {sections.cg.length > 0 && (
            <>
              <SectionHeading label="Casino Guru" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                {sections.cg.map((h) => renderField(h))}
              </div>
              <div className="mt-3">
                <ReviewTextBlock text={getReviewText(entry.data, 'cg')} />
              </div>
            </>
          )}
```

- [ ] **Step 5: Run the full frontend suite and build to confirm no regression**

Run: `npm test` then `npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/EditEntryModal.tsx
git commit -m "feat: wire ReviewTextBlock into EditEntryModal's TP/AG/CG sections"
```

---

### Task 5: `translate-review` Edge Function

**Files:**
- Create: `supabase/functions/translate-review/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (Deno runtime, separate from the frontend build).
- Produces: an HTTP endpoint accepting `POST { text: string }`, returning
  `{ translation: string }` (200) or `{ error: string }` (401/500) — Task 2's
  `translateReviewText` (already implemented) is the frontend caller, matching this contract.

No automated test file — matches `ai-assistant`'s own established convention in this repo
(validated by live testing after deploy, not a test suite).

- [ ] **Step 1: Implement the function**

Create `supabase/functions/translate-review/index.ts`:

```ts
// supabase/functions/translate-review/index.ts
// Minimal translation proxy. Holds OPENAI_API_KEY (shared with ai-assistant),
// calls OpenAI once per request, no streaming, no tool-calling loop.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MODEL = 'gpt-4o-mini';

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (!req.headers.get('authorization')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: 'Translation not configured' }, 500);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }
  const text: string | undefined = body?.text;
  if (!text || typeof text !== 'string') {
    return jsonResponse({ error: 'Missing text' }, 400);
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: 'Translate the following review text into English. Return only the translation with no commentary, explanation, or quotation marks around it.',
          },
          { role: 'user', content: text },
        ],
        max_tokens: 1000,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    const translation = data.choices?.[0]?.message?.content;
    if (typeof translation !== 'string') throw new Error('No translation in response');
    return jsonResponse({ translation: translation.trim() });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Translation failed' }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/translate-review/index.ts
git commit -m "feat: add translate-review Edge Function"
```

---

### Task 6: Manual/live verification (no code changes)

**Files:** none modified.

**Interfaces:** none.

- [ ] **Step 1: Check for Playwright MCP tooling**

Before starting, check whether Playwright browser-automation tools are available in this
session (via ToolSearch or the available-tools listing). If available, proceed with Steps
2-4 as a live browser check. If not available, skip to Step 5 and report this step as not
performed, matching how this repo's history has handled prior features shipped without
browser-automation tooling on hand.

- [ ] **Step 2: Live-verify the display path (requires the Edge Function NOT yet deployed —
  this step only checks the modal renders correctly, not translation)**

Start the dev server (`npm run dev`), log in, open a brand tab known to have real review
text already populated (per this session's earlier live-write verification: a TP Brand
Injection entry, or a Rooster Partners entry with AG/CG text — check via a direct Supabase
query if unsure which specific entry currently holds text). Open that entry's Edit modal.
Confirm:
- The original review text renders in its correct platform section (TP/AG/CG), read-only.
- A non-English review (the earlier-confirmed German TP entry, if still identifiable) shows
  the Translate button; an English one does not.
- An entry/platform with no review text shows "No review content available."
- The review table itself (the underlying grid, not the modal) shows no review text anywhere.

- [ ] **Step 3: Report findings**

Note any visual/layout issues found (spacing, section-heading placement, button style) as
a DONE_WITH_CONCERNS item rather than silently fixing — flag back to the plan owner.

- [ ] **Step 4: Do not deploy yet**

This step is display-only verification. Do not attempt to click Translate yet — the Edge
Function isn't deployed (Task 7), so clicking it now would only exercise the
already-tested friendly-failure path, not real translation.

- [ ] **Step 5: If Playwright is unavailable**

Report this task as not performed (consistent with other features in this repo's history
shipped without live browser verification when no automation tooling was available) —
recommend the plan owner do a manual pass in a real browser before considering the feature
fully done.

---

### Task 7: Deploy (explicit, separately confirmed — do not perform automatically)

**Files:** none — operational steps only.

This task is intentionally NOT to be executed as part of implementing Tasks 1-6. Surface it
back to the user for explicit confirmation before doing anything here, per this repo's
established convention for every prior Edge-Function-introducing feature.

- [ ] Deploy the function: `supabase functions deploy translate-review`
- [ ] Confirm `OPENAI_API_KEY` is already set as a Supabase secret (it should be, shared with
  `ai-assistant`) — if not: `supabase secrets set OPENAI_API_KEY=sk-...`
- [ ] Set `VITE_TRANSLATE_REVIEW_URL` in Vercel to the deployed function's URL, then redeploy
  the frontend (Vercel env vars are baked in at build time).
- [ ] Live-verify: open the modal on the same non-English entry from Task 6, click Translate,
  confirm a real English translation appears within a few seconds and the original stays
  visible above it.

---

## Self-Review Notes (for the plan author, not a task)

- **Spec coverage:** Display-only, original-language-always-visible ✅ Task 3-4. No
  auto-translate on open ✅ Task 3 (button-click-only). Button hidden for English/
  undetermined ✅ Task 1. Metadata unchanged ✅ (no metadata fields touched anywhere in this
  plan). Not in table ✅ (no table-rendering file touched). "No review content available." ✅
  Task 3. Exact friendly failure message ✅ Task 2 (`TRANSLATE_FAILURE_MESSAGE` constant, one
  source of truth, thrown for every failure path). Works across TP/AG/CG/WO ✅ Task 4 (all
  four platforms wired, WO reuses the TP section slot per its existing relabeling pattern).
- **Placeholder scan:** no TBD/TODO. The one deliberately-open item (whether `Languages` icon
  exists in the installed `lucide-react` version) is a concrete, checkable build-time
  verification with a named fallback (`Globe`), not a vague placeholder.
- **Type consistency:** `shouldShowTranslateButton(text: string): boolean` and
  `translateReviewText(text: string): Promise<string>` are defined once in Task 1/2 and used
  with identical signatures in Task 3. `ReviewTextBlock({ text: string | null })` is defined
  once in Task 3 and used identically in Task 4 (three call sites, one per platform section).
  `getReviewText(data, platform)` signature matches its existing definition in
  `src/lib/scoreSummary.ts` (verified this session) — not redefined anywhere in this plan.
