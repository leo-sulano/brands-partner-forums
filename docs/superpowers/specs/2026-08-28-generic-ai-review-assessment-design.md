# AI Review Assessment: Generalize From Removal-Only to Status-Neutral

## Problem

The AI Review Removal Assessment feature (`supabase/functions/review-removal-assessment/`,
`src/components/ReviewRemovalAssessment.tsx`) already runs for reviews of any status — the
edge function's `buildSystemPrompt` already branches on whether the review's status is
removed/refused-like vs. not, framing the analysis as "why was this removed" or "what would
put this at risk today" respectively. But every schema field, enum value, and UI label is
still hard-wired to removal language: `root_cause`, `evidence_for_removal` /
`evidence_against_removal`, `why_it_may_have_been_removed`, `overall_result` values like
`likely_removal_risk`, and the section header itself ("AI Review Removal Assessment"). For a
Published review, this reads as confusing/wrong ("Evidence For Removal" on a review that was
never removed), and the not-removed prompt path only asks for a risk read — it never asks the
model to surface what's actually good about the review's content.

Reported directly by the user from two live screenshots: one Removed review, one Published
review, both showing identically removal-flavored copy.

## Goals

- Section header and all field labels read correctly regardless of the review's status.
- For a Published (or otherwise non-removed) review, the assessment includes both the existing
  forward-looking risk read AND a positive read — concrete things in the review content itself
  that support it being genuine/credible/compliant.
- Schema field names and `overall_result` enum values become status-neutral, since Ask AI's
  `get_review_analyses` tool reads them directly and per this project's cross-dashboard
  consistency rule, any change to shared logic must update every consumer in the same task.
- No new deploy slug, no env var change — the edge function's folder, route, and
  `VITE_REVIEW_REMOVAL_ASSESSMENT_URL` stay exactly as they are today.

## Non-Goals

- Not renaming the edge function directory/route or the `ReviewRemovalAssessment.tsx` /
  `reviewRemovalAssessment.ts` / `reviewRemovalEvidence.ts` file names. These are internal-only
  identifiers; renaming them adds real deploy/env-var risk for zero user-facing benefit.
