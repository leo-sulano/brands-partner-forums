# Platform Score Star Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a platform-colored star next to the "View" link on TP, AG, and CG review-link columns whenever that row has a valid score recorded.

**Architecture:** All changes live in `src/pages/BrandGroup.tsx`. `CellValue()` (the function that renders every table cell, including the "View" link pill) gains a `tab` prop and a small pure helper that maps a link column header + tab to a platform (`tp`/`ag`/`cg`). When a platform is resolved, it looks up the row's score using the existing `PLATFORM_SCORE_COLS` / `parseScore` / `PLATFORM_MAX_SCORE` (already imported, already used for the Score Summary rating filter at line ~1218) and, if valid, renders a filled `lucide-react` `Star` in that platform's color.

**Tech Stack:** React 19, TypeScript, Tailwind v4, lucide-react.

## Global Constraints

- Confined to `src/pages/BrandGroup.tsx` — no schema, query, or type changes (per spec's Scope/Implementation notes).
- Wizard of Odds is explicitly excluded — `Link to the profile` on that tab must NOT get a star (per spec Scope).
- No regression to the existing AG/CG "no review → em dash" short-circuit in `CellValue` (per spec Behavior item 5).
- This codebase has no component/page-level test infrastructure (`vitest.config` runs in `environment: 'node'`; the only existing tests are pure-logic tests for `src/lib/*.ts` — see `scoreSummary.test.ts`, `tab-configs.test.ts`). Per `CLAUDE.md`, UI changes are verified by running the dev server and exercising the feature in a browser, not by writing new component-test infra for this one page. Verification steps below reflect that: `npm run build` for type-checking (per project convention — `tsc --noEmit` alone is insufficient here since the root tsconfig is references-only) plus a manual dev-server check.

---

### Task 1: Add platform-colored score star to TP/AG/CG "View" link cells

**Files:**
- Modify: `src/pages/BrandGroup.tsx:3-7` (lucide-react import)
- Modify: `src/pages/BrandGroup.tsx:115-118` (add helper + color map near `LINK_STATUS_COL`)
- Modify: `src/pages/BrandGroup.tsx:120` (`CellValue` signature + link-column branch, currently lines 120-161)
- Modify: `src/pages/BrandGroup.tsx:2080, 2108, 2117, 2204, 2211-2219` (5 call sites — pass `tab={decodedTab}`)

**Interfaces:**
- Produces: `linkColPlatform(header: string, tab: string): 'tp' | 'ag' | 'cg' | null` — pure, no other task depends on it, but keep the name exact since it's referenced by the manual verification steps below.
- Consumes (already present in file, no new imports needed for these): `PLATFORM_SCORE_COLS` (from `../lib/tab-configs`), `parseScore`, `PLATFORM_MAX_SCORE` (from `../lib/scoreSummary`).

- [ ] **Step 1: Add `Star` to the lucide-react import**

Current (`src/pages/BrandGroup.tsx:3-7`):
```tsx
import {
  CheckCircle2, XCircle, Circle, Building2, ExternalLink,
  ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown,
  Search, X, Check, CalendarDays, Plus, RefreshCw, Loader2,
} from 'lucide-react';
```

New:
```tsx
import {
  CheckCircle2, XCircle, Circle, Building2, ExternalLink,
  ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown,
  Search, X, Check, CalendarDays, Plus, RefreshCw, Loader2, Star,
} from 'lucide-react';
```

- [ ] **Step 2: Add the platform helper and color map next to `LINK_STATUS_COL`**

Current (`src/pages/BrandGroup.tsx:115-118`):
```tsx
const LINK_STATUS_COL: Record<string, string> = {
  'AG Review Link': 'AG Review Status',
  'CG Review Link': 'CG Review Status',
};
```

New:
```tsx
const LINK_STATUS_COL: Record<string, string> = {
  'AG Review Link': 'AG Review Status',
  'CG Review Link': 'CG Review Status',
};

// Colors match PLATFORM_OPTS' dot classes (line ~300) so the star reads as
// the same platform identity used in the filter chips.
const PLATFORM_STAR_COLOR: Record<'tp' | 'ag' | 'cg', string> = {
  tp: 'text-blue-500',
  ag: 'text-amber-500',
  cg: 'text-violet-500',
};

// 'Link to the profile' is TP's link header everywhere except Wizard of
// Odds, which reuses it for a different platform — excluded here since a
// score star for WO was not requested.
function linkColPlatform(header: string, tab: string): 'tp' | 'ag' | 'cg' | null {
  if (header === 'AG Review Link') return 'ag';
  if (header === 'CG Review Link') return 'cg';
  if (header === 'Link to the profile' && tab !== 'Wizard of Odds') return 'tp';
  return null;
}
```

- [ ] **Step 3: Give `CellValue` a `tab` prop and render the star**

Current (`src/pages/BrandGroup.tsx:120-150`):
```tsx
function CellValue({ header, value, rowData }: { header: string; value: string | null; rowData?: Record<string, string | null> }) {
  if (isDateCol(header) && (!value || value.trim() === '')) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-900">
        No Review
      </span>
    );
  }
  const display = value ? formatCellValue(value) : '—';
  if (isStatusCol(header)) return <StatusPill value={display} />;
  if (isLinkCol(header) && value) {
    const statusCol = LINK_STATUS_COL[header];
    if (statusCol && rowData) {
      const status = rowData[statusCol];
      if (!status || status.trim().toLowerCase() === 'no review') {
        return <span className="text-slate-600">—</span>;
      }
    }
    const href = value.startsWith('http') ? value : `https://${value}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors whitespace-nowrap"
      >
        <ExternalLink className="size-3" /> View
      </a>
    );
  }
