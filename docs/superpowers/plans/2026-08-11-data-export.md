# Data Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side CSV/Excel export button to Brand Tabs, Score Summary, and Schedule
Planner that exports exactly the currently filtered/visible data for that page, with no server
round-trip and no write to Supabase.

**Architecture:** One shared, dependency-free CSV builder plus a thin `xlsx` (SheetJS) wrapper for
`.xlsx`, both wrapped by one shared `<ExportMenuButton>` UI component. Each of the 3 pages gets its
own small, pure, unit-tested "row builder" function that turns that page's already-computed
filtered state into `string[][]` — no page duplicates another page's row-building logic, and no
page's filtering/computation logic is touched or duplicated.

**Tech Stack:** React 19 + TypeScript (strict), Vitest, new dependency: `xlsx` (SheetJS community
build, Apache-2.0 license, no other new dependencies).

## Global Constraints

- The export must never write to Supabase or mutate any in-memory dashboard state — read-only,
  client-side Blob download only (spec: "should not modify or affect the existing dashboard data").
- Export must reflect the *full* filtered result set, not just the current page of a paginated
  table (spec: "respect all active filters and selections" — pagination is a display concern, not
  a filter).
- Export is scoped to exactly the tab/page the button was clicked on (spec: "only include data
  belonging to the current tab").
- No new page-level `.tsx` gets a dedicated test file (this codebase's existing convention: 0 of
  the 12 pages/24 components have one, all pure logic lives in `src/lib/**/*.ts` with colocated
  `.test.ts` files) — every row-builder function below is therefore a pure function in `src/lib/`,
  not inline component code, specifically so it can be unit tested the way every other pure
  transform in this codebase is.
- `npm run build` (which runs `tsc -b` first) must pass after every task — this project's
  `tsc --noEmit` alone checks nothing (root tsconfig is references-only).

---

### Task 1: Shared export utility (`buildCsv` / `buildWorkbook` / `downloadFile`)

**Files:**
- Create: `src/lib/exportFile.ts`
- Test: `src/lib/exportFile.test.ts`
- Modify: `package.json` (add `xlsx` dependency)

**Interfaces:**
- Produces: `buildCsv(headers: string[], rows: string[][]): string`,
  `buildWorkbook(sheetName: string, headers: string[], rows: string[][]): ArrayBuffer`,
  `downloadFile(filename: string, content: string | ArrayBuffer, mimeType: string): void` — all
  three imported by `ExportMenuButton` (Task 2).

- [ ] **Step 1: Add the `xlsx` dependency**

Edit `package.json`, in the `"dependencies"` block (alphabetical, after `"react-router-dom"`):

```json
    "react-router-dom": "^7.15.0",
    "recharts": "^2.15.0",
    "xlsx": "^0.18.5"
```

Run: `npm install`
Expected: `xlsx` appears in `node_modules` and `package-lock.json` is updated. No other package
versions change.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/exportFile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildCsv, buildWorkbook } from './exportFile';

describe('buildCsv', () => {
  it('joins headers and rows with commas and CRLF line endings', () => {
    const csv = buildCsv(['Name', 'Status'], [['Acme', 'Live'], ['Beta', 'Removed']]);
    expect(csv).toBe('Name,Status\r\nAcme,Live\r\nBeta,Removed');
  });

  it('quotes a field containing a comma', () => {
    const csv = buildCsv(['Name'], [['Acme, Inc.']]);
    expect(csv).toBe('Name\r\n"Acme, Inc."');
  });

  it('quotes and doubles an embedded double-quote', () => {
    const csv = buildCsv(['Name'], [['Say "hi"']]);
    expect(csv).toBe('Name\r\n"Say ""hi"""');
  });

  it('quotes a field containing a newline', () => {
    const csv = buildCsv(['Notes'], [['line one\nline two']]);
    expect(csv).toBe('Notes\r\n"line one\nline two"');
  });

  it('leaves a plain field with no special characters unquoted', () => {
    const csv = buildCsv(['Status'], [['Live']]);
    expect(csv).toBe('Status\r\nLive');
  });

  it('produces just the header row when there are no data rows', () => {
    const csv = buildCsv(['A', 'B'], []);
    expect(csv).toBe('A,B');
  });
});

