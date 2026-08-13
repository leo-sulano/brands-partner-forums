# Automated Brand Page Removal Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily automated check that detects a brand's TrustPilot
page being fully delisted and auto-flags it in `removed_platform_brands`,
triggering the existing (already-deployed) `notify-brand-removed` email.

**Architecture:** A Node script exports the TypeScript brand-URL/tab-label
maps in `src/lib/tab-configs.ts`/`src/lib/tabs.ts` to a committed JSON file
so the frontend and the new Python script share one source of truth. A new
Python script (`scripts/check_brand_page_removed.py`), run daily via cron on
the existing `scraper-leo` EC2 box, reuses that box's stealth-browser
(`undetected-chromedriver`) setup to load each brand's TrustPilot page,
detects removal via a verified rendered-DOM signature, and writes/notifies
through the exact same Supabase REST calls the frontend's manual checkbox
flow uses.

**Tech Stack:** Node.js (plain `.mjs`, no TS loader) for the export step;
Python + `requests` + `undetected-chromedriver`/Selenium for the detection
script, matching every existing `check_*_status.py` script's stack; `pytest`
for Python tests, `vitest` for the Node export script's test.

**Spec:** `docs/superpowers/specs/2026-08-13-automated-brand-page-removal-detection-design.md`

## Global Constraints

- TrustPilot only — AskGamblers/CasinoGuru/Wizard of Odds have no verified
  removed-page signature and are explicitly out of scope for this plan.
- Detection must read rendered DOM text (Selenium element `.text`), never
  raw `driver.page_source` substring matching — the removed-page phrase
  exists unrendered inside TrustPilot's own JS bundle on every page load.
- The job only ever adds `removed_platform_brands` rows — it must never
  delete/clear one, even if a later run finds the page live again.
- Skip any `(tab, brand)` already flagged removed for `platform='tp'` —
  never re-check or re-notify an already-flagged brand.
- A failed page load (network/proxy/CAPTCHA error) must be logged and
  skipped, never treated as "removed."
- `notify-brand-removed`'s real payload is `{ brand, tabLabel,
  platformShortLabel, removedAtLabel }` sent with `Authorization: Bearer
  <SUPABASE_SERVICE_ROLE_KEY>` — not the Resend-era shape from the
  2026-08-12 spec.
- The upsert into `removed_platform_brands` must use
  `on_conflict=tab,brand_key,platform` with `Prefer:
  resolution=merge-duplicates`, matching `setBrandPlatformRemoved` exactly.

---

## Task 1: Export brand-URL and tab-label maps to JSON

**Files:**
- Create: `scripts/export-brand-urls.mjs`
- Create: `scripts/export-brand-urls.test.mjs`
- Create: `scripts/brand_urls.generated.json` (generated output, committed)
- Modify: `package.json` (add `export:brand-urls` script)

**Interfaces:**
- Produces: `scripts/brand_urls.generated.json` with shape
  `{ brand_tp_urls: Record<string,string>, brand_ag_urls: Record<string,string>,
  brand_cg_urls: Record<string,string>, tab_brand_urls:
  Record<string,Record<string,string>>, tab_display_names:
  Record<string,string> }` — Task 3 reads this file by exact key names.

- [ ] **Step 1: Write the failing test for the flat-object extractor**

```js
// scripts/export-brand-urls.test.mjs
import { describe, it, expect } from 'vitest';
import { extractFlatObject, extractNestedObject, buildBrandUrlMaps } from './export-brand-urls.mjs';

const FIXTURE_TAB_CONFIGS = `
export const BRAND_TP_URLS: Record<string, string> = {
  'prive casino':          'https://www.trustpilot.com/review/privecasino.bet',
  'lucky7even':            'https://www.trustpilot.com/review/www.lucky7even.com',
};

const TAB_BRAND_URLS: Record<string, Record<string, string>> = {
  'Wizard of Odds': {
    'rocketspin':      'https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/',
  },
  'Revolution Casino': {
    // God Of Casino has no Trustpilot page (AG only).
    'god of casino': 'https://www.askgamblers.com/online-casinos/reviews/god-of-casino',
  },
};
`;

const FIXTURE_TABS = `
const TAB_DISPLAY_NAMES: Partial<Record<OperationalTab, string>> = {
  'TP Affiliate': 'FTP',
  'TP Brand Injection': 'BITP',
};
`;

