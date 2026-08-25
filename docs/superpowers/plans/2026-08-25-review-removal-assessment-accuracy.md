# Review Removal Assessment Accuracy Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI Review Removal Assessment feature accurate (grounded in real cross-entry evidence), reliable (deterministic facts + forced for/against reasoning + temperature 0), and actionable (a named root cause and an agent-facing "what to do differently" section).

**Architecture:** A new pure evidence-computation module reads the tab's already-loaded entries (no new queries) to build a deterministic `RemovalEvidence` bundle (cross-entry proxy/country pattern, this brand's historical outcomes, cross-platform corroboration, hard signals). That bundle is rendered directly in the UI as raw numbers and sent to the existing Edge Function, whose prompt/output schema is extended to require a named root cause, explicit evidence-for/against, and an agent recommendation.

**Tech Stack:** React 19 + TypeScript (frontend), Deno Edge Function (OpenAI proxy), Vitest (tests).

**Spec:** `docs/superpowers/specs/2026-08-25-review-removal-assessment-accuracy-design.md`

## Global Constraints

- No new Supabase migrations, tables, columns, or secrets. No DB access added to the Edge Function — it remains a pure proxy.
- The OpenAI call must set `temperature: 0`.
- `likely_reason` is removed entirely from the output schema — replaced by `root_cause`, never kept alongside it.
- A previously-saved `ai_review_analysis` in the old shape must fail the updated validator gracefully (treated as "not yet analyzed") — no migration, no crash.
- Proxy matching for cross-entry evidence excludes blank/redacted values (`resolveProxyLabel` resolving to `NO_PROXY_LABEL`).
- Brand matching for cross-entry evidence uses `normalizeBrandKey` (`src/lib/removedPlatformBrands.ts`) — the same normalization the platform-removed-brand flag already uses.
- Cross-platform corroboration only applies when the tab tracks more than one platform (`getTabPlatforms(tab).length > 1`); otherwise it must report `{ applicable: false }`, never a false "nothing found."
- Live/removed classification must use the existing `isLiveStatus`/`isRemovedStatus` (`src/lib/scoreSummary.ts`) — never a new ad hoc classifier.

---

### Task 1: Evidence computation module

**Files:**
- Create: `src/lib/reviewRemovalEvidence.ts`
- Test: `src/lib/reviewRemovalEvidence.test.ts`

**Interfaces:**
- Consumes: `Entry` (`src/types/entry.ts`), `Platform`/`PLATFORM_STATUS_KEYS`/`pick`/`getReviewText`/`isLiveStatus`/`isRemovedStatus`/`rateFromCounts`/`successRatePct` (`src/lib/scoreSummary.ts`), `canonicalProxyKey`/`resolveProxyLabel`/`NO_PROXY_LABEL` (`src/lib/proxyAliases.ts`), `normalizeBrandKey` (`src/lib/removedPlatformBrands.ts`), `BRAND_COLS`/`getTabPlatforms` (`src/lib/tab-configs.ts`).
- Produces: `RemovalEvidence` type and `computeRemovalEvidence(tabEntries: Entry[], currentEntry: Entry, platform: Platform, brand: string, tab: string): RemovalEvidence` — consumed by Task 2 (hashing) and Task 4 (component).

- [ ] **Step 1: Write the failing test**

