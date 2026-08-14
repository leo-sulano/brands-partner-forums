# AI Review Removal Assessment — Design Spec

Date: 2026-08-14

## Purpose

Give users a way to ask, for a single TP/WO review entry, "does the available
evidence explain why this review may have been removed?" — analyzing both the
review's own content and the account's recorded behavioral fields against
Trustpilot's real published review guidelines, without assuming a removal is
automatically justified. The tool must be willing to conclude "no clear
removal reason detected" when the evidence doesn't support one.

## Scope

- Applies wherever `ReviewTextBlock` already renders in `EditEntryModal` —
  tabs whose active platforms include `tp` or `wo` (`getTabPlatforms(tab)`).
- The "🤖 Analyze Review" button is always visible, regardless of the entry's
  current TP/WO status (not gated to Removed/Refused only).
- Cross-entry "multiple reviews from the same environment" detection is
  **out of scope for v1** — see Known Limitations.
- AG/CG entries are untouched; this feature does not extend to those
  platforms (they have no comparable public guideline framework and are
  explicitly out of scope per the existing `AG/CG/WO automated
  brand-page-removal detection` Known Issue in this repo's CLAUDE.md).

## Framing by platform

- **TP**: the system prompt provides a fixed summary of Trustpilot's real
  published Guidelines for Reviewers as the only allowed source for
  `policy_category`. The model must not invent categories beyond this list.
- **WO**: no confirmed public Wizard of Odds review-moderation policy exists
  (matches this repo's existing Known Issue noting WO's real removal
  behavior is unverified). The system prompt tells the model this
  explicitly and instructs it to reason only from general genuine-review
  integrity principles (specificity, personal experience, no
  promotional/spam content) for content assessment, and to state plainly in
  `policy_category`/`why_it_may_have_been_removed` that no confirmed WO
  policy framework exists — never fabricate one.

## Framing by status

The three-layer JSON schema and rules are identical regardless of status.
Only the natural-language framing differs:
- If TP/WO status is Removed or Refused (`isRemovedStatus`, from
  `src/lib/scoreSummary.ts`): the assessment explains why the review *may
  have been removed*.
- Otherwise (Live/Published/Pending/etc.): the assessment reads as a
  forward-looking risk check — "would this review be at risk if it were
  reviewed today?" `no_clear_removal_reason` in this case reads as "no
  meaningful risk signal found," not "removal is unexplained."

The system prompt receives the entry's current status string and this
framing instruction; the JSON schema itself does not change.

## Data collected as input (client-side, no new query infra)

From the entry already loaded in `EditEntryModal` (no cross-entry queries):

- Review text: `TP Review Text` or `WO Review Text` (whichever the active
  platform section renders), via `PLATFORM_REVIEW_TEXT_KEYS`.
- Review status: `pick(data, PLATFORM_STATUS_KEYS[platform])`.
- Behavioral fields already surfaced in the modal's "Behavior Flags"
  section (`src/lib/entryFieldSections.ts`'s `YES_NO_COLS` +
  `BEHAVIOR_EXTRA_COLS`) — every one of those keys present on the entry,
  sent as `{ field: value }` pairs. Includes: Register from Google account,
  Leaving Review After redirected from welcome Email, Sticky IP (Mobile),
  Photo in Account, Opening the account via "usefull"/"Register", Scrolling
  and hovering, Smart Paste, Native Language, Backup Codes, Authenticator
  Backup, Redirection from Search Engine, Redirection Word Used, Review
  Language, Desktop/Mobile, Mentioning time frames/Amounts/Agent name,
  Short review/Long.
- Basic account context already in `fields`: Account, Proxy Used, Country,
  Agent (present for evidence framing, not for cross-entry lookups).

Blank/unset fields are sent as `null`/omitted rather than empty strings, so
the model can distinguish "known to be No" from "not recorded" — the latter
must be treated as absence of evidence, not evidence of absence.

## Known Limitations (documented, not built in v1)

- **No cross-entry pattern detection.** "Multiple reviews from the same
  environment" is listed in the request as a signal but isn't computed —
  the AI is told this signal is unavailable so it doesn't imply it checked.
  Follow-up: a `queries.ts` helper counting other entries in the same tab
  sharing Proxy Used + Country (+ Agent) would be the natural extension.
- **WO policy framework is unconfirmed** (see Framing by platform above) —
  by design, not a gap to fix later without new evidence.

## Architecture

### New Edge Function: `supabase/functions/review-removal-assessment/`

Mirrors `translate-review`'s shape (minimal single-shot OpenAI proxy, no
tool-calling loop, no DB access needed — all inputs arrive in the request
body):