```

New:
```tsx
function CellValue({ header, value, rowData, tab }: { header: string; value: string | null; rowData?: Record<string, string | null>; tab?: string }) {
  if (isDateCol(header) && (!value || value.trim() === '')) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-900">
        No Review
      </span>
    );
  }
  const display = value ? formatCellValue(value) : '—';
  if (isStatusCol(header)) return <StatusPill value={display} />;
  if (isLinkCol(header) && value) {
    const statusCol = LINK_STATUS_COL[header];
    if (statusCol && rowData) {
      const status = rowData[statusCol];
      if (!status || status.trim().toLowerCase() === 'no review') {
        return <span className="text-slate-600">—</span>;
      }
    }
    const href = value.startsWith('http') ? value : `https://${value}`;
    const platform = tab != null ? linkColPlatform(header, tab) : null;
    let scoreTitle: string | null = null;
    if (platform && rowData) {
      const maxScore = PLATFORM_MAX_SCORE[platform];
      const raw = PLATFORM_SCORE_COLS[platform].map((c) => rowData[c]).find((v) => v != null && v !== '');
      const score = parseScore(raw, maxScore);
      if (score != null) scoreTitle = `Score: ${score}/${maxScore}`;
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors whitespace-nowrap"
      >
        <ExternalLink className="size-3" /> View
        {scoreTitle && platform && (
          <span title={scoreTitle} className="inline-flex">
            <Star className={`size-3 fill-current ${PLATFORM_STAR_COLOR[platform]}`} />
          </span>
        )}
      </a>
    );
  }
```

- [ ] **Step 4: Pass `tab={decodedTab}` at all 5 `CellValue` call sites**

Call site A — current (`src/pages/BrandGroup.tsx:2080`):
```tsx
                            <CellValue header={h} value={entry.data[h] ?? null} rowData={entry.data} />
```
New:
```tsx
                            <CellValue header={h} value={entry.data[h] ?? null} rowData={entry.data} tab={decodedTab} />
```

Call site B — current (`src/pages/BrandGroup.tsx:2108`):
```tsx
                            <CellValue header={h} value={brandName} rowData={entry.data} />
```
New:
```tsx
                            <CellValue header={h} value={brandName} rowData={entry.data} tab={decodedTab} />
```

Call site C — current (`src/pages/BrandGroup.tsx:2117`):
```tsx
                            <CellValue header={h} value={entry.data[h] ?? null} rowData={entry.data} />
```
New:
```tsx
                            <CellValue header={h} value={entry.data[h] ?? null} rowData={entry.data} tab={decodedTab} />
```

Call site D — current (`src/pages/BrandGroup.tsx:2204`):
```tsx
                            <CellValue header={h} value={h === 'Country' ? (getEntryCountry(entry.data, decodedTab) || null) : (entry.data[h] ?? null)} rowData={entry.data} />
```
New:
```tsx
                            <CellValue header={h} value={h === 'Country' ? (getEntryCountry(entry.data, decodedTab) || null) : (entry.data[h] ?? null)} rowData={entry.data} tab={decodedTab} />
```

Call site E — current (`src/pages/BrandGroup.tsx:2211-2219`):
```tsx
                          <CellValue
                            header={h}
                            value={
                              h === 'Country'
                                ? (getEntryCountry(entry.data, decodedTab) || null)
                                : entry.data[h] ?? (h === brandCol ? (TAB_DEFAULT_BRAND[decodedTab] ?? null) : null)
                            }
                            rowData={entry.data}
                          />
```
New:
```tsx
                          <CellValue
                            header={h}
                            value={
                              h === 'Country'
                                ? (getEntryCountry(entry.data, decodedTab) || null)
                                : entry.data[h] ?? (h === brandCol ? (TAB_DEFAULT_BRAND[decodedTab] ?? null) : null)
                            }
                            rowData={entry.data}
                            tab={decodedTab}
                          />
```

- [ ] **Step 5: Type-check the whole project**

Run: `npm run build`
Expected: exits 0, no TypeScript errors (this project's root tsconfig is references-only, so `tsc --noEmit` alone would pass trivially even with real errors — always use `npm run build` here).

- [ ] **Step 6: Manually verify in the browser**

Run: `npm run dev`, open the app, navigate to a brand-group tab that has AG and CG columns and at least one Published row with a score recorded on each platform (e.g. `GRG - Gulf Recovery Group`, used elsewhere in this repo as the demo tab — see `npm run capture:demo`).

Check:
- A row with a valid AG score shows an amber star next to "View" in the AG Review Link column; hovering shows a tooltip like `Score: 7/10`.
- A row with a valid CG score shows a violet star next to "View" in the CG Review Link column; hovering shows `Score: 4/5`.
- A row with a valid TP score shows a blue star next to "View" in the TP link column (`Link to the profile`); hovering shows `Score: 4/5`.
- A row with no score recorded for a platform shows the "View" pill with no star, unchanged from current behavior.
- A row where AG/CG status is empty or "No review" still renders the em dash (`—`), not a broken star.
- Switch to the `Wizard of Odds` tab and confirm its `Link to the profile` column never shows a star.

- [ ] **Step 7: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "$(cat <<'EOF'
feat: show platform-colored score star next to TP/AG/CG View links

EOF
)"
```