Create `src/lib/reviewRemovalEvidence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeRemovalEvidence } from './reviewRemovalEvidence';
import type { Entry } from '../types/entry';

let nextId = 1;
function makeEntry(data: Record<string, string | null>, tab = 'Rooster Partners'): Entry {
  return {
    id: `entry-${nextId++}`,
    tab,
    sheet_row_id: `row-${nextId}`,
    data,
    updated_at: '2026-08-01T00:00:00.000Z',
    last_edited_by: 'dashboard',
    last_sync_tag: null,
  };
}

describe('computeRemovalEvidence — cross-entry proxy pattern', () => {
  it('counts other entries sharing the exact same canonical proxy, excluding blank/redacted', () => {
    const current = makeEntry({ Brands: 'BrandA', 'Proxy Used': 'Proxylite', Country: 'Germany', 'TP Review Status': 'Removed' });
    const sameProxyOther = makeEntry({ Brands: 'BrandB', 'Proxy Used': 'proylite', Country: 'France', 'TP Review Status': 'Removed' }); // typo alias, still matches
    const differentProxy = makeEntry({ Brands: 'BrandC', 'Proxy Used': 'SmartProxy', Country: 'Germany', 'TP Review Status': 'Live' });
    const blankProxy = makeEntry({ Brands: 'BrandD', 'Proxy Used': '', Country: 'Germany', 'TP Review Status': 'Live' });
    const redactedProxy = makeEntry({ Brands: 'BrandE', 'Proxy Used': '*****', Country: 'Germany', 'TP Review Status': 'Live' });
    const tabEntries = [current, sameProxyOther, differentProxy, blankProxy, redactedProxy];

    const evidence = computeRemovalEvidence(tabEntries, current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.crossEntry.sameProxyCount).toBe(1);
    expect(evidence.crossEntry.sameProxyRemovedCount).toBe(1);
    expect(evidence.crossEntry.exampleBrands).toEqual(['BrandB']);
  });

  it('reports zero cross-entry matches when the current entry itself has no real proxy recorded', () => {
    const current = makeEntry({ Brands: 'BrandA', 'Proxy Used': '', Country: 'Germany', 'TP Review Status': 'Removed' });
    const other = makeEntry({ Brands: 'BrandB', 'Proxy Used': '', Country: 'Germany', 'TP Review Status': 'Removed' });

    const evidence = computeRemovalEvidence([current, other], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.crossEntry.sameProxyCount).toBe(0);
  });

  it('narrows sameProxySameCountryCount to matches that also share the country', () => {
    const current = makeEntry({ Brands: 'BrandA', 'Proxy Used': 'SmartProxy', Country: 'Germany', 'TP Review Status': 'Removed' });
    const sameCountry = makeEntry({ Brands: 'BrandB', 'Proxy Used': 'SmartProxy', Country: 'Germany', 'TP Review Status': 'Removed' });
    const otherCountry = makeEntry({ Brands: 'BrandC', 'Proxy Used': 'SmartProxy', Country: 'France', 'TP Review Status': 'Removed' });

    const evidence = computeRemovalEvidence([current, sameCountry, otherCountry], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.crossEntry.sameProxyCount).toBe(2);
    expect(evidence.crossEntry.sameProxySameCountryCount).toBe(1);
  });

  it('caps exampleBrands at 5 distinct names', () => {
    const current = makeEntry({ Brands: 'BrandA', 'Proxy Used': 'SmartProxy', Country: 'Germany', 'TP Review Status': 'Removed' });
    const others = ['B', 'C', 'D', 'E', 'F', 'G'].map((letter) =>
      makeEntry({ Brands: `Brand${letter}`, 'Proxy Used': 'SmartProxy', Country: 'Germany', 'TP Review Status': 'Live' }),
    );

    const evidence = computeRemovalEvidence([current, ...others], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.crossEntry.exampleBrands).toHaveLength(5);
  });
});

describe('computeRemovalEvidence — brand history', () => {
  it('classifies this brand\'s other entries on this platform into live/removed and computes a matching success rate', () => {
    const current = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Removed' });
    const live1 = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Published' });
    const live2 = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Live' });
    const removed1 = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Refused' });
    const otherBrand = makeEntry({ Brands: 'BrandZ', 'TP Review Status': 'Removed' });
    const noStatus = makeEntry({ Brands: 'BrandA', 'TP Review Status': '' });

    const evidence = computeRemovalEvidence(
      [current, live1, live2, removed1, otherBrand, noStatus],
      current,
      'tp',
      'BrandA',
      'Rooster Partners',
    );

    expect(evidence.brandHistory.totalReviews).toBe(3);
    expect(evidence.brandHistory.liveCount).toBe(2);
    expect(evidence.brandHistory.removedCount).toBe(1);
    expect(evidence.brandHistory.successRatePct).toBe(66);
  });

  it('matches brand names case/whitespace-insensitively', () => {
    const current = makeEntry({ Brands: '  BrandA  ', 'TP Review Status': 'Removed' });
    const other = makeEntry({ Brands: 'branda', 'TP Review Status': 'Live' });

    const evidence = computeRemovalEvidence([current, other], current, 'tp', '  BrandA  ', 'Rooster Partners');

    expect(evidence.brandHistory.totalReviews).toBe(1);
    expect(evidence.brandHistory.liveCount).toBe(1);
  });

  it('reports null successRatePct when this brand has no other decided reviews on this platform', () => {
    const current = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Removed' });

    const evidence = computeRemovalEvidence([current], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.brandHistory.totalReviews).toBe(0);
    expect(evidence.brandHistory.successRatePct).toBeNull();
  });
});

describe('computeRemovalEvidence — cross-platform corroboration', () => {
  it('reports not applicable for a single-platform tab', () => {
    const current = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Removed' }, 'TP Brand Injection');

    const evidence = computeRemovalEvidence([current], current, 'tp', 'BrandA', 'TP Brand Injection');

    expect(evidence.crossPlatform).toEqual({ applicable: false });
  });

  it('reads the same entry row\'s other platform statuses for a multi-platform tab', () => {
    const current = makeEntry(
      { Brands: 'BrandA', 'TP Review Status': 'Removed', 'AG Review Status': 'Live', 'CG Review Status': 'Pending' },
      'Rooster Partners',
    );

    const evidence = computeRemovalEvidence([current], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.crossPlatform).toEqual({
      applicable: true,
      other: { ag: { status: 'Live' }, cg: { status: 'Pending' } },
    });
  });
});

describe('computeRemovalEvidence — hard signals', () => {
  it('flags duplicateReviewTextFound when another entry has byte-identical (normalized) review text', () => {
    const current = makeEntry({ Brands: 'BrandA', 'TP Review Text': 'Great platform, super fast!' });
    const duplicate = makeEntry({ Brands: 'BrandB', 'TP Review Text': '  Great platform, super fast!  ' });

    const evidence = computeRemovalEvidence([current, duplicate], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.hardSignals.duplicateReviewTextFound).toBe(true);
  });

  it('does not flag duplicateReviewTextFound for merely similar text', () => {
    const current = makeEntry({ Brands: 'BrandA', 'TP Review Text': 'Great platform, super fast!' });
    const similar = makeEntry({ Brands: 'BrandB', 'TP Review Text': 'Great platform, super fast experience!' });

    const evidence = computeRemovalEvidence([current, similar], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.hardSignals.duplicateReviewTextFound).toBe(false);
  });

  it('sets proxyTiedToOtherRemoval true exactly when sameProxyRemovedCount > 0', () => {
    const current = makeEntry({ Brands: 'BrandA', 'Proxy Used': 'SmartProxy', 'TP Review Status': 'Removed' });
    const otherRemoved = makeEntry({ Brands: 'BrandB', 'Proxy Used': 'SmartProxy', 'TP Review Status': 'Removed' });

    const evidence = computeRemovalEvidence([current, otherRemoved], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.hardSignals.proxyTiedToOtherRemoval).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- reviewRemovalEvidence`