describe('extractFlatObject', () => {
  it('extracts quoted key/value pairs from a top-level const object', () => {
    const result = extractFlatObject(FIXTURE_TAB_CONFIGS, 'BRAND_TP_URLS');
    expect(result).toEqual({
      'prive casino': 'https://www.trustpilot.com/review/privecasino.bet',
      'lucky7even': 'https://www.trustpilot.com/review/www.lucky7even.com',
    });
  });

  it('throws when the const name is not found', () => {
    expect(() => extractFlatObject(FIXTURE_TAB_CONFIGS, 'NOT_THERE')).toThrow();
  });
});

describe('extractNestedObject', () => {
  it('extracts one flat object per outer tab key, skipping comment lines', () => {
    const result = extractNestedObject(FIXTURE_TAB_CONFIGS, 'TAB_BRAND_URLS');
    expect(result).toEqual({
      'Wizard of Odds': {
        rocketspin: 'https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/',
      },
      'Revolution Casino': {
        'god of casino': 'https://www.askgamblers.com/online-casinos/reviews/god-of-casino',
      },
    });
  });
});

describe('buildBrandUrlMaps', () => {
  it('assembles all five maps from the two source files', () => {
    const maps = buildBrandUrlMaps({
      tabConfigsSource: FIXTURE_TAB_CONFIGS,
      tabsSource: FIXTURE_TABS,
    });
    expect(maps.tab_display_names).toEqual({
      'TP Affiliate': 'FTP',
      'TP Brand Injection': 'BITP',
    });
    expect(maps.brand_tp_urls['prive casino']).toBe(
      'https://www.trustpilot.com/review/privecasino.bet',
    );
    expect(maps.tab_brand_urls['Wizard of Odds'].rocketspin).toBe(
      'https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/export-brand-urls.test.mjs`
Expected: FAIL — `export-brand-urls.mjs` does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// scripts/export-brand-urls.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Extracts a top-level `const NAME = { ... }` object literal's flat quoted
// string-to-string entries by brace-balancing from the first `{` after the
// declaration. Not a general TS parser — only works because every entry in
// BRAND_TP_URLS/BRAND_AG_URLS/BRAND_CG_URLS/TAB_DISPLAY_NAMES is a plain
// 'key': 'value' pair; comment lines between entries are simply skipped
// since they never match the key:value regex.
export function extractFlatObject(source, constName) {
  const declIdx = source.indexOf(`const ${constName}`);
  if (declIdx === -1) throw new Error(`const ${constName} not found`);
  const braceStart = source.indexOf('{', declIdx);
  let depth = 1;
  let i = braceStart + 1;
  while (depth > 0) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    i++;
  }
  const body = source.slice(braceStart + 1, i - 1);
  const entries = {};
  for (const m of body.matchAll(/'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
    entries[m[1]] = m[2];
  }
  return entries;
}

// TAB_BRAND_URLS nests one flat object per tab name. Finds each top-level
// `'Tab Name': {` block by brace-balancing, then runs the same flat-entry
// regex extractFlatObject uses against each block's own body.
export function extractNestedObject(source, constName) {
  const declIdx = source.indexOf(`const ${constName}`);
  if (declIdx === -1) throw new Error(`const ${constName} not found`);
  const braceStart = source.indexOf('{', declIdx);
  let depth = 1;
  let i = braceStart + 1;
  const outerStart = i;
  while (depth > 0) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    i++;
  }
  const outerBody = source.slice(outerStart, i - 1);
  const result = {};
  const tabRe = /'([^']+)':\s*\{/g;
  let match;
  while ((match = tabRe.exec(outerBody))) {
    const tabName = match[1];
    const innerBraceStart = match.index + match[0].length - 1;
    let innerDepth = 1;
    let j = innerBraceStart + 1;
    while (innerDepth > 0) {
      if (outerBody[j] === '{') innerDepth++;
      if (outerBody[j] === '}') innerDepth--;
      j++;
    }
    const innerBody = outerBody.slice(innerBraceStart + 1, j - 1);
    const entries = {};
    for (const m of innerBody.matchAll(/'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
      entries[m[1]] = m[2];
    }
    result[tabName] = entries;
    tabRe.lastIndex = j;
  }
  return result;
}

export function buildBrandUrlMaps({ tabConfigsSource, tabsSource }) {
  return {
    brand_tp_urls: extractFlatObject(tabConfigsSource, 'BRAND_TP_URLS'),
    brand_ag_urls: extractFlatObject(tabConfigsSource, 'BRAND_AG_URLS'),
    brand_cg_urls: extractFlatObject(tabConfigsSource, 'BRAND_CG_URLS'),
    tab_brand_urls: extractNestedObject(tabConfigsSource, 'TAB_BRAND_URLS'),
    tab_display_names: extractFlatObject(tabsSource, 'TAB_DISPLAY_NAMES'),
  };
}

function main() {
  const tabConfigsSource = readFileSync(
    path.join(__dirname, '../src/lib/tab-configs.ts'),
    'utf8',
  );
  const tabsSource = readFileSync(path.join(__dirname, '../src/lib/tabs.ts'), 'utf8');
  const maps = buildBrandUrlMaps({ tabConfigsSource, tabsSource });
  const outPath = path.join(__dirname, 'brand_urls.generated.json');
  writeFileSync(outPath, JSON.stringify(maps, null, 2) + '\n');
  console.log(`Wrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/export-brand-urls.test.mjs`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Add the package.json script**

Modify `package.json`'s `scripts` block:

```json
    "capture:demo": "node scripts/capture-getting-started.mjs",
    "export:brand-urls": "node scripts/export-brand-urls.mjs"
```

- [ ] **Step 6: Generate the real JSON file and spot-check it**

Run: `npm run export:brand-urls`

Then verify the output against known real values (catches a parser bug that
the small fixture in Step 1 wouldn't):

```bash
node -e "
const m = require('./scripts/brand_urls.generated.json');
console.assert(m.brand_tp_urls['prive casino'] === 'https://www.trustpilot.com/review/privecasino.bet', 'prive casino mismatch');
console.assert(m.tab_brand_urls['Wizard of Odds']['rocketspin'] === 'https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/', 'WO rocketspin mismatch');
console.assert(m.tab_display_names['TP Affiliate'] === 'FTP', 'FTP label mismatch');
console.assert(Object.keys(m.brand_tp_urls).length > 60, 'TP url count looks too low: ' + Object.keys(m.brand_tp_urls).length);
console.log('OK');
"
```

Expected: prints `OK` with no assertion errors.

- [ ] **Step 7: Commit**

```bash
git add scripts/export-brand-urls.mjs scripts/export-brand-urls.test.mjs scripts/brand_urls.generated.json package.json
git commit -m "feat: export brand-URL maps to JSON for the Python removal checker"
```

---

## Task 2: TrustPilot removal-detection function

**Files:**
- Create: `scripts/check_brand_page_removed.py`
- Create: `scripts/test_check_brand_page_removed.py`

**Interfaces:**
- Produces: `is_brand_page_removed(driver) -> bool` — Task 5's main loop
  calls this once per brand page load.

- [ ] **Step 1: Write the failing test**

```python
# scripts/test_check_brand_page_removed.py
from unittest.mock import MagicMock

from selenium.common.exceptions import NoSuchElementException

import check_brand_page_removed as cbpr


def test_is_brand_page_removed_true_for_the_real_removed_heading():
    # Exact rendered <h1> text confirmed live against a known-removed
    # TrustPilot brand page (Prive Casino) during this feature's research.
    driver = MagicMock()
    driver.find_element.return_value.text = "This profile has been removed"
    assert cbpr.is_brand_page_removed(driver) is True


def test_is_brand_page_removed_false_for_a_real_live_heading():
    # Exact rendered <h1> .text confirmed live on a known-live brand
    # (Lucky7even) -- includes an embedded newline from nested markup,
    # which is exactly why this must compare Selenium's rendered .text and
    # not a raw-HTML substring search.
    driver = MagicMock()
    driver.find_element.return_value.text = "Lucky7even \nReviews"
    assert cbpr.is_brand_page_removed(driver) is False


def test_is_brand_page_removed_false_when_h1_is_missing():
    driver = MagicMock()
    driver.find_element.side_effect = NoSuchElementException()
    assert cbpr.is_brand_page_removed(driver) is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "scripts" && python -m pytest test_check_brand_page_removed.py -v`
Expected: FAIL — `check_brand_page_removed` module doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```python
# scripts/check_brand_page_removed.py
"""Daily TrustPilot brand-page-removal checker.

Detects a brand's TrustPilot review page being fully delisted (distinct
from an individual review's status, which check_review_status.py already
covers) and auto-flags removed_platform_brands the same way a human
checking the Edit Entry modal's checkbox would -- see
docs/superpowers/specs/2026-08-13-automated-brand-page-removal-detection-design.md.

Env vars required:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    NOTIFY_BRAND_REMOVED_URL
"""
from selenium.webdriver.common.by import By

REMOVED_HEADING_TEXT = "This profile has been removed"


def is_brand_page_removed(driver) -> bool:
    """True only if the page's rendered <h1> text exactly matches
    TrustPilot's real delisted-brand heading. Reads Selenium's rendered
    .text, never raw page_source -- the same phrase sits unrendered inside
    TrustPilot's own i18n JSON blob on every page, live or removed, so a
    raw-HTML substring check would false-positive on every brand."""
    try:
        heading = driver.find_element(By.TAG_NAME, "h1").text.strip()
    except Exception:
        return False
    return heading == REMOVED_HEADING_TEXT
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd "scripts" && python -m pytest test_check_brand_page_removed.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/check_brand_page_removed.py scripts/test_check_brand_page_removed.py
git commit -m "feat: add TrustPilot brand-page-removal detection function"
```

---

## Task 3: Brand-URL and tab-label resolution helpers

**Files:**
- Modify: `scripts/check_brand_page_removed.py`
- Modify: `scripts/test_check_brand_page_removed.py`

**Interfaces:**
- Consumes: `scripts/brand_urls.generated.json` (Task 1's output) — keys
  `brand_tp_urls`, `tab_brand_urls`, `tab_display_names`.
- Produces: `load_brand_urls(path=None) -> dict`,
  `get_brand_tp_url(brand: str, tab: str, brand_urls: dict) -> str | None`,
  `tab_label(tab: str, brand_urls: dict) -> str` — Task 5's main loop calls
  all three.

- [ ] **Step 1: Write the failing tests**

```python
# append to scripts/test_check_brand_page_removed.py

BRAND_URLS_FIXTURE = {
    "brand_tp_urls": {
        "prive casino": "https://www.trustpilot.com/review/privecasino.bet",
        "rocketspin": "https://www.trustpilot.com/review/rocketspin.com",
    },
    "tab_brand_urls": {
        "Wizard of Odds": {
            "rocketspin": "https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/",
        },
    },
    "tab_display_names": {
        "TP Affiliate": "FTP",
        "TP Brand Injection": "BITP",
    },
}


def test_get_brand_tp_url_uses_tab_override_when_present():
    url = cbpr.get_brand_tp_url("RocketSpin", "Wizard of Odds", BRAND_URLS_FIXTURE)
    assert url == "https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/"


def test_get_brand_tp_url_falls_back_to_flat_map():
    url = cbpr.get_brand_tp_url("Rocketspin", "Rooster Partners", BRAND_URLS_FIXTURE)
    assert url == "https://www.trustpilot.com/review/rocketspin.com"


def test_get_brand_tp_url_is_case_and_whitespace_insensitive():
    url = cbpr.get_brand_tp_url("  Prive Casino  ", "TP Brand Injection", BRAND_URLS_FIXTURE)
    assert url == "https://www.trustpilot.com/review/privecasino.bet"


def test_get_brand_tp_url_returns_none_when_unknown():
    assert cbpr.get_brand_tp_url("Nonexistent Brand", "Hanan", BRAND_URLS_FIXTURE) is None


def test_tab_label_uses_display_name_when_present():
    assert cbpr.tab_label("TP Affiliate", BRAND_URLS_FIXTURE) == "FTP"


def test_tab_label_falls_back_to_raw_tab_name():
    assert cbpr.tab_label("Rooster Partners", BRAND_URLS_FIXTURE) == "Rooster Partners"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd "scripts" && python -m pytest test_check_brand_page_removed.py -v`
Expected: FAIL — `get_brand_tp_url`/`tab_label`/`load_brand_urls` don't exist yet.

- [ ] **Step 3: Write the implementation**

```python
# add to scripts/check_brand_page_removed.py
import json
import os
from typing import Optional

_BRAND_URLS_PATH = os.path.join(os.path.dirname(__file__), "brand_urls.generated.json")


def load_brand_urls(path: str = _BRAND_URLS_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def get_brand_tp_url(brand: str, tab: str, brand_urls: dict) -> Optional[str]:
    """Mirrors src/lib/tab-configs.ts's getBrandTpUrl exactly: a tab-specific
    override in tab_brand_urls wins over the flat brand_tp_urls map."""
    key = brand.strip().lower()
    tab_urls = brand_urls.get("tab_brand_urls", {}).get(tab, {})
    if key in tab_urls:
        return tab_urls[key]
    return brand_urls.get("brand_tp_urls", {}).get(key)


def tab_label(tab: str, brand_urls: dict) -> str:
    """Mirrors src/lib/tabs.ts's tabDisplayName exactly."""
    return brand_urls.get("tab_display_names", {}).get(tab, tab)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd "scripts" && python -m pytest test_check_brand_page_removed.py -v`
Expected: PASS (9 tests total)

- [ ] **Step 5: Commit**

```bash
git add scripts/check_brand_page_removed.py scripts/test_check_brand_page_removed.py
git commit -m "feat: add brand-URL and tab-label resolution helpers"
```

---

## Task 4: Supabase read/write helpers

**Files:**
- Modify: `scripts/check_brand_page_removed.py`
- Modify: `scripts/test_check_brand_page_removed.py`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `NOTIFY_BRAND_REMOVED_URL` env vars.
- Produces: `fetch_all_entries() -> list[dict]`,
  `distinct_tab_brands(entries: list[dict]) -> set[tuple[str, str]]`,
  `fetch_removed_keys(platform: str) -> set[tuple[str, str]]`,
  `flag_brand_removed(tab: str, brand: str, platform: str) -> None`,
  `notify_brand_removed(brand: str, tab_label_value: str,
  platform_short_label: str, removed_at_label: str) -> None` — Task 5's main
  loop calls all five.

- [ ] **Step 1: Write the failing tests**

```python
# append to scripts/test_check_brand_page_removed.py

class _FakeResponse:
    def __init__(self, payload=None, status_ok=True):
        self._payload = payload
        self._status_ok = status_ok

    def raise_for_status(self):
        if not self._status_ok:
            raise RuntimeError("HTTP error")

    def json(self):
        return self._payload


def test_fetch_all_entries_paginates_until_a_short_page(monkeypatch):
    page1 = [{"id": i, "tab": "Hanan", "data": {}} for i in range(1000)]
    page2 = [{"id": 1000, "tab": "Hanan", "data": {}}]
    calls = []

    def fake_get(url, headers, params):
        calls.append(params)
        return _FakeResponse(page1 if params["offset"] == 0 else page2)

    monkeypatch.setattr(cbpr.requests, "get", fake_get)

    result = cbpr.fetch_all_entries()

    assert len(result) == 1001
    assert len(calls) == 2


def test_distinct_tab_brands_dedupes_and_skips_blank_brand():
    entries = [
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
        {"tab": "Hanan", "data": {"Brands": ""}},
        {"tab": "TP Brand Injection", "data": {"Brand / TP URL PAGE": "Prive Casino"}},
    ]
    result = cbpr.distinct_tab_brands(entries)
    assert result == {
        ("Hanan", "WinMega.com"),
        ("TP Brand Injection", "Prive Casino"),
    }


def test_fetch_removed_keys_returns_tab_brand_key_pairs(monkeypatch):
    def fake_get(url, headers, params):
        assert params["platform"] == "eq.tp"
        return _FakeResponse([
            {"tab": "Hanan", "brand_key": "winmega.com"},
            {"tab": "TP Brand Injection", "brand_key": "prive casino"},
        ])

    monkeypatch.setattr(cbpr.requests, "get", fake_get)

    result = cbpr.fetch_removed_keys("tp")

    assert result == {("Hanan", "winmega.com"), ("TP Brand Injection", "prive casino")}


def test_flag_brand_removed_upserts_with_merge_duplicates(monkeypatch):
    captured = {}

    def fake_post(url, headers, params, json):
        captured["url"] = url
        captured["headers"] = headers
        captured["params"] = params
        captured["json"] = json
        return _FakeResponse()

    monkeypatch.setattr(cbpr.requests, "post", fake_post)

    cbpr.flag_brand_removed("Hanan", "WinMega.com", "tp")

    assert captured["params"]["on_conflict"] == "tab,brand_key,platform"
    assert "resolution=merge-duplicates" in captured["headers"]["Prefer"]
    assert captured["json"] == [{
        "tab": "Hanan",
        "brand": "WinMega.com",
        "platform": "tp",
        "removed_by": "Automated Check",
    }]


def test_notify_brand_removed_sends_the_real_payload_shape(monkeypatch):
    captured = {}

    def fake_post(url, headers, json):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return _FakeResponse()

    monkeypatch.setattr(cbpr.requests, "post", fake_post)
    monkeypatch.setenv("NOTIFY_BRAND_REMOVED_URL", "https://example.com/notify-brand-removed")

    cbpr.notify_brand_removed("WinMega.com", "Hanan", "TP", "13/08/2026")

    assert captured["url"] == "https://example.com/notify-brand-removed"
    assert captured["json"] == {
        "brand": "WinMega.com",
        "tabLabel": "Hanan",
        "platformShortLabel": "TP",
        "removedAtLabel": "13/08/2026",
    }
    assert captured["headers"]["Authorization"].startswith("Bearer ")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd "scripts" && python -m pytest test_check_brand_page_removed.py -v`
Expected: FAIL — the five new functions don't exist yet.

- [ ] **Step 3: Write the implementation**

```python
# add to scripts/check_brand_page_removed.py
import os

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Same priority order as BRAND_COLS in src/pages/BrandGroup.tsx and
# check_review_status.py -- keep all three in sync.
BRAND_COLS = ["Brands", "Brand Name", "Brand", "Brand / TP URL PAGE", "URL PAGE", "Account Name"]


def find_brand_col(data: dict) -> Optional[str]:
    for col in BRAND_COLS:
        if col in data:
            return col
    return None


def _headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def fetch_all_entries() -> list:
    """GET every entries row's tab/data, paginated (PostgREST caps at 1000/request)."""
    PAGE = 1000
    rows: list = []
    offset = 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/entries",
            headers=_headers(),
            params={"select": "id,tab,data", "order": "id", "limit": PAGE, "offset": offset},
        )
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        offset += PAGE
    return rows


def distinct_tab_brands(entries: list) -> set:
    pairs = set()
    for row in entries:
        tab = row.get("tab") or ""
        data = row.get("data") or {}
        brand_col = find_brand_col(data)
        brand = (data.get(brand_col) or "").strip() if brand_col else ""
        if tab and brand:
            pairs.add((tab, brand))
    return pairs


def fetch_removed_keys(platform: str) -> set:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/removed_platform_brands",
        headers=_headers(),
        params={"select": "tab,brand_key", "platform": f"eq.{platform}"},
    )
    r.raise_for_status()
    return {(row["tab"], row["brand_key"]) for row in r.json()}


def flag_brand_removed(tab: str, brand: str, platform: str) -> None:
    """Same effect as a human checking the Edit Entry modal's box --
    setBrandPlatformRemoved's exact upsert shape (src/lib/queries.ts)."""
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/removed_platform_brands",
        headers={**_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
        params={"on_conflict": "tab,brand_key,platform"},
        json=[{"tab": tab, "brand": brand, "platform": platform, "removed_by": "Automated Check"}],
    )
    r.raise_for_status()


def notify_brand_removed(
    brand: str, tab_label_value: str, platform_short_label: str, removed_at_label: str,
) -> None:
    """Same payload shape src/lib/brandRemovedNotification.ts sends."""
    url = os.environ["NOTIFY_BRAND_REMOVED_URL"]
    r = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
            "Content-Type": "application/json",
        },
        json={
            "brand": brand,
            "tabLabel": tab_label_value,
            "platformShortLabel": platform_short_label,
            "removedAtLabel": removed_at_label,
        },
    )
    r.raise_for_status()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd "scripts" && python -m pytest test_check_brand_page_removed.py -v`
Expected: PASS (14 tests total)

- [ ] **Step 5: Commit**

```bash
git add scripts/check_brand_page_removed.py scripts/test_check_brand_page_removed.py
git commit -m "feat: add Supabase read/write helpers for brand-removal flagging"
```

---

## Task 5: Main script orchestration, dry-run, and cron wiring

**Files:**
- Modify: `scripts/check_brand_page_removed.py`
- Modify: `scripts/test_check_brand_page_removed.py`
- Modify: `docs/ec2-scraper-runbook.md`

**Interfaces:**
- Consumes: every function from Tasks 2-4 (`is_brand_page_removed`,
  `load_brand_urls`, `get_brand_tp_url`, `tab_label`, `fetch_all_entries`,
  `distinct_tab_brands`, `fetch_removed_keys`, `flag_brand_removed`,
  `notify_brand_removed`), plus `build_driver`/`_build_proxy_extension` from
  `check_review_status.py` (imported, not duplicated, since proxy rotation
  must not diverge between scripts).
- Produces: `run(dry_run: bool = False, tab_filter: str | None = None) ->
  dict` (summary counts) and a `main()` CLI entry point.

- [ ] **Step 1: Write the failing test for the orchestration loop**

```python
# append to scripts/test_check_brand_page_removed.py

def test_run_flags_and_notifies_a_newly_detected_removal(monkeypatch):
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: set())
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {"winmega.com": "https://www.trustpilot.com/review/winmega.com"},
        "tab_brand_urls": {},
        "tab_display_names": {},
    })

    fake_driver = object()
    monkeypatch.setattr(cbpr, "build_driver", lambda proxy="": fake_driver)
    monkeypatch.setattr(cbpr, "load_page", lambda driver, url: None)
    monkeypatch.setattr(cbpr, "is_brand_page_removed", lambda driver: True)

    flagged = []
    notified = []
    monkeypatch.setattr(cbpr, "flag_brand_removed", lambda tab, brand, platform: flagged.append((tab, brand, platform)))
    monkeypatch.setattr(cbpr, "notify_brand_removed", lambda brand, tab_label_value, platform_short_label, removed_at_label: notified.append(brand))

    summary = cbpr.run(dry_run=False)

    assert flagged == [("Hanan", "WinMega.com", "tp")]
    assert notified == ["WinMega.com"]
    assert summary == {"checked": 1, "newly_flagged": 1, "already_flagged": 0, "no_url": 0, "errors": 0}


def test_run_skips_already_flagged_brands(monkeypatch):
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: {("Hanan", "winmega.com")})
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {"winmega.com": "https://www.trustpilot.com/review/winmega.com"},
        "tab_brand_urls": {},
        "tab_display_names": {},
    })
    monkeypatch.setattr(cbpr, "build_driver", lambda proxy="": object())

    called = []
    monkeypatch.setattr(cbpr, "load_page", lambda driver, url: called.append(url))

    summary = cbpr.run(dry_run=False)

    assert called == []
    assert summary == {"checked": 0, "newly_flagged": 0, "already_flagged": 1, "no_url": 0, "errors": 0}


def test_run_dry_run_never_writes(monkeypatch):
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: set())
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {"winmega.com": "https://www.trustpilot.com/review/winmega.com"},
        "tab_brand_urls": {},
        "tab_display_names": {},
    })
    monkeypatch.setattr(cbpr, "build_driver", lambda proxy="": object())
    monkeypatch.setattr(cbpr, "load_page", lambda driver, url: None)
    monkeypatch.setattr(cbpr, "is_brand_page_removed", lambda driver: True)

    def fail(*args, **kwargs):
        raise AssertionError("must not write during a dry run")

    monkeypatch.setattr(cbpr, "flag_brand_removed", fail)
    monkeypatch.setattr(cbpr, "notify_brand_removed", fail)

    summary = cbpr.run(dry_run=True)

    assert summary["newly_flagged"] == 1  # counted, just not written


def test_run_treats_a_load_error_as_skip_not_removed(monkeypatch):
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: set())
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {"winmega.com": "https://www.trustpilot.com/review/winmega.com"},
        "tab_brand_urls": {},
        "tab_display_names": {},
    })
    monkeypatch.setattr(cbpr, "build_driver", lambda proxy="": object())

    def raise_load(driver, url):
        raise RuntimeError("proxy timeout")

    monkeypatch.setattr(cbpr, "load_page", raise_load)

    flagged = []
    monkeypatch.setattr(cbpr, "flag_brand_removed", lambda *a: flagged.append(a))

    summary = cbpr.run(dry_run=False)

    assert flagged == []
    assert summary["errors"] == 1


def test_run_skips_brands_with_no_configured_url(monkeypatch):
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Hanan", "data": {"Brands": "Some Untracked Brand"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: set())
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {}, "tab_brand_urls": {}, "tab_display_names": {},
    })

    summary = cbpr.run(dry_run=False)

    assert summary == {"checked": 0, "newly_flagged": 0, "already_flagged": 0, "no_url": 1, "errors": 0}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd "scripts" && python -m pytest test_check_brand_page_removed.py -v`
Expected: FAIL — `run`, `build_driver`, `load_page` don't exist in this
module yet.

- [ ] **Step 3: Write the implementation**

```python
# add to scripts/check_brand_page_removed.py
import argparse
import logging
import time
from datetime import datetime, timezone

from check_review_status import build_driver  # reuse, don't duplicate proxy rotation

_error_logger = logging.getLogger("check_brand_page_removed")
_error_logger.setLevel(logging.ERROR)
_handler = logging.FileHandler(os.path.join(os.path.dirname(__file__), "status_check_errors.log"))
_handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
_error_logger.addHandler(_handler)

POST_LOAD_SLEEP = 6


def load_page(driver, url: str) -> None:
    driver.get(url)
    time.sleep(POST_LOAD_SLEEP)


def run(dry_run: bool = False, tab_filter: Optional[str] = None) -> dict:
    brand_urls = load_brand_urls()
    already_flagged = fetch_removed_keys("tp")
    entries = fetch_all_entries()
    pairs = distinct_tab_brands(entries)
    if tab_filter:
        pairs = {(tab, brand) for tab, brand in pairs if tab == tab_filter}

    summary = {"checked": 0, "newly_flagged": 0, "already_flagged": 0, "no_url": 0, "errors": 0}
    driver = None
    for tab, brand in sorted(pairs):
        brand_key = brand.strip().lower()
        if (tab, brand_key) in already_flagged:
            summary["already_flagged"] += 1
            continue

        url = get_brand_tp_url(brand, tab, brand_urls)
        if not url:
            summary["no_url"] += 1
            continue

        if driver is None:
            driver = build_driver()

        summary["checked"] += 1
        try:
            load_page(driver, url)
            removed = is_brand_page_removed(driver)
        except Exception as exc:
            summary["errors"] += 1
            _error_logger.error("[TP-removal] %s -> %r", url, exc)
            continue

        if not removed:
            continue

        summary["newly_flagged"] += 1
        print(f"  REMOVED: {tab} / {brand} -> {url}")
        if dry_run:
            continue
        flag_brand_removed(tab, brand, "tp")
        removed_at_label = datetime.now(timezone.utc).strftime("%d/%m/%Y")
        try:
            notify_brand_removed(brand, tab_label(tab, brand_urls), "TP", removed_at_label)
        except Exception as exc:
            _error_logger.error("[TP-removal-notify] %s/%s -> %r", tab, brand, exc)

    if driver is not None:
        driver.quit()
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description="Daily TrustPilot brand-page-removal checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--dry-run", action="store_true", help="Print detections without writing/notifying")
    args = ap.parse_args()

    print("Checking TrustPilot brand pages for removal...")
    summary = run(dry_run=args.dry_run, tab_filter=args.tab)
    print(
        f"Checked {summary['checked']}, newly flagged {summary['newly_flagged']}, "
        f"already flagged (skipped) {summary['already_flagged']}, "
        f"no URL {summary['no_url']}, errors {summary['errors']}"
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd "scripts" && python -m pytest test_check_brand_page_removed.py -v`
Expected: PASS (19 tests total)

- [ ] **Step 5: Run the full existing Python test suite to confirm no regressions**

Run: `cd "scripts" && python -m pytest -v`
Expected: PASS — every existing `test_check_*_status.py`/`test_geo_proxy.py`/
`test_schedule_groups.py` test still passes; only new tests were added, no
existing function was modified.

- [ ] **Step 6: Do a real `--dry-run` against production data**

Run: `cd "scripts" && python check_brand_page_removed.py --dry-run --tab "TP Brand Injection"`

Expected: prints one `REMOVED:` line per brand whose page is genuinely
delisted for that tab, with a final summary line — sanity-check the printed
count against what's already known before ever running without `--dry-run`.
Requires real `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` env vars (same ones
`check_review_status.py` already needs) plus `NOTIFY_BRAND_REMOVED_URL`
(value already in `.env`: `VITE_NOTIFY_BRAND_REMOVED_URL`'s value, minus the
`VITE_` prefix — add a plain `NOTIFY_BRAND_REMOVED_URL` line to the EC2
box's env, since the Python script isn't Vite-bundled and doesn't see
`VITE_`-prefixed vars).

- [ ] **Step 7: Document the new script and cron entry in the EC2 runbook**

Read `docs/ec2-scraper-runbook.md` first to match its existing section
structure and tone exactly, then add a new section (after the existing
weekly-job section) covering:
- What `check_brand_page_removed.py` does and how it differs from the
  per-review `check_*_status.py` scripts (whole-page removal, not
  individual review status).
- The new daily crontab line to add by hand:
  `0 1 * * * cd /path/to/scripts && python3 check_brand_page_removed.py >> brand_removal_check.log 2>&1`
  (09:00 Manila daily, same time-of-day convention as the existing Monday
  weekly job).
- The `NOTIFY_BRAND_REMOVED_URL` env var this script additionally needs
  beyond what `check_review_status.py` already requires.
- The `--dry-run`/`--tab` flags, and the explicit warning that dry-run
  matters here specifically because the notification path is already live
  — an untested real run emails the whole team.
- A note that `scripts/brand_urls.generated.json` must be regenerated
  (`npm run export:brand-urls`, run from a machine with the repo checked
  out and Node installed — not on the EC2 box itself) and redeployed to the
  EC2 box whenever `tab-configs.ts`'s URL maps change, since the EC2 box has
  no Node toolchain to regenerate it in place.

- [ ] **Step 8: Commit**

```bash
git add scripts/check_brand_page_removed.py scripts/test_check_brand_page_removed.py docs/ec2-scraper-runbook.md
git commit -m "feat: wire up daily TrustPilot brand-page-removal check with dry-run and cron docs"
```
