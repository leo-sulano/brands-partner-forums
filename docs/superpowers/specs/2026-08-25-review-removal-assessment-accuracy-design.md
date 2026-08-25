# AI Review Removal Assessment — Accuracy & Actionability Overhaul — Design Spec

Date: 2026-08-25

## Purpose

The existing AI Review Removal Assessment (Task 225,
`docs/superpowers/specs/2026-08-14-ai-review-removal-assessment-design.md`) analyzes one
review in isolation and often lands on vague, low-actionability verdicts (e.g. "Uncertain /
Insufficient Evidence" with a generic "possible coordinated review activity" reason). This
overhaul makes the assessment:

- **More accurate**: grounded in real cross-entry evidence (other entries sharing the same
  proxy/country, this brand's historical outcomes on the platform, this entry's own status on
  other platforms), not just the single review's text and behavioral flags.
- **More reliable**: deterministic facts are computed in code (never left to the model to infer
  or hallucinate), the model is forced to weigh evidence for and against before concluding, and
  the OpenAI call is deterministic (`temperature: 0`) so near-identical cases get near-identical
  verdicts.
- **More actionable**: a named, ranked root cause instead of a vague bucket, plus a distinct
  "what to do differently next time" section aimed at agents.

This is deliberately scoped to the single-entry assessment only. A follow-up, separate project
will cover agent/brand-level aggregation of these root causes across many entries for management
visibility — out of scope here (see Known Limitations).

## Scope

- Extends the existing feature at its existing call site (`EditEntryModal`'s TP/AG/CG/WO review
  section) — no new page, no new route.
- Applies to all 4 platforms already covered (TP/AG/CG/WO), same as today.
- No new Supabase tables, columns, or migrations. No new Edge Function secrets or DB access.
- Out of scope: agent/brand-level aggregation panel (separate future project — see Known
  Limitations); cross-tab evidence (a brand's history is read from its own tab's entries only,
  matching how brands are modeled today — a brand does not span multiple tabs except via an
  explicit `moveEntryToTab`).

## Evidence bundle (new, computed client-side)

New pure module `src/lib/reviewRemovalEvidence.ts`, operating only on data already loaded by
`BrandGroup.tsx` (the tab's own entries) — no new queries, no new Edge Function DB access.

```ts
interface RemovalEvidence {
  crossEntry: {
    sameProxyCount: number;           // other entries in this tab sharing this entry's canonical proxy
    sameProxyRemovedCount: number;    // ...of which are removed-like on their own platform
    sameProxySameCountryCount: number;
    exampleBrands: string[];          // up to 5 distinct brand names among the sameProxy matches
  };
  brandHistory: {
    totalReviews: number;             // this brand's other entries on this same platform, this tab
    liveCount: number;
    removedCount: number;
    successRatePct: number | null;    // via rateFromCounts/successRatePct (scoreSummary.ts) — same formula as Score Summary
  };
  crossPlatform:
    | { applicable: false }                                   // single-platform tab
    | { applicable: true; other: Partial<Record<Platform, { status: string | null }>> }; // same entry row, other platforms this tab tracks
  hardSignals: {
    duplicateReviewTextFound: boolean; // byte-identical (normalized whitespace) review text found on another entry in this tab
    proxyTiedToOtherRemoval: boolean;  // sameProxyRemovedCount > 0
  };
}

function computeRemovalEvidence(
  tabEntries: Entry[],
  currentEntry: Entry,
  platform: Platform,
  brand: string,
  tab: string,
): RemovalEvidence
```

Implementation notes:
- Proxy matching uses `canonicalProxyKey` (`src/lib/proxyAliases.ts`) and excludes blank/redacted
  values (`resolveProxyLabel` resolving to `NO_PROXY_LABEL`) — too common across unrelated
  entries to be a meaningful signal.
- Brand matching uses `normalizeBrandKey` (`src/lib/removedPlatformBrands.ts`) — the same
  normalization already used for the platform-removed-brand flag, so this can't disagree with
  that feature about which rows belong to the same brand.
- Live/removed classification uses the existing `isLiveStatus`/`isRemovedStatus`
  (`src/lib/scoreSummary.ts`) via that platform's `PLATFORM_STATUS_KEYS` — same rule Score
  Summary and every other surface already uses.
- Cross-platform corroboration only applies when `getTabPlatforms(tab).length > 1` (the 4
  multi-platform tabs); otherwise reports `{ applicable: false }` rather than a false "nothing
  found."
- Duplicate-text detection normalizes whitespace/case before comparing (not a fuzzy/semantic
  match — deliberately conservative, a false negative here is safer than a false positive).

## Output JSON Schema (revised)

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
  "root_cause": {
    "label": "<one concrete, specific sentence naming the most likely trigger>",
    "confidence": "low | medium | high",
    "alternative_causes": [{ "label": "", "likelihood": "low | medium | high" }]
  },
  "evidence_for_removal": ["<concrete point>", "..."],
  "evidence_against_removal": ["<concrete point>", "..."],
  "policy_category": "",
  "why_it_may_have_been_removed": "",
  "evidence_summary": "",
  "alternative_explanation": "",
  "recommendation": "",
  "agent_recommendation": {
    "summary": "<1-2 sentences, addressed to the agent/writer>",
    "specific_actions": ["<concrete action>", "..."]
  },
  "assessment_note": "<unchanged — filled by the system, not the model>"
}
```

Changes from the original schema:
- **Added**: `root_cause` (replaces the old free-text `likely_reason` field entirely — removed,
  not kept alongside), `evidence_for_removal`, `evidence_against_removal`, `agent_recommendation`.
- **Unchanged**: everything else, including `assessment_note` (still overwritten server-side by
  `ASSESSMENT_NOTE_BY_PLATFORM`, unaffected by this change).

New prompt rules (added to `AI_RULES` in `index.ts`):
- You MUST populate both `evidence_for_removal` and `evidence_against_removal` — a real
  assessment always has something on both sides, even if one side is thin (e.g. "no positive
  evidence beyond the review's polite tone").
- `root_cause.label` must name a specific, concrete trigger, not a category — "possible
  coordinated review activity" is not acceptable on its own; if that's genuinely the best
  available conclusion, name what specifically suggests it (e.g. "posted 4 minutes after a
  welcome-email redirect, from a proxy this dashboard has already tied to 2 other removed
  reviews for different brands").
- If the provided `evidence` object's `hardSignals.duplicateReviewTextFound` or
  `hardSignals.proxyTiedToOtherRemoval` is `true`, that signal MUST appear as the top-ranked
  `root_cause` candidate unless you explicitly explain in `evidence_against_removal` why it does
  not apply to this specific case — you may not silently omit it.
- Treat every field of the provided `evidence` object as ground truth — never contradict, adjust,
  or re-derive these numbers; reason from them, don't reinterpret them.
- `agent_recommendation.specific_actions` must be concrete and behavioral (things a human agent
  can change about how/when they act), never a restatement of platform policy.

OpenAI call changes: add `temperature: 0` (currently unset, defaulting to 1) for consistency
across similar cases. `max_tokens` may need raising from 1800 given the added fields — verified
during implementation by checking real responses aren't truncated (`finish_reason === 'length'`
already errors out today, so this is self-detecting).

### Request body (revised)

```ts
{
  platform: 'tp' | 'ag' | 'cg' | 'wo',
  status: string,
  reviewText: string,
  behavioralFields: Record<string, string | null>,
  evidence: RemovalEvidence,   // new
}
```

The Edge Function remains a pure proxy — no DB access, no new secrets. It only formats
`evidence` into the prompt alongside the existing inputs.

## Frontend changes

### `src/pages/BrandGroup.tsx`

Passes its already-loaded `entries` for the active tab into `EditEntryModal` as a new prop
(`tabEntries`) — the same array already used to build `brandProfiles` a few lines above, no new
fetch.

### `src/components/EditEntryModal.tsx`

Accepts `tabEntries?: Entry[]` and forwards it to each `ReviewRemovalAssessment` call site,
alongside the entry/platform/brand values it already passes.

### `src/components/ReviewRemovalAssessment.tsx`

- Computes `RemovalEvidence` via `computeRemovalEvidence` (memoized on `[tabEntries, entry,
  platform, brand, tab]`).
- Includes `evidence` in the `requestReviewRemovalAssessment` payload.
- Renders a new **Evidence row** (always visible once evidence exists, independent of whether an
  AI assessment has been run) directly from the computed bundle — plain numbers, not AI text:
  e.g. `Same proxy: 4 other entries (3 removed) · Brand history on TP: 2/7 live (29%)`. When
  `crossPlatform.applicable` is `false`, this row omits any cross-platform mention rather than
  showing a placeholder.
- Replaces the old "Likely Reason" line with **Root Cause**: `root_cause.label` +
  confidence badge; alternative causes move into the expanded panel as a short ranked list.
- Adds a new, visually prominent **"For Next Time"** block (from `agent_recommendation`) between
  the compact summary rows and the "View AI Assessment" toggle — this is the actionable output,
  it should not be buried behind the expand toggle.
- Expanded panel gains two new subsections: **Evidence For Removal** / **Evidence Against
  Removal** (each a short bullet list), positioned before the existing Policy
  Category/Evidence/Alternative Explanation/Recommendation rows.

### `src/lib/reviewRemovalAssessment.ts`

- `AssessmentInput` gains `evidence: RemovalEvidence`.
- `hashAssessmentInput` now includes a stable serialization of `evidence` in its hashed payload —
  a change to cross-entry evidence (e.g. another entry sharing this proxy gets marked Removed)
  now correctly marks a previously-fresh cached assessment as stale. This is a deliberate
  behavior change from the original design (which explicitly excluded only `status`, not
  evidence — evidence didn't exist yet) and means a cached assessment can go stale without the
  user editing anything in this entry. Reuses the existing "Outdated — data changed" banner
  unchanged.
- `ReviewRemovalAssessmentResult` type and `isValidAssessmentResult` updated: `likely_reason`
  removed; `root_cause`, `evidence_for_removal`, `evidence_against_removal`,
  `agent_recommendation` added as required fields with shape validation (`root_cause.label`/
  `confidence`/`alternative_causes[]`; both evidence arrays are `string[]`;
  `agent_recommendation.summary`/`specific_actions: string[]`).

### Cached data compatibility

No migration. A previously-saved `ai_review_analysis` in the old shape (missing `root_cause`
etc.) simply fails the updated `isValidAssessmentResult` and is treated exactly like "no analysis
yet" — the button reads "🤖 Analyze Review" instead of "↻ Re-analyze", same as any malformed
result today. This matches the original design's own framing of this column as a disposable,
regenerable derived artifact (no audit log, no backward-compatibility shimming).

## Known Limitations (documented, not built here)

- **No agent/brand-level aggregation.** This overhaul only improves the single-entry view. A
  management-facing rollup of recurring root causes across an agent or brand (raised during
  brainstorming, deliberately deferred) is its own follow-up project, to be designed once this
  ships and its `root_cause`/`agent_recommendation` output shape is proven in practice.
- **Evidence is scoped to one tab.** A brand's cross-entry evidence only considers other entries
  in the same tab. This matches how brands are modeled everywhere else in the dashboard (a brand
  belongs to one tab), so it is not treated as a gap — flagged here only so a future reader
  doesn't mistake it for an oversight.
- **Duplicate-text detection is exact-match only** (normalized whitespace/case), not semantic —
  a paraphrased templated review would not be caught. Accepted for v1 to avoid false positives;
  a semantic-similarity pass would need its own design (likely an embeddings call, a real cost
  and complexity increase) and is left for a future iteration if exact-match proves insufficient
  in practice.

## Testing plan

- `src/lib/reviewRemovalEvidence.test.ts` (new):
  - Proxy matching excludes blank and redacted values; correctly counts same-proxy and
    same-proxy-same-country matches; caps `exampleBrands` at 5 and dedupes.
  - Brand matching uses `normalizeBrandKey` (case/whitespace-insensitive).
  - `brandHistory` counts match `isLiveStatus`/`isRemovedStatus` classification and
    `successRatePct` matches `rateFromCounts`/`successRatePct` output for the same counts.
  - `crossPlatform.applicable` is `false` for a single-platform tab and `true` with correct other-
    platform statuses for a multi-platform tab.
  - `hardSignals.duplicateReviewTextFound` true for byte-identical text (incl. whitespace/case
    normalization) and false for merely similar text.
- `src/lib/reviewRemovalAssessment.test.ts` (extend existing):
  - Validator accepts a well-formed sample with the new fields and rejects samples missing
    `root_cause`/`evidence_for_removal`/`evidence_against_removal`/`agent_recommendation` or with
    malformed shapes for each.
  - `hashAssessmentInput` changes when `evidence` changes, with all other inputs held constant.
- No Deno test for the edge function's real OpenAI call (unchanged precedent from the original
  feature).
- Manual verification once deployed: re-run against the same entries used for the original
  feature's verification, plus at least one entry with a real cross-entry proxy match and one
  with real brand history, confirming: (a) the Evidence row shows correct raw numbers
  independent of the AI's conclusion, (b) a known hard signal is surfaced as the top root-cause
  candidate, (c) re-running the same entry twice yields the same root cause (temperature-0
  consistency check), (d) an old cached (pre-overhaul) analysis correctly shows as "not yet
  analyzed" rather than crashing or rendering a malformed result.

## Deployment

Same checklist as the original feature (already pending per this repo's Known Issues — this
overhaul does not add new steps):
1. `supabase functions deploy review-removal-assessment` (ships the revised prompt/schema).
2. No new migration, no new secrets, no new Vercel env var — reuses everything already
   documented as pending for the original feature.