- Not migrating existing `entry_review_analyses` rows. Per the established precedent from
  Task 262 (this exact function's last schema change), old cached blobs simply fail the updated
  `isValidAssessmentResult` validator and stop rendering as "cached" — the user re-analyzes.
  No migration script, no backward-compatible dual-schema reader.
- Not changing `content_assessment`, `behavioral_assessment`, `policy_category`,
  `evidence_summary`, `alternative_explanation`, `recommendation`, `agent_recommendation`, or
  `assessment_note` — these are already status-neutral in both name and content.
- Not changing the Trustpilot/AG/CG/WO policy-category logic, the evidence bundle
  (`reviewRemovalEvidence.ts`/`computeRemovalEvidence`), or the hard-signal rules in `AI_RULES`
  beyond updating the field names they reference.

## Design

### 1. Naming & UI copy

- `ReviewRemovalAssessment.tsx`'s header span: `"AI Review Removal Assessment"` →
  `"AI Review Assessment"`.
- Button label stays `"Analyze Review"` / `"Re-analyze"` — already generic, untouched.
- No file renames. No edge function route/env var renames.

### 2. Schema changes

**`supabase/functions/review-removal-assessment/index.ts`'s `OUTPUT_SCHEMA`:**

| Old | New | Shape change |
|---|---|---|
| `root_cause: { label, confidence, alternative_causes }` | `key_finding: { label, confidence, alternatives }` | `alternative_causes` → `alternatives` (same `{label, likelihood}[]` shape) |
| `evidence_for_removal: string[]` | `supporting_evidence: string[]` | none |
| `evidence_against_removal: string[]` | `contrary_evidence: string[]` | none |
| `why_it_may_have_been_removed: string` | `risk_or_removal_explanation: string` | none |
| `overall_result` enum `likely_publishable` | `overall_result` enum `likely_compliant` | rename value |
| `overall_result` enum `likely_removal_risk` | `overall_result` enum `at_risk` | rename value |
| `overall_result` enum `no_clear_removal_reason` | `overall_result` enum `no_clear_concern` | rename value |
| `overall_result` enum `uncertain` | unchanged | — |

Everything else in `OUTPUT_SCHEMA` is untouched.

**`src/lib/reviewRemovalAssessment.ts`:**
- `OverallResult` type and `OVERALL_RESULTS` set updated to the new enum values.
- `RootCause`/`RootCauseCandidate` interfaces renamed to `KeyFinding`/`KeyFindingAlternative`
  (field `alternative_causes` → `alternatives`); `isValidRootCause`/`isValidRootCauseCandidate`
  renamed and updated to match (`isValidKeyFinding`/`isValidKeyFindingAlternative`).
- `ReviewRemovalAssessmentResult` interface: `root_cause` → `key_finding`,
  `evidence_for_removal`/`evidence_against_removal` → `supporting_evidence`/`contrary_evidence`,
  `why_it_may_have_been_removed` → `risk_or_removal_explanation`. `REQUIRED_STRING_FIELDS`
  array updated accordingly. `isValidAssessmentResult` updated to check the renamed fields.
- No change to `hashAssessmentInput`/`canonicalEvidence`/`collectBehavioralFields` — these hash
  the *input* to the assessment, not its output shape.

### 3. Prompt behavior (`buildSystemPrompt`)

The existing `removedLike` branch in `buildSystemPrompt` is kept (it already correctly detects
removed/refused-like statuses) but both branches' instructions are rewritten:

- **Removed-like:** unchanged intent — explain the likely removal trigger via `key_finding` and
  `risk_or_removal_explanation`, or state plainly that no clear reason is evident.
- **Not removed-like:** now explicitly asks for *both* halves the user confirmed they want —
  the existing forward-looking risk read (what would put this at risk today), **and** a
  positive read: concrete, specific things in the review's own text (word choice, specificity,
  plausibility, consistency with the account's other behavior) that support it reading as
  genuine and compliant. The positive read is expected in `contrary_evidence` and
  `content_assessment.summary`; `key_finding` for a not-removed review should surface whichever
  is more decisive — a real risk factor if one exists, or the review's standout strength if the
  evidence leans compliant.

`AI_RULES` is updated to reference the renamed fields (`supporting_evidence` /
`contrary_evidence` instead of `evidence_for_removal` / `evidence_against_removal`, `key_finding`
instead of `root_cause`) everywhere it currently names them, including the hard-signal rule that
forces a hard signal to be the top-ranked finding.

### 4. Frontend rendering (`ReviewRemovalAssessment.tsx`)

Field *names* read from `result` are the new generic ones, but the component still branches on
`status` (already a prop) purely for label text, reusing the same removed-like detection the
backend uses (`/remov|refus|reject/i.test(status)`), duplicated locally as a small helper
(no shared module needed for one regex — matches this component's existing self-contained style):

| Element | Removed-like | Not removed |
|---|---|---|
| "Root Cause:" line | "Key Finding:" | "Key Finding:" (label unchanged — reads fine either way) |
| Evidence list 1 | "Evidence For Removal:" | "Risk Factors:" |
| Evidence list 2 | "Evidence Against Removal:" | "Content Strengths:" |
| "Why:" line | "Why It May Have Been Removed:" | "Risk Read:" |

`OVERALL_META` labels become status-neutral: `likely_compliant` → "Likely Compliant",
`at_risk` → "At Risk", `no_clear_concern` → "No Clear Concern", `uncertain` unchanged. These
read correctly for both a Removed and a Published review without further branching.

`SignalBadge`, `evidenceSummaryLine`, `CONTENT_STATUS_META`, `BEHAVIORAL_STATUS_META`,
`riskBucket` are unaffected.

### 5. Cross-dashboard sync — `ai-assistant/tools.ts`

`get_review_analyses` (around line 1538-1561) reads `r.analysis?.root_cause?.label` and compares
`row.overall_result === 'likely_removal_risk'`. Both updated to the new field/enum names:
- `r.analysis?.root_cause?.label` → `r.analysis?.key_finding?.label`
- `row.overall_result === 'likely_removal_risk'` → `row.overall_result === 'at_risk'`
- The tool's own description text (around line 1224-1225, "...root_cause, analyzed_at)") updated
  to say `key_finding` instead of `root_cause`.
- Its Deno test suite (`tools_test.ts`) updated for any fixture data using the old field/enum
  names.

No other `ai-assistant` tool or `src/lib` consumer reads these fields (confirmed via grep across
the repo for `root_cause`, `evidence_for_removal`, `evidence_against_removal`,
`why_it_may_have_been_removed`, `likely_removal_risk`, `likely_publishable`,
`no_clear_removal_reason`).

### 6. Cached data compatibility

`entry_review_analyses.analysis` (jsonb) rows written before this ships still contain the old
field names. After deploy, `isValidAssessmentResult` will reject them (missing `key_finding`,
etc.), so `ReviewRemovalAssessment.tsx`'s `cachedAnalysis` prop fails validation and the
component falls back to `result = null` — the same "no cached result, re-analyze" state as an
entry that was never analyzed. No migration, no dual-schema reader. This mirrors the exact
precedent set by Task 262's schema change to this same table/component.

### 7. Testing

- `src/lib/reviewRemovalAssessment.test.ts` (if present) — update fixtures/assertions for the
  renamed fields and enum values.
- `ReviewRemovalAssessment.tsx` — no dedicated component test currently exists per repo
  convention (page/complex-component-level UI is verified via build + manual/Playwright check,
  not unit tests, matching `BrandGroup.tsx`/`Overview.tsx` precedent noted in this project's
  history) — verify via `npm run build` and a manual read of the rendered labels for both a
  Removed and a Published entry.
- `supabase/functions/review-removal-assessment/` and `ai-assistant/tools_test.ts` — `deno check`
  and `deno test` both clean.
- Full frontend suite (`npm test`) and `npm run build` both pass.

### 8. Deploy (pending, deferred per project convention)

- `supabase functions deploy review-removal-assessment`
- `supabase functions deploy ai-assistant`

Both flagged as pending manual steps in the task write-up, consistent with every other edge
function change in this project's history — the code change ships in this task; the deploy is a
separate, explicitly-flagged follow-up step.

## Risks / Open Questions

- None identified beyond the accepted cached-data invalidation (section 6), which matches
  established project precedent.