Expected: FAIL — `Cannot find module './reviewRemovalEvidence'` (the module doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/reviewRemovalEvidence.ts`:

```ts
import type { Entry } from '../types/entry';
import type { Platform } from './scoreSummary';
import {
  PLATFORM_STATUS_KEYS,
  pick,
  getReviewText,
  isLiveStatus,
  isRemovedStatus,
  rateFromCounts,
  successRatePct,
} from './scoreSummary';
import { canonicalProxyKey, resolveProxyLabel, NO_PROXY_LABEL } from './proxyAliases';
import { normalizeBrandKey } from './removedPlatformBrands';
import { BRAND_COLS, getTabPlatforms } from './tab-configs';

export interface RemovalEvidenceCrossEntry {
  sameProxyCount: number;
  sameProxyRemovedCount: number;
  sameProxySameCountryCount: number;
  exampleBrands: string[];
}

export interface RemovalEvidenceBrandHistory {
  totalReviews: number;
  liveCount: number;
  removedCount: number;
  successRatePct: number | null;
}

export type RemovalEvidenceCrossPlatform =
  | { applicable: false }
  | { applicable: true; other: Partial<Record<Platform, { status: string | null }>> };

export interface RemovalEvidenceHardSignals {
  duplicateReviewTextFound: boolean;
  proxyTiedToOtherRemoval: boolean;
}

export interface RemovalEvidence {
  crossEntry: RemovalEvidenceCrossEntry;
  brandHistory: RemovalEvidenceBrandHistory;
  crossPlatform: RemovalEvidenceCrossPlatform;
  hardSignals: RemovalEvidenceHardSignals;
}

function normalizeReviewText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeRemovalEvidence(
  tabEntries: Entry[],
  currentEntry: Entry,
  platform: Platform,
  brand: string,
  tab: string,
): RemovalEvidence {
  const others = tabEntries.filter((e) => e.id !== currentEntry.id);
  const tabPlatforms = getTabPlatforms(tab);

  // Cross-entry proxy/country pattern.
  const currentProxyRaw = currentEntry.data['Proxy Used'] ?? '';
  const currentProxyLabel = resolveProxyLabel(currentProxyRaw);
  const currentProxyKey = canonicalProxyKey(currentProxyRaw);
  const currentCountry = (currentEntry.data.Country ?? '').trim().toLowerCase();

  let sameProxyCount = 0;
  let sameProxyRemovedCount = 0;
  let sameProxySameCountryCount = 0;
  const exampleBrandsSet = new Set<string>();

  if (currentProxyLabel !== NO_PROXY_LABEL) {
    for (const other of others) {
      const otherProxyRaw = other.data['Proxy Used'] ?? '';
      if (resolveProxyLabel(otherProxyRaw) === NO_PROXY_LABEL) continue;
      if (canonicalProxyKey(otherProxyRaw) !== currentProxyKey) continue;

      sameProxyCount++;
      const otherBrand = (pick(other.data, BRAND_COLS) ?? '').trim();
      if (otherBrand) exampleBrandsSet.add(otherBrand);

      const otherRemoved = tabPlatforms.some((p) => {
        const status = pick(other.data, PLATFORM_STATUS_KEYS[p]);
        return status != null && isRemovedStatus(status.toLowerCase());
      });
      if (otherRemoved) sameProxyRemovedCount++;

      const otherCountry = (other.data.Country ?? '').trim().toLowerCase();
      if (otherCountry && otherCountry === currentCountry) sameProxySameCountryCount++;
    }
  }

  // Brand history on this platform, this tab.
  const brandKey = normalizeBrandKey(brand);
  let totalReviews = 0;
  let liveCount = 0;
  let removedCount = 0;
  for (const other of others) {
    const otherBrand = (pick(other.data, BRAND_COLS) ?? '').trim();
    if (!otherBrand || normalizeBrandKey(otherBrand) !== brandKey) continue;
    const status = pick(other.data, PLATFORM_STATUS_KEYS[platform]);
    if (status == null) continue;
    const lower = status.toLowerCase();
    if (isLiveStatus(lower)) {
      liveCount++;
      totalReviews++;
    } else if (isRemovedStatus(lower)) {
      removedCount++;
      totalReviews++;
    }
  }

  // Cross-platform corroboration: same entry row, other platforms this tab tracks.
  let crossPlatform: RemovalEvidenceCrossPlatform;
  if (tabPlatforms.length <= 1) {
    crossPlatform = { applicable: false };
  } else {
    const other: Partial<Record<Platform, { status: string | null }>> = {};
    for (const p of tabPlatforms) {
      if (p === platform) continue;
      other[p] = { status: pick(currentEntry.data, PLATFORM_STATUS_KEYS[p]) };
    }
    crossPlatform = { applicable: true, other };
  }

  // Hard signals.
  const currentReviewText = getReviewText(currentEntry.data, platform) ?? '';
  const normalizedCurrent = normalizeReviewText(currentReviewText);
  let duplicateReviewTextFound = false;
  if (normalizedCurrent) {
    outer: for (const other of others) {
      for (const p of tabPlatforms) {
        const otherText = getReviewText(other.data, p);
        if (otherText && normalizeReviewText(otherText) === normalizedCurrent) {
          duplicateReviewTextFound = true;
          break outer;
        }
      }
    }
  }

  return {
    crossEntry: {
      sameProxyCount,
      sameProxyRemovedCount,
      sameProxySameCountryCount,
      exampleBrands: Array.from(exampleBrandsSet).slice(0, 5),
    },
    brandHistory: {
      totalReviews,
      liveCount,
      removedCount,
      successRatePct: successRatePct(rateFromCounts(liveCount, removedCount)),
    },
    crossPlatform,
    hardSignals: {
      duplicateReviewTextFound,
      proxyTiedToOtherRemoval: sameProxyRemovedCount > 0,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- reviewRemovalEvidence`
Expected: PASS (all cases above green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reviewRemovalEvidence.ts src/lib/reviewRemovalEvidence.test.ts
git commit -m "feat: add deterministic cross-entry evidence computation for review removal assessment"
```

---

### Task 2: Extend assessment schema, validator, and hash

**Files:**
- Modify: `src/lib/reviewRemovalAssessment.ts`
- Test: `src/lib/reviewRemovalAssessment.test.ts` (extend existing)

**Interfaces:**
- Consumes: `RemovalEvidence` type from Task 1 (`src/lib/reviewRemovalEvidence.ts`).
- Produces: revised `AssessmentInput` (now requires `evidence: RemovalEvidence`), revised `ReviewRemovalAssessmentResult` (drops `likely_reason`; adds `root_cause: RootCause`, `evidence_for_removal: string[]`, `evidence_against_removal: string[]`, `agent_recommendation: AgentRecommendation`), revised `isValidAssessmentResult`, revised `hashAssessmentInput` — consumed by Task 4 (component) and Task 3 (edge function, via the shared type contract only, since the function itself is Deno-side and does not import this file).

- [ ] **Step 1: Write the failing test**

In `src/lib/reviewRemovalAssessment.test.ts`, replace the top imports and `VALID_RESULT` fixture, and add new test cases. Apply this diff:

```ts
// Replace this import block:
import {
  collectBehavioralFields,
  hashAssessmentInput,
  isValidAssessmentResult,
  requestReviewRemovalAssessment,
  type ReviewRemovalAssessmentResult,
} from './reviewRemovalAssessment';

// With:
import {
  collectBehavioralFields,
  hashAssessmentInput,
  isValidAssessmentResult,
  requestReviewRemovalAssessment,
  type ReviewRemovalAssessmentResult,
} from './reviewRemovalAssessment';
import type { RemovalEvidence } from './reviewRemovalEvidence';

const VALID_EVIDENCE: RemovalEvidence = {
  crossEntry: { sameProxyCount: 0, sameProxyRemovedCount: 0, sameProxySameCountryCount: 0, exampleBrands: [] },
  brandHistory: { totalReviews: 0, liveCount: 0, removedCount: 0, successRatePct: null },
  crossPlatform: { applicable: false },
  hardSignals: { duplicateReviewTextFound: false, proxyTiedToOtherRemoval: false },
};
```

Replace the `VALID_RESULT` fixture's `likely_reason` line and add the new fields — full replacement fixture:

```ts
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
  root_cause: {
    label: 'No clear reason found.',
    confidence: 'medium',
    alternative_causes: [],
  },
  evidence_for_removal: ['Review text is specific and consistent with genuine use.'],
  evidence_against_removal: ['No behavioral red flags recorded.'],
  policy_category: '',
  why_it_may_have_been_removed: 'No evidence points to a specific cause.',
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

Every existing call to `hashAssessmentInput({ platform, reviewText, behavioralFields })` and `requestReviewRemovalAssessment({ platform, status, reviewText, behavioralFields })` in this file must add `evidence: VALID_EVIDENCE` to the object literal — this is required everywhere, since `AssessmentInput` now requires `evidence` and TypeScript will fail to compile any call site missing it. Search the whole file for both function names and add the field to every literal you find (roughly 15 call sites across the existing `hashAssessmentInput` and `requestReviewRemovalAssessment` describe blocks) — do not rely on a fixed count, rely on the compiler: after this edit, `npm test -- reviewRemovalAssessment` failing with a TypeScript error naming a specific line is the signal a call site was missed.

Add these new test cases (append to the `hashAssessmentInput` describe block):

```ts
  it('changes when the evidence bundle changes', async () => {
    const a = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: {}, evidence: VALID_EVIDENCE });
    const changedEvidence: RemovalEvidence = { ...VALID_EVIDENCE, crossEntry: { ...VALID_EVIDENCE.crossEntry, sameProxyCount: 3 } };
    const b = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: {}, evidence: changedEvidence });
    expect(a).not.toBe(b);
  });

  it('is unaffected by cross-platform "other" key order in the evidence bundle', async () => {
    const evidenceA: RemovalEvidence = {
      ...VALID_EVIDENCE,
      crossPlatform: { applicable: true, other: { ag: { status: 'Live' }, cg: { status: 'Removed' } } },
    };
    const evidenceB: RemovalEvidence = {
      ...VALID_EVIDENCE,
      crossPlatform: { applicable: true, other: { cg: { status: 'Removed' }, ag: { status: 'Live' } } },
    };
    const a = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: {}, evidence: evidenceA });
    const b = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: {}, evidence: evidenceB });
    expect(a).toBe(b);
  });
