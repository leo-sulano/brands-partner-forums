# Generic AI Review Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the AI Review Removal Assessment's status-locked field names/labels to
status-neutral ones, and make the not-removed prompt path surface both a risk read and a
positive content read, so the feature reads correctly for a Published review, not just a
Removed one.

**Architecture:** Pure rename + prompt-content change across 4 files that share one JSON shape:
the edge function that defines and returns it (`review-removal-assessment/index.ts`), the
frontend type/validator that parses it (`src/lib/reviewRemovalAssessment.ts`), the component
that renders it (`src/components/ReviewRemovalAssessment.tsx`), and the Ask AI tool that reads
two of its fields (`ai-assistant/tools.ts`). No database schema change (`entry_review_analyses.
analysis` is jsonb) and no new deploy slug — same route, same env var, same function names.

**Tech Stack:** Deno Edge Functions (Supabase), React 19 + TypeScript (Vite), Vitest, Deno test.

**Spec:** `docs/superpowers/specs/2026-08-28-generic-ai-review-assessment-design.md`

## Global Constraints

- No file, edge-function-route, or env-var renames — only JSON field names, enum values, and
  UI copy change (spec section "Non-Goals" / design section 1).
- No migration for existing `entry_review_analyses` rows — old cached blobs fail the updated
  validator and simply stop rendering as cached (spec section 6). Do not write a migration or a
  dual-schema reader.
- `ai-assistant/tools.ts`'s `get_review_analyses` must be updated in the same set of tasks as the
  edge function's schema change (this project's standing cross-dashboard consistency rule) — not
  deferred.
- Verify frontend changes with `npm run build`, never `tsc --noEmit` alone (this project's root
  tsconfig is references-only; `tsc --noEmit` checks nothing).
- Both edge functions (`review-removal-assessment`, `ai-assistant`) need `deno check` clean after
  their respective tasks; `ai-assistant` also needs `deno test` clean.
- Deploying both functions is a pending manual step, flagged at the end — not part of any task's
  "done" criteria.

---

### Task 1: Rename the edge function's output schema and prompt