describe('buildWorkbook', () => {
  it('round-trips headers and rows through XLSX.read', () => {
    const buffer = buildWorkbook('Rooster Partners', ['Name', 'Status'], [['Acme', 'Live']]);
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    expect(data).toEqual([['Name', 'Status'], ['Acme', 'Live']]);
  });

  it('truncates and sanitizes a sheet name Excel would otherwise reject', () => {
    const longName = 'A'.repeat(40) + ':bad/chars?';
    const buffer = buildWorkbook(longName, ['A'], [['1']]);
    const wb = XLSX.read(buffer, { type: 'array' });
    expect(wb.SheetNames[0].length).toBeLessThanOrEqual(31);
    expect(wb.SheetNames[0]).not.toMatch(/[:\\/?*[\]]/);
  });

  it('falls back to a default sheet name when sanitizing empties the string', () => {
    const buffer = buildWorkbook('::://///', ['A'], [['1']]);
    const wb = XLSX.read(buffer, { type: 'array' });
    expect(wb.SheetNames[0]).toBe('Sheet1');
  });
});
```

- [ ] **Step 2b: Run tests to verify they fail**

Run: `npx vitest run src/lib/exportFile.test.ts`
Expected: FAIL — `Cannot find module './exportFile'` (file doesn't exist yet).

- [ ] **Step 3: Implement `src/lib/exportFile.ts`**

```ts
import * as XLSX from 'xlsx';

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(','));
  return lines.join('\r\n');
}

// Excel sheet names: max 31 chars, and : \ / ? * [ ] are all rejected outright.
function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, '').slice(0, 31);
  return cleaned || 'Sheet1';
}