- Auth: requires `authorization` header (same check as `translate-review`).
- Model: `gpt-4o` (judgment/policy-reasoning task — matches `ai-assistant`'s
  choice, not `translate-review`'s `gpt-4o-mini`).
- `response_format: { type: 'json_object' }` for reliable structured output.
- Request body: `{ platform: 'tp'|'wo', status: string, reviewText: string,
  behavioralFields: Record<string, string | null> }`.
- System prompt embeds, verbatim:
  - The exact required output JSON shape (see "Output JSON Schema" below).
  - The fixed Trustpilot guideline-category reference list (TP) / the
    no-confirmed-policy instruction (WO).
  - All "AI Rules" below, restated as hard constraints.
  - The status-based framing instruction.
- Returns `{ analysis: <parsed JSON object> }` on success, or `{ error }`
  with a non-200 status on failure (missing text, OpenAI error, non-JSON
  response) — same error-shape convention as `translate-review`.
- No new Supabase client/service-role usage — this function is a pure
  proxy, unlike `ai-assistant`.

### AI Rules (restated in the system prompt)

- Analyze evidence rather than assume a violation.
- Distinguish content problems from behavioral problems.
- Consider both positive and negative evidence.
- Explain exactly what evidence led to the assessment.
- Reference the applicable guideline category when possible (TP only).
- Say "No clear removal reason" when evidence is insufficient.
- Never fabricate a Trustpilot or Wizard of Odds policy.
- Never claim certainty about the platform's internal moderation decision.
- Never automatically classify a review as fake.
- Never assume positive or generic reviews are automatically suspicious or
  removable.
- Never assume behavioral signals prove manipulation — they are indicators,
  not proof.
- Treat every signal as evidence with an explicit severity level.
- Always give a confidence level.

### Output JSON Schema

Exactly the structure specified in the original request (§8), unchanged:

`risk_score` is an integer 0-100 (higher = more risk of the removal being
evidence-backed / of a live review being at risk) — not specified in the
original request, defined here to remove ambiguity for both the prompt and
the frontend renderer:

```json
{
  "overall_result": "likely_publishable | uncertain | likely_removal_risk | no_clear_removal_reason",
  "risk_score": 0,
  "confidence": "low | medium | high",
  "content_assessment": {
    "status": "compliant | potential_concern | likely_violation",
    "summary": "",
    "signals": [{ "name": "", "severity": "low | medium | high", "evidence": "" }]
  },
  "behavioral_assessment": {
    "status": "normal | potential_concern | high_risk | insufficient_data",
    "summary": "",
    "signals": [{ "name": "", "severity": "low | medium | high", "evidence": "" }]
  },
  "likely_reason": "",
  "policy_category": "",
  "why_it_may_have_been_removed": "",
  "evidence_summary": "",
  "alternative_explanation": "",
  "recommendation": "",
  "assessment_note": "This is an AI assessment based on the available review, dashboard data, behavioral signals, and Trustpilot's published guidelines. It does not confirm Trustpilot's private/internal moderation decision."
}
```

### Frontend response validation

Before display or save, `src/lib/reviewRemovalAssessment.ts` validates the
parsed JSON: all required top-level keys present, `overall_result`/
`confidence`/both `status` enums match the allowed value sets, `signals`
arrays are arrays of objects with the three expected keys. On failure: show
an inline error ("Assessment response was malformed — try again.") and do
not save anything. This mirrors `reviewTranslation.ts`'s
throw-on-bad-shape pattern.

### New component: `src/components/ReviewRemovalAssessment.tsx`

Rendered directly under `ReviewTextBlock` in `EditEntryModal`'s TP/WO
section (the same call site currently gated on
`tabPlatforms.includes('tp') || tabPlatforms.includes('wo')`). Collapsed
compact layout per the original request's §10:

- Row 1: Risk emoji + level, Overall Assessment label, Confidence.
- Row 2: Likely Reason + one-line Why.
- Row 3: Compact evidence badges (⚠/✓ + signal name, from both
  `content_assessment.signals` and `behavioral_assessment.signals`, capped
  to a handful of the highest-severity ones so the row doesn't wrap
  excessively).
- Row 4: "View AI Assessment" `<details>`/expandable panel containing the
  full Content Assessment, Behavioral Assessment, Policy Category,
  Evidence, Alternative Explanation, Recommendation, and the
  `assessment_note` disclaimer.

Button states: "🤖 Analyze Review" (no saved analysis, or hash mismatch) /
"↻ Re-analyze" (a matching saved analysis is already displayed) /
loading spinner while the request is in flight. Errors render inline like
`ReviewTextBlock`'s translate-failure banner.

### Staleness / caching (hash-based)

`src/lib/reviewRemovalAssessment.ts` exports `hashAssessmentInput(input)`:
SHA-256 (Web Crypto `crypto.subtle.digest`, browser-native, no new
dependency) over a stable JSON serialization of
`{ platform, reviewText, behavioralFields }` (status is deliberately
excluded from the hash — a pure status change, e.g. Pending → Removed,
should still surface the last cached assessment rather than silently
discarding it, though the UI's status-based framing note will look stale
until the user re-analyzes).

On modal open, if `entry.data` already carries a saved
`ai_review_analysis` + `ai_review_analysis_hash`, the component recomputes
the hash from current field values and compares:
- Match → render the saved `ai_review_analysis` immediately, no AI call,
  button reads "↻ Re-analyze".
- Mismatch or nothing saved → button reads "🤖 Analyze Review"; if a
  (now-stale) saved analysis exists it's still shown but visually marked
  "Outdated — review data changed since this was generated" until
  re-analyzed.

### Storage: new columns on `entries`

New migration `supabase/migrations/20260814150000_add_ai_review_analysis.sql`:

```sql
alter table public.entries
  add column ai_review_analysis jsonb,
  add column ai_review_analysis_hash text,
  add column ai_review_analysis_model text,
  add column ai_review_analysis_at timestamptz;
```

Rationale for columns-on-`entries` over a side table: the assessment is
strictly 1:1 with one entry (unlike `removed_platform_brands` or
`brand_platform_pause`, which are keyed by `(tab, brand_key, platform)`
across many entries) — same shape as the existing `last_edited_by`/
`last_sync_tag` row-scoped metadata columns. No RLS changes needed; the
existing "approved users can update entries" policy already covers writes
to these columns.

New `saveReviewAnalysis(id, analysis, hash, model)` in `src/lib/queries.ts`:
a direct `update` of just these four columns (not a merge into `data`,
and — deliberately — **no `logChange` audit-log entry**, since this is a
derived/cached artifact regenerated from the entry's own existing fields,
not a user edit to business data). Followed by the same
`invalidateTabCache(tab)` call `updateEntryData` already makes, so a
freshly-saved analysis is visible without a manual refresh.

### `src/lib/supabase.ts` addition

```ts
// review-removal-assessment Edge Function URL (gpt-4o proxy). Set in Vercel env
// once the `review-removal-assessment` function is deployed. Empty string means
// the Analyze Review button always fails with the standard error message.
export const REVIEW_REMOVAL_ASSESSMENT_URL = import.meta.env?.VITE_REVIEW_REMOVAL_ASSESSMENT_URL ?? '';
```

## Data flow summary

1. User opens `EditEntryModal` on a TP or WO entry with a review already
   saved.
2. `ReviewRemovalAssessment` computes the current input hash from the
   in-modal `fields` state (not the original `entry.data`) — so editing the
   review text or a behavioral flag before saving immediately marks any
   cached analysis stale, letting a user check a draft edit before saving
   it. If it matches `entry.data.ai_review_analysis_hash`, renders the
   cached result.
3. User clicks "🤖 Analyze Review" / "↻ Re-analyze" → component builds the
   `{ platform, status, reviewText, behavioralFields }` payload → POSTs to
   `REVIEW_REMOVAL_ASSESSMENT_URL` with the session bearer token (same
   pattern as `translateReviewText`).
4. Edge function calls OpenAI once, returns parsed JSON.
5. Frontend validates shape; on success, calls `saveReviewAnalysis` (writes
   `ai_review_analysis`, `ai_review_analysis_hash` [computed from the
   *current* input, so it matches next time], `ai_review_analysis_model`,
   `ai_review_analysis_at`) and renders the four-row compact UI.
6. On failure, shows an inline error; nothing is saved; the previous cached
   result (if any) stays visible, marked outdated only if the hash actually
   changed.

## Testing plan

- `src/lib/reviewRemovalAssessment.test.ts`:
  - `hashAssessmentInput` is deterministic for identical input and changes
    when reviewText or any behavioral field value changes; unaffected by
    status.
  - Response validator accepts a well-formed sample matching §8's schema,
    and rejects: missing top-level keys, invalid `overall_result`/
    `confidence`/status enum values, non-array `signals`, malformed signal
    objects.
- No Deno test for the edge function's real OpenAI call — no precedent for
  this in the repo (`translate-review` has none either); the function is a
  thin proxy with the interesting logic (prompt content) not meaningfully
  unit-testable without hitting the real API.
- Manual verification once deployed: run against 2-3 real Removed/Refused
  TP entries with varying content quality, one compliant Live entry, and
  (if a real WO example exists) one WO entry — confirm the four acceptance
  scenarios (bad content / good content+suspicious behavior / good
  content+normal behavior / insufficient evidence) render sensibly and the
  "No Clear Removal Reason" path is actually reachable, not just
  theoretically allowed by the prompt.

## Deployment (deferred, per this session's "local first" instruction)

Not part of this task's completion criteria — documented as pending, same
pattern as other Known Issues in this repo's CLAUDE.md:
1. `supabase db push` (apply the new migration).
2. `supabase secrets set OPENAI_API_KEY=...` (already set — shared with
   `ai-assistant`/`translate-review`).
3. `supabase functions deploy review-removal-assessment`.
4. Add `VITE_REVIEW_REMOVAL_ASSESSMENT_URL=<deployed URL>` to Vercel env,
   redeploy.
Until step 4, the button always fails with the standard error message,
same as `translate-review`'s pre-deploy state.