**Files:**
- Modify: `supabase/functions/review-removal-assessment/index.ts:22-53` (`OUTPUT_SCHEMA`),
  `:142-197` (`AI_RULES`), `:215-219` (`buildSystemPrompt`'s `framing`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the new JSON shape every later task parses/renders/reads:
  `key_finding: { label, confidence, alternatives: { label, likelihood }[] }`,
  `supporting_evidence: string[]`, `contrary_evidence: string[]`,
  `risk_or_removal_explanation: string`,
  `overall_result: 'likely_compliant' | 'uncertain' | 'at_risk' | 'no_clear_concern'`.
  All other `OUTPUT_SCHEMA` fields (`risk_score`, `confidence`, `content_assessment`,
  `behavioral_assessment`, `policy_category`, `evidence_summary`, `alternative_explanation`,
  `recommendation`, `agent_recommendation`, `assessment_note`) are unchanged.

No automated test exists for this file (confirmed: no `index_test.ts` in
`supabase/functions/review-removal-assessment/`) — verification is `deno check`, matching this
project's existing precedent for this exact function.

- [ ] **Step 1: Replace `OUTPUT_SCHEMA`**

Replace lines 22-53 of `supabase/functions/review-removal-assessment/index.ts`:

```ts
const OUTPUT_SCHEMA = `{
  "overall_result": "likely_compliant | uncertain | at_risk | no_clear_concern",
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
  "key_finding": {
    "label": "<one concrete, specific sentence naming the single most decisive factor — never a vague category alone>",
    "confidence": "low | medium | high",
    "alternatives": [{ "label": "<specific alternative>", "likelihood": "low | medium | high" }]
  },
  "supporting_evidence": ["<concrete point>"],
  "contrary_evidence": ["<concrete point>"],
  "policy_category": "<one category from the list provided above, or the WO caveat text, or empty string if none applies>",
  "risk_or_removal_explanation": "<1-3 sentences>",
  "evidence_summary": "<1-3 sentences summarizing all evidence considered, including what was NOT available>",
  "alternative_explanation": "<1-2 sentences on a non-policy explanation, e.g. platform moderation error>",
  "recommendation": "<1-2 sentences, actionable>",
  "agent_recommendation": {
    "summary": "<1-2 sentences, addressed directly to the agent/writer, on what to do differently next time>",
    "specific_actions": ["<concrete, behavioral action an agent can change>"]
  },
  "assessment_note": "<leave this field's exact wording to the system — you do not need to fill this in accurately>"
}`;
```

- [ ] **Step 2: Update `AI_RULES` field references**

In the same file, within `AI_RULES` (currently lines 142-197), make these exact text
replacements (everything else in `AI_RULES` is unchanged):

Replace:
```
- You MUST populate both "evidence_for_removal" and "evidence_against_removal" — a
  real assessment always has something on both sides, even if one side is thin
  (e.g. "no positive evidence beyond the review's polite tone").
- "root_cause.label" must name a specific, concrete trigger, not a bare category —
  "possible coordinated review activity" alone is not acceptable; name what
  specifically suggests it (e.g. "posted 4 minutes after a welcome-email redirect,
  from a proxy already tied to 2 other removed reviews for different brands").
```

With:
```
- You MUST populate both "supporting_evidence" and "contrary_evidence" — a
  real assessment always has something on both sides, even if one side is thin
  (e.g. "no positive evidence beyond the review's polite tone").
- "key_finding.label" must name a specific, concrete factor, not a bare category —
  "possible coordinated review activity" alone is not acceptable; name what
  specifically suggests it (e.g. "posted 4 minutes after a welcome-email redirect,
  from a proxy already tied to 2 other removed reviews for different brands").
```

Replace:
```
- If evidence.hardSignals.duplicateReviewTextFound or
  evidence.hardSignals.proxyTiedToOtherRemoval is true, that signal MUST appear as
  your top-ranked "root_cause" candidate unless you explicitly explain in
  "evidence_against_removal" why it does not apply to this specific case.
```

With:
```
- If evidence.hardSignals.duplicateReviewTextFound or
  evidence.hardSignals.proxyTiedToOtherRemoval is true, that signal MUST appear as
  your top-ranked "key_finding" candidate unless you explicitly explain in
  "contrary_evidence" why it does not apply to this specific case.
```

- [ ] **Step 3: Update `buildSystemPrompt`'s `framing` to add the positive read for non-removed reviews**

Replace lines 215-219:

```ts
function buildSystemPrompt(platform: Platform, status: string): string {
  const removedLike = /remov|refus|reject/i.test(status);
  const framing = removedLike
    ? `This review's current recorded status is "${status || 'unknown'}" (a removed/refused-type status). Frame "root_cause" and "why_it_may_have_been_removed" as explaining why the review may have been removed — or state plainly that no clear reason is evident.`
    : `This review's current recorded status is "${status || 'unknown'}" (not a removed/refused-type status). Frame "root_cause" and "why_it_may_have_been_removed" as a forward-looking risk read — what WOULD put this review at risk if it were reviewed today — or state that no meaningful risk is evident. Do not claim the review was actually removed.`;
```

With:

```ts
function buildSystemPrompt(platform: Platform, status: string): string {
  const removedLike = /remov|refus|reject/i.test(status);
  const framing = removedLike
    ? `This review's current recorded status is "${status || 'unknown'}" (a removed/refused-type status). Frame "key_finding" and "risk_or_removal_explanation" as explaining why the review may have been removed — or state plainly that no clear reason is evident.`
    : `This review's current recorded status is "${status || 'unknown'}" (not a removed/refused-type status). This is a live/pending review, not a removed one — give a two-sided read, not just risk avoidance. First, the forward-looking risk read: what WOULD put this review at risk if it were reviewed today, framed in "risk_or_removal_explanation" — or state that no meaningful risk is evident. Second, and just as important: use "contrary_evidence" and "content_assessment.summary" to name concrete, specific things in the review's own text (word choice, specificity of detail, plausibility, consistency with the account's other behavior) that support it reading as genuine and compliant — do not limit this to "no risk found," actually point to what's good about it. Set "key_finding" to whichever of the two is more decisive for this review — a real risk factor if one clearly exists, or its standout strength if the evidence leans compliant. Do not claim the review was actually removed.`;
```

- [ ] **Step 4: Verify with `deno check`**

Run: `cd supabase/functions/review-removal-assessment && deno check index.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/review-removal-assessment/index.ts
git commit -m "feat: generalize AI review assessment schema and add positive content read"
```

---

### Task 2: Rename the frontend type/validator (`src/lib/reviewRemovalAssessment.ts`)

**Files:**
- Modify: `src/lib/reviewRemovalAssessment.ts`
- Test: `src/lib/reviewRemovalAssessment.test.ts`

**Interfaces:**
- Consumes: the schema shape produced by Task 1 (`key_finding`, `supporting_evidence`,
  `contrary_evidence`, `risk_or_removal_explanation`, new `overall_result` enum values).
- Produces: `ReviewRemovalAssessmentResult` (same exported type name, renamed fields),
  `KeyFinding`/`KeyFindingAlternative` (renamed from `RootCause`/`RootCauseCandidate`),
  `isValidAssessmentResult(data: unknown): data is ReviewRemovalAssessmentResult` (same
  signature, validates the new field names) — consumed by Task 3
  (`ReviewRemovalAssessment.tsx`) and indirectly by Task 5's `queries.test.ts` fixture.

- [ ] **Step 1: Update the test fixture and assertions to the new shape (write the failing test first)**

In `src/lib/reviewRemovalAssessment.test.ts`, replace the `VALID_RESULT` object (lines 29-60):

```ts
const VALID_RESULT: ReviewRemovalAssessmentResult = {
  overall_result: 'no_clear_concern',
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
  key_finding: {
    label: 'No clear reason found.',
    confidence: 'medium',
    alternatives: [],
  },
  supporting_evidence: ['Review text is specific and consistent with genuine use.'],
  contrary_evidence: ['No behavioral red flags recorded.'],
  policy_category: '',
  risk_or_removal_explanation: 'No evidence points to a specific cause.',
  evidence_summary: 'Content is compliant; behavioral data shows nothing unusual.',
  alternative_explanation: 'Could be an unrelated moderation error.',
  recommendation: 'No action needed based on available evidence.',
  agent_recommendation: {
    summary: 'No change needed based on available evidence.',
    specific_actions: [],
  },
  assessment_note: 'This is an AI assessment based on the available review, dashboard data, behavioral signals, and Trustpilot\'s published guidelines. It does not confirm Trustpilot\'s private/internal moderation decision.',
};
```

Then, within `describe('isValidAssessmentResult', ...)` (lines 142-222), apply these renames
(field names/values only — test descriptions and structure stay the same):

- Line 178: `const { root_cause, ...rest } = VALID_RESULT;` → `const { key_finding, ...rest } = VALID_RESULT;`
- Line 183-188 (`'rejects a root_cause with an invalid confidence value'`):
  ```ts
  it('rejects a key_finding with an invalid confidence value', () => {
    expect(isValidAssessmentResult({
      ...VALID_RESULT,
      key_finding: { ...VALID_RESULT.key_finding, confidence: 'certain' },
    })).toBe(false);
  });
  ```
- Line 190-195 (`'rejects a root_cause with a malformed alternative_causes entry'`):
  ```ts
  it('rejects a key_finding with a malformed alternatives entry', () => {
    expect(isValidAssessmentResult({
      ...VALID_RESULT,
      key_finding: { ...VALID_RESULT.key_finding, alternatives: [{ label: 'x', likelihood: 'extreme' }] },
    })).toBe(false);
  });
  ```
- Line 197-199 (`'rejects a non-array evidence_for_removal'`):
  ```ts
  it('rejects a non-array supporting_evidence', () => {
    expect(isValidAssessmentResult({ ...VALID_RESULT, supporting_evidence: 'none' })).toBe(false);
  });
  ```
- Line 201-203 (`'rejects a non-array evidence_against_removal'`):
  ```ts
  it('rejects a non-array contrary_evidence', () => {
    expect(isValidAssessmentResult({ ...VALID_RESULT, contrary_evidence: 'none' })).toBe(false);
  });
  ```
- Line 217-221 (the legacy-shape regression test) — update the destructure to the new field
  names so it still proves an *old-shaped* blob is rejected:
  ```ts
  it('rejects the pre-generalization shape (root_cause/evidence_for_removal present, key_finding/supporting_evidence absent)', () => {
    const { key_finding, supporting_evidence, contrary_evidence, agent_recommendation, ...legacyRest } = VALID_RESULT;
    const legacyShape = { ...legacyRest, root_cause: key_finding, evidence_for_removal: supporting_evidence, evidence_against_removal: contrary_evidence };
    expect(isValidAssessmentResult(legacyShape)).toBe(false);
  });
  ```
- Line 30 area (`'rejects an invalid overall_result enum value'`, line 152-154) — no change
  needed, `'definitely_removed'` is still an invalid value under the new enum too.
- Line 178 area (`'rejects a missing root_cause'` test description at line 178) → rename the
  `it(...)` description to `'rejects a missing key_finding'`.

- [ ] **Step 2: Run the test suite to verify it fails against the current implementation**

Run: `npx vitest run src/lib/reviewRemovalAssessment.test.ts`
Expected: FAIL — `VALID_RESULT` no longer matches the `ReviewRemovalAssessmentResult` type
(TS build-time in a real build, and at runtime `isValidAssessmentResult` rejects it since
`root_cause`/`evidence_for_removal`/`evidence_against_removal`/`why_it_may_have_been_removed`
are still what the current implementation checks for).

- [ ] **Step 3: Update `src/lib/reviewRemovalAssessment.ts`**

Replace lines 6-50 (the type definitions):

```ts
export type OverallResult = 'likely_compliant' | 'uncertain' | 'at_risk' | 'no_clear_concern';
export type Confidence = 'low' | 'medium' | 'high';
export type Severity = 'low' | 'medium' | 'high';
export type ContentStatus = 'compliant' | 'potential_concern' | 'likely_violation';
export type BehavioralStatus = 'normal' | 'potential_concern' | 'high_risk' | 'insufficient_data';

export interface AssessmentSignal {
  name: string;
  severity: Severity;
  evidence: string;
}

export interface KeyFindingAlternative {
  label: string;
  likelihood: Severity;
}

export interface KeyFinding {
  label: string;
  confidence: Confidence;
  alternatives: KeyFindingAlternative[];
}

export interface AgentRecommendation {
  summary: string;
  specific_actions: string[];
}

export interface ReviewRemovalAssessmentResult {
  overall_result: OverallResult;
  risk_score: number;
  confidence: Confidence;
  content_assessment: { status: ContentStatus; summary: string; signals: AssessmentSignal[] };
  behavioral_assessment: { status: BehavioralStatus; summary: string; signals: AssessmentSignal[] };
  key_finding: KeyFinding;
  supporting_evidence: string[];
  contrary_evidence: string[];
  policy_category: string;
  risk_or_removal_explanation: string;
  evidence_summary: string;
  alternative_explanation: string;
  recommendation: string;
  agent_recommendation: AgentRecommendation;
  assessment_note: string;
}
```

Replace lines 129-191 (the validator section — `OVERALL_RESULTS` through
`isValidAssessmentResult`):

```ts
const OVERALL_RESULTS = new Set<string>(['likely_compliant', 'uncertain', 'at_risk', 'no_clear_concern']);
const CONFIDENCES = new Set<string>(['low', 'medium', 'high']);
const SEVERITIES = new Set<string>(['low', 'medium', 'high']);
const CONTENT_STATUSES = new Set<string>(['compliant', 'potential_concern', 'likely_violation']);
const BEHAVIORAL_STATUSES = new Set<string>(['normal', 'potential_concern', 'high_risk', 'insufficient_data']);
const REQUIRED_STRING_FIELDS = [
  'policy_category', 'risk_or_removal_explanation',
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

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isValidKeyFindingAlternative(c: unknown): c is KeyFindingAlternative {
  if (!c || typeof c !== 'object') return false;
  const cand = c as Record<string, unknown>;
  return typeof cand.label === 'string' && SEVERITIES.has(cand.likelihood as string);
}

function isValidKeyFinding(kf: unknown): kf is KeyFinding {
  if (!kf || typeof kf !== 'object') return false;
  const k = kf as Record<string, unknown>;
  return typeof k.label === 'string'
    && CONFIDENCES.has(k.confidence as string)
    && Array.isArray(k.alternatives)
    && k.alternatives.every(isValidKeyFindingAlternative);
}

function isValidAgentRecommendation(ar: unknown): ar is AgentRecommendation {
  if (!ar || typeof ar !== 'object') return false;
  const a = ar as Record<string, unknown>;
  return typeof a.summary === 'string' && isStringArray(a.specific_actions);
}

export function isValidAssessmentResult(data: unknown): data is ReviewRemovalAssessmentResult {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (!OVERALL_RESULTS.has(d.overall_result as string)) return false;
  if (typeof d.risk_score !== 'number') return false;
  if (!CONFIDENCES.has(d.confidence as string)) return false;
  if (!isValidSignalGroup(d.content_assessment, CONTENT_STATUSES)) return false;
  if (!isValidSignalGroup(d.behavioral_assessment, BEHAVIORAL_STATUSES)) return false;
  if (!isValidKeyFinding(d.key_finding)) return false;
  if (!isStringArray(d.supporting_evidence)) return false;
  if (!isStringArray(d.contrary_evidence)) return false;
  if (!isValidAgentRecommendation(d.agent_recommendation)) return false;
  return REQUIRED_STRING_FIELDS.every((k) => typeof d[k] === 'string');
}
```

Nothing else in the file changes — `hashAssessmentInput`, `canonicalEvidence`,
`collectBehavioralFields`, `entryReviewAnalysisKey`, `requestReviewRemovalAssessment`,
`CREDENTIAL_FIELD_NAMES`, `ASSESSMENT_FAILURE_MESSAGE` are untouched (none reference the
renamed output fields).

- [ ] **Step 4: Run the test suite to verify it passes**

Run: `npx vitest run src/lib/reviewRemovalAssessment.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reviewRemovalAssessment.ts src/lib/reviewRemovalAssessment.test.ts
git commit -m "feat: rename review assessment types/validator to status-neutral fields"
```

---

### Task 3: Update the frontend component (`src/components/ReviewRemovalAssessment.tsx`)

**Files:**
- Modify: `src/components/ReviewRemovalAssessment.tsx`

**Interfaces:**
- Consumes: `ReviewRemovalAssessmentResult`, `isValidAssessmentResult`,
  `AssessmentSignal` from Task 2's `src/lib/reviewRemovalAssessment.ts`; `status: string` prop
  (already present, unchanged).
- Produces: no new exports — this is the leaf UI consumer.

No dedicated component test exists for this file (per this project's established convention for
page/complex-component UI — verified via build + manual check, not unit tests). Verification is
`npm run build` plus a manual read of both status branches.

- [ ] **Step 1: Rename the section header**

In `src/components/ReviewRemovalAssessment.tsx:153`, replace:

```tsx
<span className="text-xs font-medium text-slate-500">AI Review Removal Assessment</span>
```

With:

```tsx
<span className="text-xs font-medium text-slate-500">AI Review Assessment</span>
```

- [ ] **Step 2: Update `OVERALL_META` to the new enum values and status-neutral labels**

Replace lines 33-38:

```tsx
const OVERALL_META: Record<ReviewRemovalAssessmentResult['overall_result'], { emoji: string; label: string }> = {
  likely_compliant: { emoji: '🟢', label: 'Likely Compliant' },
  uncertain: { emoji: '🟡', label: 'Uncertain / Insufficient Evidence' },
  at_risk: { emoji: '🔴', label: 'At Risk' },
  no_clear_concern: { emoji: '⚪', label: 'No Clear Concern' },
};
```

- [ ] **Step 3: Add a local removed-like helper and status-aware label constants**

Add this helper directly above the `SignalBadge` function (after line 81, before line 83):

```tsx
function isRemovedLikeStatus(status: string): boolean {
  return /remov|refus|reject/i.test(status);
}
```

- [ ] **Step 4: Update the "Root Cause" line to read `key_finding`**

Replace line 190:

```tsx
<div><span className="font-medium text-slate-700">Root Cause:</span> {result.root_cause.label || '—'} <span className="text-slate-400">({result.root_cause.confidence} confidence)</span></div>
```

With:

```tsx
<div><span className="font-medium text-slate-700">Key Finding:</span> {result.key_finding.label || '—'} <span className="text-slate-400">({result.key_finding.confidence} confidence)</span></div>
```

- [ ] **Step 5: Update the expanded panel's evidence lists, alternatives, and "Why" line**

Replace lines 236-263 (from `alternative_causes` through the "Why" line, inclusive):

```tsx
              {result.key_finding.alternatives.length > 0 && (
                <div>
                  <span className="font-medium text-slate-700">Alternatives:</span>
                  <ul className="mt-0.5 list-disc pl-4">
                    {result.key_finding.alternatives.map((c, i) => <li key={i}>{c.label} <span className="text-slate-400">({c.likelihood})</span></li>)}
                  </ul>
                </div>
              )}
              {result.supporting_evidence.length > 0 && (
                <div>
                  <span className="font-medium text-slate-700">{isRemovedLikeStatus(status) ? 'Evidence For Removal:' : 'Risk Factors:'}</span>
                  <ul className="mt-0.5 list-disc pl-4">
                    {result.supporting_evidence.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              {result.contrary_evidence.length > 0 && (
                <div>
                  <span className="font-medium text-slate-700">{isRemovedLikeStatus(status) ? 'Evidence Against Removal:' : 'Content Strengths:'}</span>
                  <ul className="mt-0.5 list-disc pl-4">
                    {result.contrary_evidence.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              <div><span className="font-medium text-slate-700">Policy Category:</span> {result.policy_category || '—'}</div>
              <div><span className="font-medium text-slate-700">{isRemovedLikeStatus(status) ? 'Why It May Have Been Removed:' : 'Risk Read:'}</span> {result.risk_or_removal_explanation || '—'}</div>
```

- [ ] **Step 6: Verify with a full build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (per this project's established rule,
`tsc --noEmit` alone does not exercise this — the build is the real check).

- [ ] **Step 7: Manual read-through of both status branches**

Read the rendered JSX mentally (or via a quick dev-server check) for a Removed entry and a
Published entry: confirm the header reads "AI Review Assessment" in both, and the evidence/why
labels differ as designed (Evidence For/Against Removal + Why It May Have Been Removed vs. Risk
Factors/Content Strengths + Risk Read).

- [ ] **Step 8: Commit**

```bash
git add src/components/ReviewRemovalAssessment.tsx
git commit -m "feat: generalize AI Review Assessment UI labels and header"
```

---

### Task 4: Update the Ask AI tool (`ai-assistant/tools.ts`)

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts:1216-1244` (tool definition),
  `:1527-1571` (`get_review_analyses` dispatch)
- Test: `supabase/functions/ai-assistant/tools_test.ts:1449-1577`

**Interfaces:**
- Consumes: `entry_review_analyses.analysis` rows written under the new schema from Task 1
  (`analysis.key_finding.label`, `analysis.overall_result` with value `'at_risk'`).
- Produces: `get_review_analyses` tool output rows/groups with renamed fields
  (`key_finding` replacing `root_cause`, `at_risk_count` replacing
  `likely_removal_risk_count`) — no other file consumes this tool's output shape directly (it's
  read by the LLM at runtime, not by other code).

- [ ] **Step 1: Update the failing tests first**

In `supabase/functions/ai-assistant/tools_test.ts`, apply these exact edits:

Replace lines 1451-1470:

```ts
Deno.test('get_review_analyses returns raw rows with resolved brand and agent', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'at_risk', risk_score: 80, confidence: 'high', key_finding: { label: 'proxy pattern' } }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', {});
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].brand, 'Acme');
  assertEquals(result.rows[0].agent, 'Lai');
  assertEquals(result.rows[0].overall_result, 'at_risk');
  assertEquals(result.rows[0].key_finding, 'proxy pattern');
});
```

Replace lines 1472-1492:

```ts
Deno.test('get_review_analyses group_by="agent" produces exact counts including at_risk_count', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'at_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
      { entry_id: 'e2', tab: 'Rooster Partners', platform: 'ag', analysis: { overall_result: 'no_clear_concern' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
      { id: 'e2', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', { group_by: 'agent' });
  assertEquals(result.total, 2);
  assertEquals(result.groups[0].value, 'Lai');
  assertEquals(result.groups[0].count, 2);
  assertEquals(result.groups[0].at_risk_count, 1);
});
```

Replace lines 1494-1509:

```ts
Deno.test('get_review_analyses excludes a brand flagged removed on the queried platform', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'at_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [],
    removed_platform_brands: [{ tab: 'Rooster Partners', brand: 'Acme', platform: 'tp' }],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', {});
  assertEquals(result.total, 0);
});
```

Lines 1511-1515 (`'rejects an invalid group_by value'`) are unchanged — no `overall_result`
fixture in that test.

Replace lines 1517-1537:

```ts
Deno.test('get_review_analyses group_by="brand" trims a leading/trailing-space brand variant into the same bucket', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'at_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
      { entry_id: 'e2', tab: 'Rooster Partners', platform: 'ag', analysis: { overall_result: 'no_clear_concern' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
      { id: 'e2', tab: 'Rooster Partners', data: { Brands: ' Acme ', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', { group_by: 'brand' });
  assertEquals(result.total, 2);
  assertEquals(result.groups.length, 1);
  assertEquals(result.groups[0].value, 'Acme');
  assertEquals(result.groups[0].count, 2);
});
```

Replace lines 1539-1554:

```ts
Deno.test('get_review_analyses excludes rows from an archived tab', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'at_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [{ tab: 'Rooster Partners', restored_at: null }],
    paused_tabs: [],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', {});
  assertEquals(result.total, 0);
});
```

Replace lines 1556-1571:

```ts
Deno.test('get_review_analyses excludes rows from a paused tab', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'at_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [{ tab: 'Rooster Partners' }],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', {});
  assertEquals(result.total, 0);
});
```

Lines 1573-1577 (`'rejects an invalid platform value'`) are unchanged — no `overall_result`
fixture in that test.

- [ ] **Step 2: Run the tests to verify they fail against the current implementation**

Run: `cd supabase/functions/ai-assistant && deno test --allow-env --allow-net tools_test.ts --filter "get_review_analyses"`
Expected: FAIL — the dispatch code still reads `analysis.root_cause` and compares against
`'likely_removal_risk'`, so `result.rows[0].key_finding` is `undefined` and
`result.groups[0].at_risk_count` is `undefined`.

- [ ] **Step 3: Update the tool definition and dispatch code**

In `supabase/functions/ai-assistant/tools.ts`, replace lines 1216-1232 (the `get_review_analyses`
tool definition's `name`/`description`, keep `parameters` unchanged since `group_by`'s enum
values `'agent' | 'brand' | 'platform' | 'overall_result'` are group-by-field names, not
`overall_result`'s own enum values, and don't need to change):

```ts
      name: 'get_review_analyses',
      description:
        'Returns AI-generated review-risk assessments from the dashboard\'s per-entry ' +
        '"🤖 Analyze Review" feature. Coverage is SPARSE and OPPORTUNISTIC: only entries someone ' +
        'has manually clicked "Analyze Review" on exist here — this is not run automatically or ' +
        'on every removed/refused review. An empty or small result means "not yet analyzed", ' +
        'never "no risk issues found" — do not imply broader coverage than what is ' +
        'actually returned. Without group_by, returns individual analyzed entries (tab, brand, ' +
        'agent, platform, overall_result, risk_score, confidence, key_finding, analyzed_at). With ' +
        'group_by ("agent", "brand", "platform", or "overall_result"), returns exact counts per ' +
        'group plus how many were "at_risk", sorted most-common-first — prefer this ' +
        'over manually counting rows yourself for "which X has the most" questions. The "agent" ' +
        'field/group is resolved per-brand the same way get_success_rate_by_field and Schedule ' +
        'Planner do (an authoritative brand-agent mapping first, falling back to each entry\'s own ' +
        'recorded Agent value). Brands flagged removed on the queried platform (see ' +
        'get_removed_platform_flags) are excluded, as are archived/paused tabs — same exclusions ' +
        'as every other tool here.',
```

Replace lines 1527-1571 (the row mapping and group_by logic):

```ts
    let combined = filteredAnalysisRows
      .map((r: any) => {
        const entry = entryById.get(r.entry_id);
        const brand = (entry ? (pick(entry.data, BRAND_KEYS) ?? '').trim() : '');
        const agent = agentLabels.get(r.entry_id) ?? '';
        return {
          id: r.entry_id,
          tab: r.tab,
          platform: r.platform,
          brand,
          agent,
          overall_result: r.analysis?.overall_result ?? null,
          risk_score: r.analysis?.risk_score ?? null,
          confidence: r.analysis?.confidence ?? null,
          key_finding: r.analysis?.key_finding?.label ?? null,
          analyzed_at: r.analyzed_at,
        };
      })
      .filter((row: any) => !(row.brand && removedSet.has(platformRemovedKey(row.tab, row.brand, row.platform as Platform))));

    if (args?.agent) {
      const wantAgent = String(args.agent).trim().toLowerCase();
      combined = combined.filter((row: any) => row.agent.toLowerCase() === wantAgent);
    }

    const limit = Math.min(Number(args?.limit) || 25, 50);

    if (args?.group_by) {
      const buckets = new Map<string, { value: string; count: number; at_risk_count: number }>();
      for (const row of combined) {
        const key = args.group_by === 'agent' ? (row.agent || '(unassigned)')
          : args.group_by === 'brand' ? (row.brand || '(unknown)')
          : args.group_by === 'platform' ? row.platform
          : (row.overall_result ?? '(unknown)');
        const isRisk = row.overall_result === 'at_risk';
        const existing = buckets.get(key);
        if (existing) {
          existing.count++;
          if (isRisk) existing.at_risk_count++;
        } else {
          buckets.set(key, { value: key, count: 1, at_risk_count: isRisk ? 1 : 0 });
        }
      }
      const groups = [...buckets.values()].sort((a, b) => b.count - a.count);
      return { total: combined.length, groups: groups.slice(0, limit) };
    }

    return { total: combined.length, rows: combined.slice(0, limit) };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd supabase/functions/ai-assistant && deno test --allow-env --allow-net tools_test.ts --filter "get_review_analyses"`
Expected: PASS, all `get_review_analyses` tests green.

- [ ] **Step 5: Run `deno check` and the full Deno suite**

Run: `cd supabase/functions/ai-assistant && deno check tools.ts && deno test --allow-env --allow-net`
Expected: `deno check` clean; full suite passes (no other test in this file references the
renamed fields — confirmed via the earlier repo-wide grep).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat: sync get_review_analyses tool to generalized assessment schema"
```

---

### Task 5: Fix the remaining stale fixture and run full verification

**Files:**
- Modify: `src/lib/queries.test.ts:870`

**Interfaces:**
- Consumes: `ReviewRemovalAssessmentResult` type from Task 2.
- Produces: nothing new — this is final cleanup + verification.

- [ ] **Step 1: Update the stale `SAMPLE_ANALYSIS` fixture**

In `src/lib/queries.test.ts:870`, replace:

```ts
const SAMPLE_ANALYSIS = { overall_result: 'no_clear_removal_reason' } as unknown as ReviewRemovalAssessmentResult;
```

With:

```ts
const SAMPLE_ANALYSIS = { overall_result: 'no_clear_concern' } as unknown as ReviewRemovalAssessmentResult;
```

- [ ] **Step 2: Run the full frontend test suite**

Run: `npm test`
Expected: all tests pass (no regressions from Tasks 2/3/5's changes).

- [ ] **Step 3: Run the full frontend build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Re-run both edge functions' Deno checks**

Run:
```bash
cd supabase/functions/review-removal-assessment && deno check index.ts
cd ../ai-assistant && deno check tools.ts index.ts && deno test --allow-env --allow-net
```
Expected: all clean/passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.test.ts
git commit -m "test: sync stale review-analysis fixture to generalized overall_result enum"
```

- [ ] **Step 6: Flag pending deploys**

No code action — note in the task's final report (and, if this project's PMS-sync workflow
applies, in `docs/task-history.md`) that these two manual deploys are still pending:
- `supabase functions deploy review-removal-assessment`
- `supabase functions deploy ai-assistant`

Until both run, the live edge functions still serve the old (`root_cause`/
`evidence_for_removal`/`likely_removal_risk`-flavored) schema, and any `entry_review_analyses`
row analyzed in the interim keeps the old shape.