```

Add these new test cases (append to the `isValidAssessmentResult` describe block):

```ts
  it('rejects a missing root_cause', () => {
    const { root_cause, ...rest } = VALID_RESULT;
    expect(isValidAssessmentResult(rest)).toBe(false);
  });

  it('rejects a root_cause with an invalid confidence value', () => {
    expect(isValidAssessmentResult({
      ...VALID_RESULT,
      root_cause: { ...VALID_RESULT.root_cause, confidence: 'certain' },
    })).toBe(false);
  });

  it('rejects a root_cause with a malformed alternative_causes entry', () => {
    expect(isValidAssessmentResult({
      ...VALID_RESULT,
      root_cause: { ...VALID_RESULT.root_cause, alternative_causes: [{ label: 'x', likelihood: 'extreme' }] },
    })).toBe(false);
  });

  it('rejects a non-array evidence_for_removal', () => {
    expect(isValidAssessmentResult({ ...VALID_RESULT, evidence_for_removal: 'none' })).toBe(false);
  });

  it('rejects a non-array evidence_against_removal', () => {
    expect(isValidAssessmentResult({ ...VALID_RESULT, evidence_against_removal: 'none' })).toBe(false);
  });

  it('rejects a missing agent_recommendation', () => {
    const { agent_recommendation, ...rest } = VALID_RESULT;
    expect(isValidAssessmentResult(rest)).toBe(false);
  });

  it('rejects an agent_recommendation with a non-array specific_actions', () => {
    expect(isValidAssessmentResult({
      ...VALID_RESULT,
      agent_recommendation: { ...VALID_RESULT.agent_recommendation, specific_actions: 'do better' },
    })).toBe(false);
  });

  it('rejects the old pre-overhaul shape (likely_reason present, root_cause/agent_recommendation absent)', () => {
    const { root_cause, evidence_for_removal, evidence_against_removal, agent_recommendation, ...legacyRest } = VALID_RESULT;
    const legacyShape = { ...legacyRest, likely_reason: 'No clear reason found.' };
    expect(isValidAssessmentResult(legacyShape)).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- reviewRemovalAssessment`
Expected: FAIL — type errors on `AssessmentInput` missing `evidence`, and `ReviewRemovalAssessmentResult` missing `root_cause`/`evidence_for_removal`/`evidence_against_removal`/`agent_recommendation` (source file not yet updated).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/reviewRemovalAssessment.ts`:

Add the import:
```ts
import type { RemovalEvidence } from './reviewRemovalEvidence';
```

Replace the `AssessmentInput` interface:
```ts
export interface AssessmentInput {
  platform: Platform;
  reviewText: string;
  behavioralFields: Record<string, string | null>;
  evidence: RemovalEvidence;
}
```

Replace the `ReviewRemovalAssessmentResult` interface and add the two new nested types above it:
```ts
export interface RootCauseCandidate {
  label: string;
  likelihood: Severity;
}

export interface RootCause {
  label: string;
  confidence: Confidence;
  alternative_causes: RootCauseCandidate[];
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
  root_cause: RootCause;
  evidence_for_removal: string[];
  evidence_against_removal: string[];
  policy_category: string;
  why_it_may_have_been_removed: string;
  evidence_summary: string;
  alternative_explanation: string;
  recommendation: string;
  agent_recommendation: AgentRecommendation;
  assessment_note: string;
}
```

Replace `hashAssessmentInput` and add the canonicalization helpers above it:
```ts
function canonicalCrossPlatform(cp: RemovalEvidence['crossPlatform']): unknown {
  if (!cp.applicable) return { applicable: false };
  const other: Record<string, { status: string | null }> = {};
  for (const key of Object.keys(cp.other).sort()) {
    other[key] = cp.other[key as keyof typeof cp.other]!;
  }
  return { applicable: true, other };
}

function canonicalEvidence(evidence: RemovalEvidence): unknown {
  return {
    crossEntry: {
      sameProxyCount: evidence.crossEntry.sameProxyCount,
      sameProxyRemovedCount: evidence.crossEntry.sameProxyRemovedCount,
      sameProxySameCountryCount: evidence.crossEntry.sameProxySameCountryCount,
      exampleBrands: [...evidence.crossEntry.exampleBrands].sort(),
    },
    brandHistory: { ...evidence.brandHistory },
    crossPlatform: canonicalCrossPlatform(evidence.crossPlatform),
    hardSignals: { ...evidence.hardSignals },
  };
}

// Deliberately excludes `status` — a pure status change (e.g. Pending -> Removed)
// with no content/behavioral/evidence change should still surface the last cached
// assessment rather than discarding it. See design spec's "Staleness" section.
export async function hashAssessmentInput(input: AssessmentInput): Promise<string> {
  const sortedFields = Object.keys(input.behavioralFields).sort().reduce<Record<string, string | null>>((acc, k) => {
    acc[k] = input.behavioralFields[k];
    return acc;
  }, {});
  const canonical = JSON.stringify({
    platform: input.platform,
    reviewText: input.reviewText,
    behavioralFields: sortedFields,
    evidence: canonicalEvidence(input.evidence),
  });
  return sha256Hex(canonical);
}
```

Replace `REQUIRED_STRING_FIELDS` and add the new validators, then replace `isValidAssessmentResult`:
```ts
const REQUIRED_STRING_FIELDS = [
  'policy_category', 'why_it_may_have_been_removed',
  'evidence_summary', 'alternative_explanation', 'recommendation', 'assessment_note',
] as const;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isValidRootCauseCandidate(c: unknown): c is RootCauseCandidate {
  if (!c || typeof c !== 'object') return false;
  const cand = c as Record<string, unknown>;
  return typeof cand.label === 'string' && SEVERITIES.has(cand.likelihood as string);
}

function isValidRootCause(rc: unknown): rc is RootCause {
  if (!rc || typeof rc !== 'object') return false;
  const r = rc as Record<string, unknown>;
  return typeof r.label === 'string'
    && CONFIDENCES.has(r.confidence as string)
    && Array.isArray(r.alternative_causes)
    && r.alternative_causes.every(isValidRootCauseCandidate);
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
  if (!isValidRootCause(d.root_cause)) return false;
  if (!isStringArray(d.evidence_for_removal)) return false;
  if (!isStringArray(d.evidence_against_removal)) return false;
  if (!isValidAgentRecommendation(d.agent_recommendation)) return false;
  return REQUIRED_STRING_FIELDS.every((k) => typeof d[k] === 'string');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- reviewRemovalAssessment`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reviewRemovalAssessment.ts src/lib/reviewRemovalAssessment.test.ts
git commit -m "feat: replace likely_reason with root_cause, evidence for/against, and agent_recommendation"
```

---

### Task 3: Edge function — richer prompt, evidence input, deterministic output

**Files:**
- Modify: `supabase/functions/review-removal-assessment/index.ts`

**Interfaces:**
- Consumes: `evidence` field on the request body (matches the `RemovalEvidence` shape from Task 1 — the Deno function does not import the frontend module, it just formats whatever `evidence` object arrives, matching this project's existing "thin proxy" precedent).
- Produces: response `analysis` object matching the schema from Task 2 (`root_cause`, `evidence_for_removal`, `evidence_against_removal`, `agent_recommendation` in place of `likely_reason`).

- [ ] **Step 1: Update the output schema constant**

In `supabase/functions/review-removal-assessment/index.ts`, replace the `OUTPUT_SCHEMA` constant:

```ts
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
  "root_cause": {
    "label": "<one concrete, specific sentence naming the single most likely trigger — never a vague category alone>",
    "confidence": "low | medium | high",
    "alternative_causes": [{ "label": "<specific alternative>", "likelihood": "low | medium | high" }]
  },
  "evidence_for_removal": ["<concrete point>"],
  "evidence_against_removal": ["<concrete point>"],
  "policy_category": "<one category from the list provided above, or the WO caveat text, or empty string if none applies>",
  "why_it_may_have_been_removed": "<1-3 sentences>",
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

- [ ] **Step 2: Extend AI_RULES with the new reliability/evidence rules**

Append these lines to the `AI_RULES` template string (inside the backticks, after the existing last rule "Always state an overall confidence level (low/medium/high)."):

```ts
- You MUST populate both "evidence_for_removal" and "evidence_against_removal" — a
  real assessment always has something on both sides, even if one side is thin
  (e.g. "no positive evidence beyond the review's polite tone").
- "root_cause.label" must name a specific, concrete trigger, not a bare category —
  "possible coordinated review activity" alone is not acceptable; name what
  specifically suggests it (e.g. "posted 4 minutes after a welcome-email redirect,
  from a proxy already tied to 2 other removed reviews for different brands").
- The request body's "evidence" object contains deterministic, code-computed facts
  (cross-entry proxy/country matches, this brand's historical outcomes on this
  platform, this entry's status on other platforms if applicable, and hard
  signals). Treat every value in "evidence" as ground truth — never contradict,
  adjust, or re-derive these numbers; reason from them, don't reinterpret them.
- If evidence.hardSignals.duplicateReviewTextFound or
  evidence.hardSignals.proxyTiedToOtherRemoval is true, that signal MUST appear as
  your top-ranked "root_cause" candidate unless you explicitly explain in
  "evidence_against_removal" why it does not apply to this specific case.
- "agent_recommendation.specific_actions" must be concrete and behavioral (things a
  human agent can change about how or when they act) — never a restatement of
  platform policy.
```

- [ ] **Step 3: Pass the evidence object through and tighten the OpenAI call**

Replace the request-body parsing block (currently reading `platform`/`status`/`reviewText`/`behavioralFields`) to also read `evidence`:

```ts
  const platform = body?.platform;
  const status = typeof body?.status === 'string' ? body.status : '';
  const reviewText = typeof body?.reviewText === 'string' ? body.reviewText : '';
  const behavioralFields = body?.behavioralFields && typeof body.behavioralFields === 'object' ? body.behavioralFields : {};
  const evidence = body?.evidence && typeof body.evidence === 'object' ? body.evidence : {};
```

Replace the `userPayload` construction:
```ts
  const userPayload = JSON.stringify({ reviewText, behavioralFields, evidence }, null, 2);
```

Replace the `fetch` call's body to add `temperature: 0` and raise `max_tokens` (the schema grew by 4 fields):
```ts
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: 'json_object' },
        temperature: 0,
        messages: [
          { role: 'system', content: buildSystemPrompt(platform, status) },
          { role: 'user', content: `Review and behavioral data:\n${userPayload}` },
        ],
        max_tokens: 2400,
      }),
```

- [ ] **Step 4: Verify the file type-checks**

Run: `deno check supabase/functions/review-removal-assessment/index.ts` if Deno is installed locally; otherwise read through the full modified file once to confirm every brace/quote is balanced and no reference to the removed concept `likely_reason` remains anywhere in the file.
Expected: clean (no output) or a manual read confirming no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/review-removal-assessment/index.ts
git commit -m "feat: feed deterministic evidence into review removal prompt, require root cause + evidence for/against"
```

---

### Task 4: Component — render evidence, root cause, and agent recommendation

**Files:**
- Modify: `src/components/ReviewRemovalAssessment.tsx`

**Interfaces:**
- Consumes: `computeRemovalEvidence` (Task 1), the revised `AssessmentInput`/`ReviewRemovalAssessmentResult`/validators (Task 2), `PLATFORM_SHORT_LABEL` (`src/lib/scoreSummary.ts`).
- Produces: two new props on the component (`tabEntries: Entry[]`, `brand: string`) — consumed by Task 5's wiring in `EditEntryModal.tsx`.

- [ ] **Step 1: Add the new props and evidence computation**

In `src/components/ReviewRemovalAssessment.tsx`, update the imports:
```ts
import { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, ChevronDown } from 'lucide-react';
import type { Entry } from '../types/entry';
import {
  ASSESSMENT_FAILURE_MESSAGE,
  collectBehavioralFields,
  hashAssessmentInput,
  isValidAssessmentResult,
  requestReviewRemovalAssessment,
  type ReviewRemovalAssessmentResult,
  type AssessmentSignal,
} from '../lib/reviewRemovalAssessment';
import { computeRemovalEvidence } from '../lib/reviewRemovalEvidence';
import { saveReviewAnalysis } from '../lib/queries';
import { PLATFORM_SHORT_LABEL, type Platform } from '../lib/scoreSummary';
import Tooltip from './Tooltip';
```

Update the `Props` interface:
```ts
interface Props {
  entry: Entry;
  tab: string;
  platform: Platform;
  status: string;
  reviewText: string;
  headers: string[];
  fields: Record<string, string>;
  tabEntries: Entry[];
  brand: string;
  disabled?: boolean;
}
```

Update the component signature and add the evidence memo (place directly after the existing `behavioralFields` memo):
```ts
export default function ReviewRemovalAssessment({ entry, tab, platform, status, reviewText, headers, fields, tabEntries, brand, disabled }: Props) {
  // ... existing state declarations unchanged ...

  const behavioralFields = useMemo(() => collectBehavioralFields(headers, fields), [headers, fields]);
  const evidence = useMemo(
    () => computeRemovalEvidence(tabEntries, entry, platform, brand, tab),
    [tabEntries, entry, platform, brand, tab],
  );
```

Update the hash effect and `handleAnalyze` to include `evidence`:
```ts
  useEffect(() => {
    let cancelled = false;
    hashAssessmentInput({ platform, reviewText, behavioralFields, evidence }).then((h) => {
      if (!cancelled) setCurrentHash(h);
    });
    return () => {
      cancelled = true;
    };
  }, [platform, reviewText, behavioralFields, evidence]);
```

```ts
  async function handleAnalyze() {
    if (!reviewText.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { analysis, model } = await requestReviewRemovalAssessment({ platform, status, reviewText, behavioralFields, evidence });
      const hash = currentHash ?? (await hashAssessmentInput({ platform, reviewText, behavioralFields, evidence }));
      await saveReviewAnalysis(entry.id, tab, analysis, hash, model);
      setResult(analysis);
      setSavedHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : ASSESSMENT_FAILURE_MESSAGE);
    } finally {
      setLoading(false);
    }
  }
```

- [ ] **Step 2: Add an evidence summary line helper**

Add this function above the component (near `riskBucket`):
```ts
function evidenceSummaryLine(evidence: ReturnType<typeof computeRemovalEvidence>): string | null {
  const parts: string[] = [];
  const { crossEntry, brandHistory, crossPlatform } = evidence;

  if (crossEntry.sameProxyCount > 0) {
    const removedNote = crossEntry.sameProxyRemovedCount > 0 ? ` (${crossEntry.sameProxyRemovedCount} removed)` : '';
    parts.push(`Same proxy: ${crossEntry.sameProxyCount} other entr${crossEntry.sameProxyCount === 1 ? 'y' : 'ies'}${removedNote}`);
  }
  if (brandHistory.totalReviews > 0) {
    const pctNote = brandHistory.successRatePct != null ? ` (${brandHistory.successRatePct}%)` : '';
    parts.push(`Brand history: ${brandHistory.liveCount}/${brandHistory.totalReviews} live${pctNote}`);
  }
  if (crossPlatform.applicable) {
    const otherParts = Object.entries(crossPlatform.other)
      .filter(([, v]) => v && v.status)
      .map(([p, v]) => `${PLATFORM_SHORT_LABEL[p as keyof typeof PLATFORM_SHORT_LABEL]} ${v!.status}`);
    if (otherParts.length > 0) parts.push(`Other platforms: ${otherParts.join(', ')}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
```

- [ ] **Step 3: Render the Evidence row, Root Cause, and For Next Time block**

Replace the compact summary block (the `<div className="mt-3 space-y-2">...` section) — insert a new Evidence row right after the `isStale` banner, replace the old "Likely Reason" line with Root Cause, and add a "For Next Time" block before the expand toggle:

```tsx
      {result && (
        <div className="mt-3 space-y-2">
          {isStale && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
              Outdated — review data changed since this assessment was generated.
            </div>
          )}

          {evidenceSummaryLine(evidence) && (
            <div className="rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
              {evidenceSummaryLine(evidence)}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
            <span>Risk: {riskBucket(result.risk_score).emoji} {riskBucket(result.risk_score).label}</span>
            <span>Assessment: {OVERALL_META[result.overall_result].emoji} {OVERALL_META[result.overall_result].label}</span>
            <span>Confidence: {result.confidence.charAt(0).toUpperCase() + result.confidence.slice(1)}</span>
          </div>

          <div className="text-xs text-slate-600">
            <div><span className="font-medium text-slate-700">Root Cause:</span> {result.root_cause.label || '—'} <span className="text-slate-400">({result.root_cause.confidence} confidence)</span></div>
          </div>

          {(result.content_assessment.signals.length > 0 || result.behavioral_assessment.signals.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {[...result.content_assessment.signals, ...result.behavioral_assessment.signals]
                .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
                .slice(0, 6)
                .map((s, i) => <SignalBadge key={`${s.name}-${i}`} signal={s} />)}
            </div>
          )}

          {result.agent_recommendation.summary && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-800">
              <span className="font-medium">For Next Time:</span> {result.agent_recommendation.summary}
              {result.agent_recommendation.specific_actions.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {result.agent_recommendation.specific_actions.map((action, i) => <li key={i}>{action}</li>)}
                </ul>
              )}
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
              {result.root_cause.alternative_causes.length > 0 && (
                <div>
                  <span className="font-medium text-slate-700">Alternative Causes:</span>
                  <ul className="mt-0.5 list-disc pl-4">
                    {result.root_cause.alternative_causes.map((c, i) => <li key={i}>{c.label} <span className="text-slate-400">({c.likelihood})</span></li>)}
                  </ul>
                </div>
              )}
              {result.evidence_for_removal.length > 0 && (
                <div>
                  <span className="font-medium text-slate-700">Evidence For Removal:</span>
                  <ul className="mt-0.5 list-disc pl-4">
                    {result.evidence_for_removal.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              {result.evidence_against_removal.length > 0 && (
                <div>
                  <span className="font-medium text-slate-700">Evidence Against Removal:</span>
                  <ul className="mt-0.5 list-disc pl-4">
                    {result.evidence_against_removal.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              <div><span className="font-medium text-slate-700">Policy Category:</span> {result.policy_category || '—'}</div>
              <div><span className="font-medium text-slate-700">Evidence:</span> {result.evidence_summary || '—'}</div>
              <div><span className="font-medium text-slate-700">Alternative Explanation:</span> {result.alternative_explanation || '—'}</div>
              <div><span className="font-medium text-slate-700">Recommendation:</span> {result.recommendation || '—'}</div>
              <div className="pt-1 text-[11px] italic text-slate-400">{result.assessment_note}</div>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Verify the build type-checks**

Run: `npm run build`
Expected: PASS — no TypeScript errors (in particular, confirm every reference to `result.likely_reason` has been removed — the old field no longer exists on the type).

- [ ] **Step 5: Commit**

```bash
git add src/components/ReviewRemovalAssessment.tsx
git commit -m "feat: render cross-entry evidence, root cause, and agent recommendation in review removal assessment UI"
```

---

### Task 5: Thread tab entries and brand into the component

**Files:**
- Modify: `src/components/EditEntryModal.tsx`
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `ReviewRemovalAssessment`'s new `tabEntries`/`brand` props (Task 4).
- Produces: `EditEntryModal`'s new `tabEntries?: Entry[]` prop, populated by `BrandGroup.tsx` from its existing `entries` state — no new fetch.

- [ ] **Step 1: Add `tabEntries` to `EditEntryModal`'s props and compute `brand`**

In `src/components/EditEntryModal.tsx`, update the `Props` interface (add one field after `brandProfiles`):
```ts
interface Props {
  entry: Entry;
  headers: string[];
  onClose: () => void;
  onSave: (
    fields: Record<string, string | null>,
    newTab?: string,
    removedPlatforms?: Platform[],
    overrides?: Partial<Record<Platform, 'pause' | 'active'>>,
  ) => Promise<void>;
  currentTab?: string;
  availableBrands?: string[];
  brandCol?: string | null;
  brandProfiles?: Record<string, Record<string, string>>;
  tabEntries?: Entry[];
  initialRemovedPlatforms?: Platform[];
  initialRemovedPlatformDates?: Partial<Record<Platform, string>>;
  initialOverrides?: Partial<Record<Platform, 'pause' | 'active'>>;
}
```

Update the component signature to accept it, and compute `brand` right after the `fields` state declaration:
```ts
export default function EditEntryModal({ entry, headers, onClose, onSave, currentTab, availableBrands, brandCol, brandProfiles, tabEntries, initialRemovedPlatforms, initialRemovedPlatformDates, initialOverrides }: Props) {
```

```ts
  const brand = brandCol ? (fields[brandCol] || entry.data[brandCol] || '') : '';
```

(Place this line directly after the `fields` state's closing `});` — `fields` must already be defined before `brand` reads from it.)

- [ ] **Step 2: Pass `tabEntries` and `brand` to all 3 `ReviewRemovalAssessment` call sites**

In the same file, update each of the 3 `<ReviewRemovalAssessment ... />` elements (TP/WO, AG, CG sections) to add two props. For example, the TP/WO call site becomes:
```tsx
                    <ReviewRemovalAssessment
                      entry={entry}
                      tab={entry.tab}
                      platform={activePlatform}
                      status={pick(fields, PLATFORM_STATUS_KEYS[activePlatform]) ?? ''}
                      reviewText={fields[reviewTextKey] ?? ''}
                      headers={headers}
                      fields={fields}
                      tabEntries={tabEntries ?? []}
                      brand={brand}
                      disabled={saving}
                    />
```
Apply the same two added lines (`tabEntries={tabEntries ?? []}` and `brand={brand}`) to the AG and CG call sites.

- [ ] **Step 3: Pass `entries` from `BrandGroup.tsx` into `EditEntryModal`**

In `src/pages/BrandGroup.tsx`, add one prop to the existing `<EditEntryModal ... />` invocation (near `brandProfiles={brandProfiles}` around line 2812):
```tsx
          brandProfiles={brandProfiles}
          tabEntries={entries}
```

- [ ] **Step 4: Verify the build type-checks**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditEntryModal.tsx src/pages/BrandGroup.tsx
git commit -m "feat: pass tab entries and brand into review removal assessment for cross-entry evidence"
```

---

### Task 6: Final integration check

**Files:** none (verification only).

**Interfaces:** none — this task verifies Tasks 1-5 together, not new code.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new `reviewRemovalEvidence.test.ts` cases and the extended `reviewRemovalAssessment.test.ts` cases are green, with no unrelated regressions.

- [ ] **Step 2: Run the full build**

Run: `npm run build`
Expected: PASS — `tsc -b` reports no type errors, `vite build` completes.

- [ ] **Step 3: Verify field-name consistency across the 3 files that share the output contract**

Run (adjust the path separators for your shell):
```bash
grep -n "root_cause\|evidence_for_removal\|evidence_against_removal\|agent_recommendation" supabase/functions/review-removal-assessment/index.ts src/lib/reviewRemovalAssessment.ts src/components/ReviewRemovalAssessment.tsx
```
Expected: all 4 field names appear in all 3 files (the edge function's schema string, the validator/types, and the component's render code) — a name present in only 2 of the 3 indicates a drift bug introduced during Tasks 2-4 and must be fixed before proceeding. Also confirm `likely_reason` produces zero matches across all three files:
```bash
grep -rn "likely_reason" supabase/functions/review-removal-assessment/index.ts src/lib/reviewRemovalAssessment.ts src/components/ReviewRemovalAssessment.tsx
```
Expected: no output.

- [ ] **Step 4: Manual note for the human operator (not automatable in this session)**

This step has no command to run — record it as a follow-up, matching this project's existing pattern for AI-assessment features pending deployment:
- Deploy: `supabase functions deploy review-removal-assessment` (ships the revised prompt/schema — no new migration, no new secret).
- Once deployed, re-run the assessment against a real entry that has a known cross-entry proxy match or brand history (e.g. a Rooster Partners brand with multiple TP entries) and confirm: the Evidence row shows correct raw numbers, a known hard signal surfaces as the top root-cause candidate, and re-running the same entry twice yields the same root cause (temperature-0 consistency check).

- [ ] **Step 5: Commit (only if Step 3 required fixes)**

If Step 3 found and fixed a drift, commit that fix:
```bash
git add -A
git commit -m "fix: resolve field-name drift found in final integration check"
```
If no fixes were needed, skip this step — there is nothing to commit.