export function buildWorkbook(sheetName: string, headers: string[], rows: string[][]): ArrayBuffer {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(sheetName));
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadFile(filename: string, content: string | ArrayBuffer, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/exportFile.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/exportFile.ts src/lib/exportFile.test.ts
git commit -m "feat: add shared CSV/Excel export utility"
```

---

### Task 2: Shared `<ExportMenuButton>` component

**Files:**
- Create: `src/components/ExportMenuButton.tsx`

**Interfaces:**
- Consumes: `buildCsv`, `buildWorkbook`, `downloadFile` from `../lib/exportFile` (Task 1).
- Produces:
  ```ts
  interface ExportMenuButtonProps {
    headers: string[];
    getRows: () => string[][];
    filenameBase: string;
  }
  export default function ExportMenuButton(props: ExportMenuButtonProps): JSX.Element
  ```
  `getRows` is called lazily, only when the user clicks CSV or Excel — never eagerly on render.
  This matters on Brand Tabs specifically: it re-renders on every keystroke in the search box, and
  its filtered row set can be thousands of entries, so computing export rows on every render
  (rather than only on click) would be wasted work on a hot path.

- [ ] **Step 1: Implement `src/components/ExportMenuButton.tsx`**

No test file (matches this codebase's convention — 0 of 24 existing components have one;
interactive dropdown/portal components are verified by build + manual click-through, same as
`SelectDropdown.tsx` and `MultiSelectDropdown.tsx` were). Verified in Task 4/6/8's manual
click-through steps once wired into a real page.

```tsx
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { buildCsv, buildWorkbook, downloadFile } from '../lib/exportFile';

interface Props {
  headers: string[];
  getRows: () => string[][];
  filenameBase: string;
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function ExportMenuButton({ headers, getRows, filenameBase }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Portaled to document.body (see below) so the menu floats above any
  // scroll container instead of being clipped by one — same pattern as
  // SelectDropdown.tsx, whose position-tracking comment explains this in
  // more detail.
  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setMenuRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  function exportCsv() {
    const rows = getRows();
    downloadFile(`${filenameBase}-${todayStamp()}.csv`, buildCsv(headers, rows), 'text/csv;charset=utf-8;');
    setOpen(false);
  }

  function exportXlsx() {
    const rows = getRows();
    downloadFile(
      `${filenameBase}-${todayStamp()}.xlsx`,
      buildWorkbook(filenameBase, headers, rows),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 transition-colors"
      >
        <Download className="size-4" />
        Export
      </button>

      {open && menuRect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
          style={{ top: menuRect.top, left: menuRect.left, width: Math.max(menuRect.width, 190) }}
        >
          <button
            type="button"
            onClick={exportCsv}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-600 transition-colors hover:bg-blue-50"
          >
            <FileText className="size-3.5" />
            Export as CSV
          </button>
          <button
            type="button"
            onClick={exportXlsx}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-600 transition-colors hover:bg-blue-50"
          >
            <FileSpreadsheet className="size-3.5" />
            Export as Excel (.xlsx)
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: PASS (this component isn't imported anywhere yet, so this only checks it compiles in
isolation — full behavior is verified once a page wires it in).

- [ ] **Step 3: Commit**

```bash
git add src/components/ExportMenuButton.tsx
git commit -m "feat: add shared ExportMenuButton component"
```

---

### Task 3: Brand Tabs row builder (`buildBrandRowsForExport`)

**Files:**
- Create: `src/lib/brandExport.ts`
- Test: `src/lib/brandExport.test.ts`

**Interfaces:**
- Consumes: `getEntryCountry` from `./tab-configs` (existing), `formatCellValue` from `./format`
  (existing), `type Entry` from `../types/entry` (existing).
- Produces: `buildBrandRowsForExport(entries: Entry[], headers: string[], tab: string): string[][]`
  — consumed by `BrandGroup.tsx` in Task 4.

This mirrors exactly what `BrandGroup.tsx`'s on-screen `CellValue` component shows, with one
exception documented inline: link columns (`AG Review Link`, `Link to the profile`, etc.) render as
a fixed "View" badge on screen, but their underlying stored value *is* already the real URL — so
reading it directly (as this function does) is actually more useful for a data export than
reproducing the on-screen label would be, not a compromise.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/brandExport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildBrandRowsForExport } from './brandExport';
import type { Entry } from '../types/entry';

function makeEntry(data: Record<string, string | null>): Entry {
  return { id: '1', tab: 'Hanan', sheet_row_id: '1', data, updated_at: '', last_edited_by: 'dashboard', last_sync_tag: null };
}

describe('buildBrandRowsForExport', () => {
  it('exports the raw value for an ordinary column', () => {
    const entries = [makeEntry({ Account: 'acct1', 'TP Review Status': 'Live' })];
    const rows = buildBrandRowsForExport(entries, ['Account', 'TP Review Status'], 'Hanan');
    expect(rows).toEqual([['acct1', 'Live']]);
  });

  it('exports the real URL for a link column, not an on-screen label', () => {
    const entries = [makeEntry({ 'AG Review Link': 'https://askgamblers.com/reviews/acme' })];
    const rows = buildBrandRowsForExport(entries, ['AG Review Link'], 'Hanan');
    expect(rows).toEqual([['https://askgamblers.com/reviews/acme']]);
  });

  it('normalizes a date-like value the same way the on-screen table does', () => {
    const entries = [makeEntry({ 'Trust Pilot': '2026-08-05' })];
    const rows = buildBrandRowsForExport(entries, ['Trust Pilot'], 'Hanan');
    expect(rows).toEqual([['05/08/2026']]);
  });

  it('uses the derived Country when the raw Country field is blank', () => {
    const entries = [makeEntry({ Account: '123 | agent1 | Germany', Country: '' })];
    const rows = buildBrandRowsForExport(entries, ['Country'], 'Hanan');
    expect(rows).toEqual([['Germany']]);
  });

  it('uses the raw Country value when present, ignoring the derived fallback', () => {
    const entries = [makeEntry({ Account: '123 | agent1 | Germany', Country: 'France' })];
    const rows = buildBrandRowsForExport(entries, ['Country'], 'Hanan');
    expect(rows).toEqual([['France']]);
  });

  it('exports an empty string for a missing or null value', () => {
    const entries = [makeEntry({ Account: null })];
    const rows = buildBrandRowsForExport(entries, ['Account'], 'Hanan');
    expect(rows).toEqual([['']]);
  });

  it('produces one row per entry, in the given entries order', () => {
    const entries = [makeEntry({ Account: 'first' }), makeEntry({ Account: 'second' })];
    const rows = buildBrandRowsForExport(entries, ['Account'], 'Hanan');
    expect(rows).toEqual([['first'], ['second']]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/brandExport.test.ts`
Expected: FAIL — `Cannot find module './brandExport'`.

- [ ] **Step 3: Implement `src/lib/brandExport.ts`**

```ts
import { getEntryCountry } from './tab-configs';
import { formatCellValue } from './format';
import type { Entry } from '../types/entry';

export function buildBrandRowsForExport(entries: Entry[], headers: string[], tab: string): string[][] {
  return entries.map((entry) =>
    headers.map((header) => {
      if (header === 'Country') return getEntryCountry(entry.data, tab);
      const raw = entry.data[header];
      return raw ? formatCellValue(raw) : '';
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/brandExport.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/brandExport.ts src/lib/brandExport.test.ts
git commit -m "feat: add Brand Tabs export row builder"
```

---

### Task 4: Wire Export into Brand Tabs (`BrandGroup.tsx`)

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `ExportMenuButton` (Task 2), `buildBrandRowsForExport` (Task 3), `tabToSlug` from
  `../lib/tabs` (existing, not yet imported in this file), and this file's own existing `sorted`
  (full filtered+sorted entry list, defined around line 1423-1466), `visibleHeaders` (defined
  around line 994-1002), and `decodedTab` (defined near the top of the component from
  `useParams`).

- [ ] **Step 1: Add imports**

In `src/pages/BrandGroup.tsx`, add to the existing `lib/tabs` import (currently reads
`import { slugToTab, OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';`):

```ts
import { slugToTab, tabToSlug, OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
```

Add two new import lines near the other component/lib imports at the top of the file (after the
`MultiSelectDropdown` import):

```ts
import ExportMenuButton from '../components/ExportMenuButton';
import { buildBrandRowsForExport } from '../lib/brandExport';
```

- [ ] **Step 2: Add the button to the page-actions bar**

Find this block (the top "Page actions" row, right before the KPI cards):

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3 mb-[10px]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500 shrink-0">Date range</span>
          <DatePicker
            value={dateFrom}
            onChange={(v) => { setDateFrom(v); setPage(1); }}
            placeholder="From date"
            max={dateTo || undefined}
          />
          <span className="text-xs text-slate-400">→</span>
          <DatePicker
            value={dateTo}
            onChange={(v) => { setDateTo(v); setPage(1); }}
            placeholder="To date"
            min={dateFrom || undefined}
          />
        </div>
        {isApproved && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#000060] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#000060]/90 transition-colors"
          >
            <Plus className="size-4" />
            Add Review Account
          </button>
        )}
      </div>
```

Replace the closing `{isApproved && ( ... )}` block with the same block plus the export button
alongside it (export is visible to any authenticated session, not gated on `isApproved`, since it's
read-only — unlike "Add Review Account," which writes data):

```tsx
        <div className="flex items-center gap-2">
          <ExportMenuButton
            headers={visibleHeaders}
            getRows={() => buildBrandRowsForExport(sorted, visibleHeaders, decodedTab)}
            filenameBase={tabToSlug(decodedTab)}
          />
          {isApproved && (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#000060] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#000060]/90 transition-colors"
            >
              <Plus className="size-4" />
              Add Review Account
            </button>
          )}
        </div>
      </div>
```

(Only the final `{isApproved && (...)}` button and its wrapping `</div>` change — the `Date range`
`<div>` above it is untouched.)

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: PASS. If TypeScript complains that `sorted`/`visibleHeaders`/`decodedTab` are used before
their declaration, double check the button was placed in the JSX `return (...)` block (line ~1650
onward) — all three are plain `const`s computed earlier in the component body, so any placement
inside the returned JSX has them in scope.

- [ ] **Step 4: Manual click-through**

Run: `npm run dev`, open a Brand Tab (e.g. Rooster Partners) in the browser.

1. With no filters active, click Export → Export as CSV. Open the downloaded file — confirm the
   header row matches the visible table's columns and the row count matches the KPI "Total" card.
2. Apply a status filter (e.g. Live) and a date range. Click Export → Export as CSV again — confirm
   the row count now matches the filtered `results` count shown in the toolbar, not the unfiltered
   total.
3. Click Export → Export as Excel (.xlsx). Open it in Excel/LibreOffice/Google Sheets — confirm it
   opens without a repair prompt and the sheet name matches the tab.
4. Confirm no network request fires for either export (check the browser's Network tab) and no
   toast/notification about a save — this is a pure client-side download.

- [ ] **Step 5: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: add Export button to Brand Tabs"
```

---

### Task 5: Score Summary row builder (`buildScoreSummaryExportRows`)

**Files:**
- Create: `src/lib/scoreSummaryExport.ts`
- Test: `src/lib/scoreSummaryExport.test.ts`

**Interfaces:**
- Consumes: `type BrandSummary`, `type SuccessRate`, `successRatePct` from `./scoreSummary`
  (existing exports — `successRatePct` floors the rate except a rate of exactly 100, matching what
  `ScoreSummaryPanel.tsx` already displays).
- Produces:
  ```ts
  buildScoreSummaryExportHeaders(maxScore: number, showStars: boolean): string[]
  buildScoreSummaryExportRows(
    brands: BrandSummary[],
    maxScore: number,
    showStars: boolean,
    successRates: Map<string, SuccessRate>,
  ): string[][]
  ```
  Both consumed by `ScoreSummaryPanel.tsx` in Task 6.

One row per brand (Tab, Brand, star columns when a single platform is selected, Unrated,
Stars-Total, Published, Removed, Total, Success Rate %) — no per-group or grand-total subtotal
rows, since a spreadsheet is where a user would compute those themselves; this keeps one row
consistently meaning one brand, matching "include all relevant columns" without inventing a second
row shape mid-file.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/scoreSummaryExport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildScoreSummaryExportHeaders, buildScoreSummaryExportRows } from './scoreSummaryExport';
import type { BrandSummary, SuccessRate } from './scoreSummary';

function makeBrand(overrides: Partial<BrandSummary> = {}): BrandSummary {
  return {
    tab: 'Hanan',
    brand: 'Acme',
    counts: { 5: 2, 4: 1, 3: 0, 2: 0, 1: 0 },
    unrated: 1,
    total: 4,
    rated: 3,
    average: 4.33,
    label: 'Great',
    ...overrides,
  };
}

describe('buildScoreSummaryExportHeaders', () => {
  it('includes star columns in descending order when showStars is true', () => {
    expect(buildScoreSummaryExportHeaders(5, true)).toEqual([
      'Tab', 'Brand', '5 Star', '4 Star', '3 Star', '2 Star', '1 Star', 'Unrated', 'Stars Total',
      'Published', 'Removed', 'Total', 'Success Rate %',
    ]);
  });

  it('omits star columns entirely when showStars is false', () => {
    expect(buildScoreSummaryExportHeaders(0, false)).toEqual([
      'Tab', 'Brand', 'Published', 'Removed', 'Total', 'Success Rate %',
    ]);
  });
});

describe('buildScoreSummaryExportRows', () => {
  it('builds one row per brand with star counts and success rate', () => {
    const brands = [makeBrand()];
    const successRates = new Map<string, SuccessRate>([
      ['Hanan Acme', { live: 8, removed: 2, rate: 80 }],
    ]);
    const rows = buildScoreSummaryExportRows(brands, 5, true, successRates);
    expect(rows).toEqual([
      ['Hanan', 'Acme', '2', '1', '0', '0', '0', '1', '4', '8', '2', '10', '80'],
    ]);
  });

  it('omits star columns when showStars is false', () => {
    const brands = [makeBrand()];
    const successRates = new Map<string, SuccessRate>([
      ['Hanan Acme', { live: 8, removed: 2, rate: 80 }],
    ]);
    const rows = buildScoreSummaryExportRows(brands, 0, false, successRates);
    expect(rows).toEqual([['Hanan', 'Acme', '8', '2', '10', '80']]);
  });

  it('writes empty success-rate fields for a brand with no decided outcomes', () => {
    const brands = [makeBrand()];
    const rows = buildScoreSummaryExportRows(brands, 0, false, new Map());
    expect(rows).toEqual([['Hanan', 'Acme', '0', '0', '0', '']]);
  });

  it('floors the success rate the same way the on-screen table does', () => {
    const brands = [makeBrand()];
    const successRates = new Map<string, SuccessRate>([
      ['Hanan Acme', { live: 199, removed: 1, rate: 99.5 }],
    ]);
    const rows = buildScoreSummaryExportRows(brands, 0, false, successRates);
    expect(rows[0][rows[0].length - 1]).toBe('99');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scoreSummaryExport.test.ts`
Expected: FAIL — `Cannot find module './scoreSummaryExport'`.

- [ ] **Step 3: Implement `src/lib/scoreSummaryExport.ts`**

```ts
import { successRatePct, type BrandSummary, type SuccessRate } from './scoreSummary';

export function buildScoreSummaryExportHeaders(maxScore: number, showStars: boolean): string[] {
  const headers = ['Tab', 'Brand'];
  if (showStars) {
    for (let s = maxScore; s >= 1; s--) headers.push(`${s} Star`);
    headers.push('Unrated', 'Stars Total');
  }
  headers.push('Published', 'Removed', 'Total', 'Success Rate %');
  return headers;
}

export function buildScoreSummaryExportRows(
  brands: BrandSummary[],
  maxScore: number,
  showStars: boolean,
  successRates: Map<string, SuccessRate>,
): string[][] {
  return brands.map((b) => {
    const row: string[] = [b.tab, b.brand];
    if (showStars) {
      for (let s = maxScore; s >= 1; s--) row.push(String(b.counts[s] ?? 0));
      row.push(String(b.unrated), String(b.total));
    }
    const sr = successRates.get(`${b.tab} ${b.brand}`);
    const live = sr?.live ?? 0;
    const removed = sr?.removed ?? 0;
    const pct = successRatePct(sr?.rate ?? null);
    row.push(String(live), String(removed), String(live + removed), pct == null ? '' : String(pct));
    return row;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scoreSummaryExport.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoreSummaryExport.ts src/lib/scoreSummaryExport.test.ts
git commit -m "feat: add Score Summary export row builder"
```

---

### Task 6: Wire Export into Score Summary (`ScoreSummaryPanel.tsx`)

**Files:**
- Modify: `src/components/ScoreSummaryPanel.tsx`

**Interfaces:**
- Consumes: `ExportMenuButton` (Task 2), `buildScoreSummaryExportHeaders` +
  `buildScoreSummaryExportRows` (Task 5), and this file's own existing `filteredBrands`, `maxScore`,
  `result.showStars`, `successRates` (all defined in the component body around lines 237-267).

- [ ] **Step 1: Add imports**

Add near the top of `src/components/ScoreSummaryPanel.tsx`, alongside the other local imports:

```ts
import ExportMenuButton from './ExportMenuButton';
import { buildScoreSummaryExportHeaders, buildScoreSummaryExportRows } from '../lib/scoreSummaryExport';
```

- [ ] **Step 2: Add the button to the filter row**

Find this block (the platform/date/tab filter row):

```tsx
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelectDropdown noun="platform" values={platform} onChange={(v) => setPlatform(v as Platform[])} options={PLATFORM_MULTI_OPTS} />
            <div className="h-4 w-px bg-slate-200 mx-1" />
            <DatePicker
              value={fromIso}
              onChange={setFromIso}
              placeholder="From date"
              max={toIso || undefined}
              align="left"
              triggerTextClassName="text-sm"
            />
            <span className="text-sm text-slate-400">→</span>
            <DatePicker
              value={toIso}
              onChange={setToIso}
              placeholder="To date"
              min={fromIso || undefined}
              triggerTextClassName="text-sm"
            />
            <div className="h-4 w-px bg-slate-200 mx-1" />
            <MultiSelectDropdown noun="brand-tab" values={tabFilter} onChange={setTabFilter} options={tabOptions.map((t) => ({ value: t, label: tabDisplayName(t) }))} searchable />
          </div>
```

Add the export button at the end of that row, after the brand-tab dropdown:

```tsx
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelectDropdown noun="platform" values={platform} onChange={(v) => setPlatform(v as Platform[])} options={PLATFORM_MULTI_OPTS} />
            <div className="h-4 w-px bg-slate-200 mx-1" />
            <DatePicker
              value={fromIso}
              onChange={setFromIso}
              placeholder="From date"
              max={toIso || undefined}
              align="left"
              triggerTextClassName="text-sm"
            />
            <span className="text-sm text-slate-400">→</span>
            <DatePicker
              value={toIso}
              onChange={setToIso}
              placeholder="To date"
              min={fromIso || undefined}
              triggerTextClassName="text-sm"
            />
            <div className="h-4 w-px bg-slate-200 mx-1" />
            <MultiSelectDropdown noun="brand-tab" values={tabFilter} onChange={setTabFilter} options={tabOptions.map((t) => ({ value: t, label: tabDisplayName(t) }))} searchable />
            <div className="h-4 w-px bg-slate-200 mx-1" />
            <ExportMenuButton
              headers={buildScoreSummaryExportHeaders(maxScore, result.showStars)}
              getRows={() => buildScoreSummaryExportRows(filteredBrands, maxScore, result.showStars, successRates)}
              filenameBase="score-summary"
            />
          </div>
```

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual click-through**

Run: `npm run dev`, open Score Summary in the browser (or the Overview page's embedded panel).

1. With the default TP platform and no date range, click Export → Export as CSV. Confirm the row
   count matches the number of brand rows shown on screen and the Success Rate % column matches
   what's displayed for a couple of spot-checked brands.
2. Switch to 2+ platforms selected (so star columns disappear on screen). Export again — confirm
   the exported header row also has no star columns.
3. Set a date range and a brand-tab filter. Export again — confirm the row count matches the
   filtered on-screen brand count, not the unfiltered total.

- [ ] **Step 5: Commit**

```bash
git add src/components/ScoreSummaryPanel.tsx
git commit -m "feat: add Export button to Score Summary"
```

---

### Task 7: Schedule Planner row builder (`buildScheduleExportRows`)

**Files:**
- Create: `src/lib/scheduler/scheduleExport.ts`
- Test: `src/lib/scheduler/scheduleExport.test.ts`

**Interfaces:**
- Consumes: `PLATFORM_FULL_LABEL` from `./scheduleUtils` (existing), `type DayStatus`,
  `type BrandScheduleRow` from `../scheduleBrands` (existing), `type BrandPlatformPause` from
  `../queries` (existing), `type Platform` from `../removedPlatformBrands` (existing).
- Produces:
  ```ts
  export const SCHEDULE_EXPORT_HEADERS: string[]; // ['Brand', 'Platform', 'Mon', ..., 'Fri', 'Paused This Week', 'Page Removed']
  export interface ScheduleExportBrandData {
    brand: string;
    platforms: Platform[];
    rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>;
    pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>>;
    removedPlatforms: Platform[];
  }
  buildScheduleExportRows(data: ScheduleExportBrandData[]): string[][]
  ```
  Both consumed by `SchedulePlanner.tsx` in Task 8, which already computes every field of
  `ScheduleExportBrandData` via its existing `brandPlatforms`/`computeCellData`/
  `flaggedRemovedPlatforms` functions — this task only needs to shape that existing per-brand data
  into rows, not compute anything new.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/scheduler/scheduleExport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildScheduleExportRows, SCHEDULE_EXPORT_HEADERS, type ScheduleExportBrandData } from './scheduleExport';
import type { BrandScheduleRow } from '../scheduleBrands';
import type { BrandPlatformPause } from '../queries';

function makeRow(overrides: Partial<BrandScheduleRow> = {}): BrandScheduleRow {
  return {
    tab: 'Hanan',
    brand_key: 'acme',
    week_start: '2026-08-10',
    platform: 'tp',
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    ...overrides,
  };
}

function makePause(): BrandPlatformPause {
  return { tab: 'Hanan', brand_key: 'acme', platform: 'tp', paused_week_start: '2026-08-10', reason: 'auto' };
}

describe('SCHEDULE_EXPORT_HEADERS', () => {
  it('has one column per weekday plus brand/platform/paused/removed', () => {
    expect(SCHEDULE_EXPORT_HEADERS).toEqual([
      'Brand', 'Platform', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Paused This Week', 'Page Removed',
    ]);
  });
});

describe('buildScheduleExportRows', () => {
  it('builds one row per (brand, platform) with weekday statuses', () => {
    const data: ScheduleExportBrandData[] = [{
      brand: 'Acme',
      platforms: ['tp'],
      rowsByPlatform: { tp: makeRow({ monday: 'active', wednesday: 'paused' }) },
      pausesByPlatform: {},
      removedPlatforms: [],
    }];
    expect(buildScheduleExportRows(data)).toEqual([
      ['Acme', 'Trustpilot', 'Active', '', 'Paused', '', '', 'N', 'N'],
    ]);
  });

  it('marks Paused This Week and Page Removed independently of the day statuses', () => {
    const data: ScheduleExportBrandData[] = [{
      brand: 'Acme',
      platforms: ['tp'],
      rowsByPlatform: {},
      pausesByPlatform: { tp: makePause() },
      removedPlatforms: ['tp'],
    }];
    expect(buildScheduleExportRows(data)).toEqual([
      ['Acme', 'Trustpilot', '', '', '', '', '', 'Y', 'Y'],
    ]);
  });

  it('produces one row per platform for a multi-platform brand', () => {
    const data: ScheduleExportBrandData[] = [{
      brand: 'Acme',
      platforms: ['tp', 'ag'],
      rowsByPlatform: { tp: makeRow({ platform: 'tp', friday: 'active' }), ag: makeRow({ platform: 'ag' }) },
      pausesByPlatform: {},
      removedPlatforms: [],
    }];
    const rows = buildScheduleExportRows(data);
    expect(rows).toHaveLength(2);
    expect(rows[0][1]).toBe('Trustpilot');
    expect(rows[1][1]).toBe('AskGamblers');
  });

  it('produces no rows for a brand with zero remaining platforms', () => {
    const data: ScheduleExportBrandData[] = [{
      brand: 'Acme',
      platforms: [],
      rowsByPlatform: {},
      pausesByPlatform: {},
      removedPlatforms: ['tp'],
    }];
    expect(buildScheduleExportRows(data)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scheduler/scheduleExport.test.ts`
Expected: FAIL — `Cannot find module './scheduleExport'`.

- [ ] **Step 3: Implement `src/lib/scheduler/scheduleExport.ts`**

```ts
import { PLATFORM_FULL_LABEL } from './scheduleUtils';
import type { DayStatus, BrandScheduleRow } from '../scheduleBrands';
import type { BrandPlatformPause } from '../queries';
import type { Platform } from '../removedPlatformBrands';

export const SCHEDULE_EXPORT_HEADERS = [
  'Brand', 'Platform', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Paused This Week', 'Page Removed',
];

export interface ScheduleExportBrandData {
  brand: string;
  platforms: Platform[];
  rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>;
  pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>>;
  removedPlatforms: Platform[];
}

function dayStatusLabel(status: DayStatus | undefined): string {
  if (status === 'active') return 'Active';
  if (status === 'paused') return 'Paused';
  return '';
}

export function buildScheduleExportRows(data: ScheduleExportBrandData[]): string[][] {
  const rows: string[][] = [];
  for (const { brand, platforms, rowsByPlatform, pausesByPlatform, removedPlatforms } of data) {
    for (const platform of platforms) {
      const row = rowsByPlatform[platform];
      rows.push([
        brand,
        PLATFORM_FULL_LABEL[platform],
        dayStatusLabel(row?.monday),
        dayStatusLabel(row?.tuesday),
        dayStatusLabel(row?.wednesday),
        dayStatusLabel(row?.thursday),
        dayStatusLabel(row?.friday),
        pausesByPlatform[platform] ? 'Y' : 'N',
        removedPlatforms.includes(platform) ? 'Y' : 'N',
      ]);
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/scheduleExport.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/scheduleExport.ts src/lib/scheduler/scheduleExport.test.ts
git commit -m "feat: add Schedule Planner export row builder"
```

---

### Task 8: Wire Export into Schedule Planner (`SchedulePlanner.tsx`)

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx`

**Interfaces:**
- Consumes: `ExportMenuButton` (Task 2), `SCHEDULE_EXPORT_HEADERS` + `buildScheduleExportRows`
  (Task 7), and this file's own existing `filteredBrands`, `brandPlatforms`, `computeCellData`,
  `flaggedRemovedPlatforms`, `tab`, `weekStartISO` (all already defined in the component, see the
  read of `SchedulePlanner.tsx` lines 120-440 done during planning).

- [ ] **Step 1: Add imports**

Add near the top of `src/pages/SchedulePlanner.tsx`, alongside the other component/lib imports:

```ts
import ExportMenuButton from '../components/ExportMenuButton';
import { buildScheduleExportRows, SCHEDULE_EXPORT_HEADERS } from '../lib/scheduler/scheduleExport';
```

- [ ] **Step 2: Add the button to the toolbar**

Find this block (the week-navigation controls, in the toolbar's `ml-auto` div):

```tsx
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWeekStart((d) => addDays(d, -7))}
                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                  aria-label="Previous week"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-sm text-slate-600 whitespace-nowrap">
                  Week of {formatWeekdayDate(weekStart, 0)} – {formatWeekdayDate(weekStart, 4)}
                </span>
                <button
                  type="button"
                  onClick={() => setWeekStart((d) => addDays(d, 7))}
                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                  aria-label="Next week"
                >
                  <ChevronRight className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart(mondayOf(new Date()))}
                  className="text-sm text-blue-600 hover:text-blue-700"
```

That button is the "Today" button; its full body (unchanged by this task) is:

```tsx
                <button
                  type="button"
                  onClick={() => setWeekStart(mondayOf(new Date()))}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Today
                </button>
```

Add the export button immediately after that "Today" button's closing `</button>`, still inside the
same `ml-auto flex items-center gap-2` div (i.e. immediately before that div's own closing `</div>`,
which is followed by the toolbar's outer closing `</div></div>` and then the `<table>`):

```tsx
                <ExportMenuButton
                  headers={SCHEDULE_EXPORT_HEADERS}
                  getRows={() => buildScheduleExportRows(
                    filteredBrands.map((brand) => {
                      const { rowsByPlatform, pausesByPlatform } = computeCellData(brand);
                      return {
                        brand,
                        platforms: brandPlatforms(brand),
                        rowsByPlatform,
                        pausesByPlatform,
                        removedPlatforms: flaggedRemovedPlatforms(brand),
                      };
                    }),
                  )}
                  filenameBase={`schedule-planner-${tabToSlug(tab)}-${weekStartISO}`}
                />
              </div>
```

(Only the closing `</div>` of the `ml-auto` container moves — everything before the new
`<ExportMenuButton>` block, including the "Today" button, is unchanged.)

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: PASS. `tabToSlug` is already imported in this file (see the existing
`import { OPERATIONAL_TABS, tabDisplayName, tabToSlug } from '../lib/tabs';` at the top) — no new
import needed for it.

- [ ] **Step 4: Manual click-through**

Run: `npm run dev`, open Schedule Planner in the browser.

1. Select a multi-platform tab (e.g. Rooster Partners). With no search filter, click Export →
   Export as CSV. Confirm the row count equals the number of visible brand rows times however many
   platform chips each shows (a brand with TP+AG+CG active produces 3 export rows).
2. Type a brand name into the search box, narrowing the visible rows. Export again — confirm the
   exported row count shrinks to match.
3. Navigate to the next week (▶) and export again — confirm the day-status columns reflect that
   week's data, not the week you started on.
4. Confirm the filename includes the tab and the displayed week's Monday date.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SchedulePlanner.tsx
git commit -m "feat: add Export button to Schedule Planner"
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, full suite (previous count + the ~28 new tests added across Tasks 1, 3, 5, 7).

- [ ] **Step 2: Run the full build**

Run: `npm run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Re-run all three manual click-throughs from Tasks 4, 6, 8 in one session**

Confirm no regressions between pages sharing `ExportMenuButton` — specifically, open Brand Tabs,
export, then without reloading navigate to Score Summary and Schedule Planner and export from each.
Confirm each page's popover opens independently (no leftover open-menu state from a previous page)
and each downloaded filename/content is correct for that page.

- [ ] **Step 4: Update `docs/task-history.md`**

Append a new task entry (check the current highest task number in `docs/task-history.md` first —
per this repo's PMS workflow, use `<current highest> + 1`) summarizing: the 3 pages that got
Export, the CSV/.xlsx format choice via the shared `ExportMenuButton` popover, the new `xlsx`
dependency, and that export reads only already-filtered in-memory state (no new Supabase queries,
no write path).

- [ ] **Step 5: Commit**

```bash
git add docs/task-history.md
git commit -m "docs: record Data Export task in task-history.md"
```
