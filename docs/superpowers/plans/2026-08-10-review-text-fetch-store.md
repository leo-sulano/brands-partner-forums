# Fetch & Store Written Review Text — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the actual written review text from TP/AG/CG/WO review pages during the
existing Selenium status-check runs and persist it to `entries.data`, so downstream tasks
(PMS Task 1's translate-on-demand modal, PMS Task 7's analysis overview) have real data to
work with.

**Architecture:** Extend the four existing Selenium checkers to also extract review body
text from the same page load they already do for status detection, and merge it into the
same `entries.data` PATCH write they already perform. Add a small frontend accessor
(`getReviewText`) mirroring the existing `PLATFORM_STATUS_KEYS` pattern so later tasks read
the new field consistently. No new tables, no migration, no new write path.

**Tech Stack:** Python 3 / Selenium (`undetected_chromedriver`) for the scrapers, pytest for
Python unit tests; TypeScript / Vitest for the frontend accessor.

## Global Constraints

- No commit, no push, no EC2 deploy this session — everything stays local until reviewed (standing session instruction).
- New jsonb keys only: `TP Review Text`, `AG Review Text`, `CG Review Text`, `WO Review Text` — no DB migration.
- New keys are never added to any tab's `TAB_COLUMN_CONFIGS` (`src/lib/tab-configs.ts`) — must stay invisible in the table.
- A text-extraction failure must never block or change existing status/rating behavior — always its own try/except.
- Review text is included in a write only when non-empty and different from what's already stored (mirrors how status/score are only written on change) — omitting the key on a merge-based PATCH is what preserves last-known text once a review is removed.
- Match existing code style exactly (docstrings, print-based logging, no new dependencies).

---

### Task 1: Frontend accessor — `getReviewText` in `scoreSummary.ts`

**Files:**
- Modify: `src/lib/scoreSummary.ts:72-77` (add after `PLATFORM_DATE_KEYS`)
- Modify: `src/lib/scoreSummary.test.ts:2` (import list), and add new tests near line 252-258

**Interfaces:**
- Produces: `PLATFORM_REVIEW_TEXT_KEYS: Record<Platform, readonly string[]>` and
  `getReviewText(data: Record<string, string | null>, platform: Platform): string | null`,
  both exported from `src/lib/scoreSummary.ts`. PMS Task 1 (translation modal) and PMS Task 7
  (analysis overview) will import these directly — do not rename without updating this plan.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scoreSummary.test.ts`, immediately after the existing `pick` tests (after line 258):

```ts
  it('PLATFORM_REVIEW_TEXT_KEYS has one canonical key per platform', () => {
    expect(PLATFORM_REVIEW_TEXT_KEYS.tp).toEqual(['TP Review Text']);
    expect(PLATFORM_REVIEW_TEXT_KEYS.ag).toEqual(['AG Review Text']);
    expect(PLATFORM_REVIEW_TEXT_KEYS.cg).toEqual(['CG Review Text']);
    expect(PLATFORM_REVIEW_TEXT_KEYS.wo).toEqual(['WO Review Text']);
  });

  it('getReviewText reads the platform-specific key', () => {
    expect(getReviewText({ 'TP Review Text': 'Great casino!' }, 'tp')).toBe('Great casino!');
    expect(getReviewText({ 'AG Review Text': 'Fast payouts' }, 'ag')).toBe('Fast payouts');
  });

  it('getReviewText returns null when the key is missing, null, or empty', () => {
    expect(getReviewText({}, 'tp')).toBeNull();
    expect(getReviewText({ 'TP Review Text': null }, 'tp')).toBeNull();
    expect(getReviewText({ 'TP Review Text': '' }, 'tp')).toBeNull();
  });

  it('getReviewText does not cross-read another platform\'s text', () => {
    expect(getReviewText({ 'AG Review Text': 'wrong platform' }, 'tp')).toBeNull();
  });
```

Update the import line at the top of the file (line 2) to add the two new names:

```ts
import { computeScoreSummary, computeSuccessRates, computeTabSuccessRates, computeAccountPlatformUsage, parseScore, ratingLabel, rateFromCounts, successRatePct, formatRatePct, PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, PLATFORM_REVIEW_TEXT_KEYS, pick, getReviewText, isRemovedStatus, passesPlatformDateFilter } from './scoreSummary';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- scoreSummary.test.ts` (or `npx vitest run src/lib/scoreSummary.test.ts`)
Expected: FAIL — `PLATFORM_REVIEW_TEXT_KEYS`/`getReviewText` are not exported yet.

- [ ] **Step 3: Implement**

In `src/lib/scoreSummary.ts`, add immediately after the `PLATFORM_DATE_KEYS` block (after line 77):

```ts
export const PLATFORM_REVIEW_TEXT_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Text'],
  ag: ['AG Review Text'],
  cg: ['CG Review Text'],
  wo: ['WO Review Text'],
};
```

Add immediately after the `pick` function (after line 92):

```ts
export function getReviewText(data: Record<string, string | null>, platform: Platform): string | null {
  return pick(data, PLATFORM_REVIEW_TEXT_KEYS[platform]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scoreSummary.test.ts`
Expected: PASS, all new + existing tests green.

- [ ] **Step 5: Run the full frontend suite and build to confirm no regression**

Run: `npm test` then `npm run build`
Expected: both pass (per `[[feedback_verify_with_npm_build]]` — `tsc --noEmit` alone checks nothing in this repo).

- [ ] **Step 6: Do not commit**

Per standing instruction, leave changes unstaged/uncommitted for user review.

---

### Task 2: Shared review-card text-extraction helper (`check_review_status.py`)

**Files:**
- Modify: `scripts/check_review_status.py` — add `from selenium.webdriver.common.by import By` to the import block (after line 32), and add the new functions after `page_blocked` (after line 153)
- Test: `scripts/test_check_review_status.py` — add tests for the pure `_xpath_literal` helper

**Interfaces:**
- Consumes: nothing new (uses `driver` objects passed in by callers).
- Produces: `extract_review_card_text(driver, user_lower, exclude_class=None, min_len=40, max_len=4000, max_ancestors=6) -> Optional[str]` and `_xpath_literal(value: str) -> str`, both importable from `check_review_status` — Task 4/5/6 (AG/CG/WO) import `extract_review_card_text` from this module, matching the existing pattern where they already import `page_blocked`/`resolve_status`/`normalize_review_list_url` from here.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test_check_review_status.py` (end of file):

```python
def test_xpath_literal_wraps_plain_string_in_single_quotes():
    assert crs._xpath_literal('niklasweber') == "'niklasweber'"


def test_xpath_literal_uses_double_quotes_when_value_has_single_quote():
    assert crs._xpath_literal("o'brien") == '"o\'brien"'


def test_xpath_literal_uses_concat_when_value_has_both_quote_types():
    # Pathological but must not crash or produce invalid XPath — split on
    # single quotes and rejoin with an escaped single-quote literal.
    value = '''o'br"ien'''
    result = crs._xpath_literal(value)
    assert result.startswith('concat(')
    assert "'" in result and '"' in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && python3 -m pytest test_check_review_status.py -k xpath_literal -v`
Expected: FAIL with `AttributeError: module 'check_review_status' has no attribute '_xpath_literal'`

- [ ] **Step 3: Implement**

Add `from selenium.webdriver.common.by import By` to the top import block of
`scripts/check_review_status.py`, right after `import undetected_chromedriver as uc` (line 32):

```python
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
```

Add the following after `page_blocked` (after line 153, before the `# ─── Status resolution` comment):

```python
# ─── Review-text extraction (shared by AG/CG/WO) ──────────────────────────────
# None of AG/CG/WO isolate a review-card DOM element today — they only prove a
# review exists via a whole-page text search, then discard everything except a
# rating regex. This locates the actual card so its clean text can be stored.

def _xpath_literal(value: str) -> str:
    """Build a safely-quoted XPath string literal. Handles values containing
    both quote types (rare for a username, but cheap to get right) via XPath's
    concat() trick, since XPath 1.0 has no string-escaping syntax."""
    if "'" not in value:
        return f"'{value}'"
    if '"' not in value:
        return f'"{value}"'
    parts = value.split("'")
    return "concat(" + ", \"'\", ".join(f"'{p}'" for p in parts) + ")"


def _has_ancestor_with_class(element, class_name: str) -> bool:
    """Walk up from `element` looking for an ancestor carrying `class_name`."""
    try:
        node = element
        for _ in range(8):
            classes = (node.get_attribute("class") or "").split()
            if class_name in classes:
                return True
            node = node.find_element(By.XPATH, "..")
    except Exception:
        pass
    return False


def extract_review_card_text(
    driver: uc.Chrome,
    user_lower: str,
    exclude_class: Optional[str] = None,
    min_len: int = 40,
    max_len: int = 4000,
    max_ancestors: int = 6,
) -> Optional[str]:
    """Locate the review card containing `user_lower` (the caller has already
    confirmed it's present via a whole-page text search) and return its clean
    rendered text. Walks up from the first matching element until an ancestor's
    text length falls inside [min_len, max_len] — a heuristic for "this is a
    review card, not a bare username span or the whole page" tuned against
    real live pages during this task's validation pass, not guessed blind.
    `exclude_class` skips a match nested inside an element carrying that CSS
    class (e.g. CasinoGuru's hidden 'tooltip-user-row' "helpful" widget, which
    reuses the same author-name markup as a real review)."""
    try:
        elements = driver.find_elements(
            By.XPATH,
            "//*[contains(translate(text(), "
            "'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "
            f"{_xpath_literal(user_lower)})]",
        )
    except Exception:
        return None

    for el in elements:
        try:
            if exclude_class and _has_ancestor_with_class(el, exclude_class):
                continue
            node = el
            for _ in range(max_ancestors):
                text = (node.text or "").strip()
                if min_len <= len(text) <= max_len:
                    return text
                parent = node.find_element(By.XPATH, "..")
                if parent == node:
                    break
                node = parent
        except Exception:
            continue
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && python3 -m pytest test_check_review_status.py -k xpath_literal -v`
Expected: PASS, all 3 new tests green.

- [ ] **Step 5: Run the full Python suite to confirm no regression**

Run: `cd scripts && python3 -m pytest -q`
Expected: all existing + new tests pass (63 existing + 3 new = 66).

- [ ] **Step 6: Do not commit**

---

### Task 3: TrustPilot review-text extraction

**Files:**
- Modify: `scripts/check_review_status.py` — add `_review_text_from_next_data`/`parse_review_text` after `parse_review_rating` (after line 415); change `fetch_status`'s signature and body (lines 618-641); update `main()`'s per-entry loop (lines 682-715)
- Modify: `scripts/status_server.py` — update the inline TP loop (lines 185-217)
- Test: `scripts/test_check_review_status.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `parse_review_text(html: str) -> Optional[str]`. Changes `fetch_status`'s return
  type from `tuple[Optional[str], Optional[int]]` to `tuple[Optional[str], Optional[int], Optional[str]]`
  — both of `fetch_status`'s two call sites (this file's `main()` and `status_server.py`) must
  be updated together in this task, or one of them breaks with a 2-vs-3 unpack mismatch.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test_check_review_status.py` (end of file):

```python
_NEXT_DATA_WITH_REVIEW_TEXT = '''<html><body><script id="__NEXT_DATA__" type="application/json">
{"props": {"pageProps": {"review": {"state": "published", "stars": 5, "text": "Das Casino ist sehr gut."}}}}
</script></body></html>'''

_NEXT_DATA_NO_TEXT_FIELD = '''<html><body><script id="__NEXT_DATA__" type="application/json">
{"props": {"pageProps": {"review": {"state": "published", "stars": 4}}}}
</script></body></html>'''

_NO_NEXT_DATA = '<html><body>thanks for your review</body></html>'


def test_parse_review_text_reads_text_field_from_next_data():
    assert crs.parse_review_text(_NEXT_DATA_WITH_REVIEW_TEXT) == 'Das Casino ist sehr gut.'


def test_parse_review_text_none_when_review_object_has_no_text_field():
    assert crs.parse_review_text(_NEXT_DATA_NO_TEXT_FIELD) is None


def test_parse_review_text_none_without_next_data_blob():
    assert crs.parse_review_text(_NO_NEXT_DATA) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && python3 -m pytest test_check_review_status.py -k parse_review_text -v`
Expected: FAIL — `parse_review_text` does not exist yet.

- [ ] **Step 3: Implement `parse_review_text`**

Add to `scripts/check_review_status.py` immediately after `parse_review_rating` (after line 415):

```python
def _review_text_from_next_data(html: str) -> Optional[str]:
    match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.+?)</script>',
        html, re.DOTALL,
    )
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    page_props = data.get("props", {}).get("pageProps", {})
    review = (
        page_props.get("review")
        or page_props.get("correlatedReview")
        or page_props.get("reviewData")
    )
    if not review:
        return None
    # Tried in this priority order; confirmed against a real live TP page's
    # __NEXT_DATA__ blob during this task's validation pass (Task 7) since
    # TP's JSON shape isn't publicly documented — reorder here if a real page
    # turns out to use a different key than the first match found live.
    text = review.get("text") or review.get("body") or review.get("reviewBody") or review.get("title")
    if not text or not str(text).strip():
        return None
    return str(text).strip()


def parse_review_text(html: str) -> Optional[str]:
    """Extract the written review body from a Trustpilot review/confirmation
    page, if the page's __NEXT_DATA__ blob is present. Returns None (not an
    error) when the page falls back to i18n text-signal detection instead —
    that path has no structured review object to read text from."""
    return _review_text_from_next_data(html)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && python3 -m pytest test_check_review_status.py -k parse_review_text -v`
Expected: PASS, all 3 new tests green.

- [ ] **Step 5: Update `fetch_status` to also return review text**

Replace `fetch_status` (lines 618-641 of `scripts/check_review_status.py`) with:

```python
def fetch_status(driver: uc.Chrome, raw_url: str) -> tuple[Optional[str], Optional[int], Optional[str]]:
    """Load the TP page and return (status, rating, review_text). Any may be
    None. Rating is the 1-5 star count when visible on the page."""
    url = raw_url.strip()
    if not url.startswith("http"):
        url = f"https://{url}"
    try:
        driver.get(url)
    except Exception:
        # Page load timeout — main content is usually already in the DOM, so continue
        pass
    try:
        time.sleep(POST_LOAD_SLEEP)
        if "trustpilot.com" not in driver.current_url:
            print(f"    redirected off-site -> {driver.current_url}")
            return ("Removed", None, None)
        html = driver.page_source
        status = parse_review_status(html) or "Published"
        rating = parse_review_rating(html)
        try:
            review_text = parse_review_text(html)
        except Exception as exc:
            print(f"    [text] extraction error: {exc}")
            review_text = None
        return (status, rating, review_text)
    except Exception as exc:
        print(f"    ERROR: {exc}")
        log_check_error("TP", url, exc)
        return (None, None, None)
```

- [ ] **Step 6: Update `main()`'s per-entry loop**

In `scripts/check_review_status.py`, inside `main()`, replace the block from
`new_status, new_rating = fetch_status(driver, url)` through the end of the `if not args.dry_run:` write
(original lines 690-714) with:

```python
                new_status, new_rating, new_review_text = fetch_status(driver, url)

                if new_status is None:
                    print(f"    -> could not determine status (skipped)")
                    errors += 1
                    continue

                updates: dict[str, str] = {}
                if new_status != current:
                    updates[status_col] = new_status
                new_score_str = str(new_rating) if new_rating is not None else None
                # Skip writing numeric rating to Yes/No boolean columns
                is_boolean_col = current_score.strip().lower() in {"yes", "no", ""}
                if score_col and new_score_str and new_score_str != current_score and not is_boolean_col:
                    updates[score_col] = new_score_str
                current_review_text = data.get("TP Review Text") or ""
                if new_review_text and new_review_text != current_review_text:
                    updates["TP Review Text"] = new_review_text

                if not updates:
                    print(f"    -> {current!r} *{current_score or '-'} (no change)")
                    continue

                tag = " (dry run)" if args.dry_run else ""
                print(f"    -> {current!r} -> {new_status!r} *{new_rating or '-'}{tag}")
                if not args.dry_run:
                    update_entry(entry["id"], data, updates,
                                 tab=entry.get("tab"), sheet_row_id=entry.get("sheet_row_id"))
                updated += 1
```

- [ ] **Step 7: Update `status_server.py`'s duplicate inline TP loop**

`status_server.py` has its own copy of this exact loop (it backs the dashboard's "Check
Status" button, separately from this file's CLI `main()`) — it must be updated identically
or the button path silently never gets review text. In `scripts/status_server.py`, replace
the block from `new_status, new_rating = fetch_status(driver, url)` through the `updated += 1`
line (original lines 193-217) with:

```python
                    new_status, new_rating, new_review_text = fetch_status(driver, url)

                    if new_status is None:
                        print(f'    -> could not determine (skipped)')
                        errors += 1
                        continue

                    updates: dict[str, str] = {}
                    if new_status != current:
                        updates[status_col] = new_status
                    new_score_str = str(new_rating) if new_rating is not None else None
                    is_boolean_col = current_score.strip().lower() in {"yes", "no", ""}
                    if score_col and new_score_str and new_score_str != current_score and not is_boolean_col:
                        updates[score_col] = new_score_str
                    current_review_text = data.get('TP Review Text') or ''
                    if new_review_text and new_review_text != current_review_text:
                        updates['TP Review Text'] = new_review_text

                    if not updates:
                        print(f'    -> {current!r} *{current_score or "-"} (no change)')
                        continue

                    sheet_ok = update_entry(entry['id'], data, updates,
                                 tab=entry.get('tab'), sheet_row_id=entry.get('sheet_row_id'))
                    if not sheet_ok:
                        sheet_errors += 1
                    print(f'    -> {current!r} -> {new_status!r} *{new_rating or "-"} (sheet: {"ok" if sheet_ok else "FAILED"})')
                    updated += 1
```

- [ ] **Step 8: Run the full Python suite to confirm no regression**

Run: `cd scripts && python3 -m pytest -q`
Expected: all tests pass.

- [ ] **Step 9: Do not commit**

---

### Task 4: AskGamblers review-text extraction

**Files:**
- Modify: `scripts/check_ag_status.py` — import block (lines 38-54), `fetch_ag_review` (lines 180-256), `check_ag_for_tab` (lines 259-364), `main` (lines 367-384)

**Interfaces:**
- Consumes: `extract_review_card_text` from Task 2 (`check_review_status.extract_review_card_text`).
- Produces: `fetch_ag_review` now returns `(status, rating, review_text)` — a 3-tuple, up
  from 2. Only one call site exists (inside `check_ag_for_tab`, same file) — no external
  breakage, but keep this shape identical to Task 3/5/6's `fetch_*_review` for consistency.
  `check_ag_for_tab` gains a `dry_run: bool = False` parameter.

- [ ] **Step 1: Add the import**

In `scripts/check_ag_status.py`, add `extract_review_card_text` to the existing
`from check_review_status import (...)` block (lines 38-54):

```python
from check_review_status import (
    build_driver,
    update_entry,
    _headers,
    _fetch_all,
    proxy_for_entry,
    log_check_error,
    page_blocked,
    resolve_status,
    normalize_review_list_url,
    extract_review_card_text,
    STATUS_FILTER_MAP,
    matches_scope_filters,
    SUPABASE_URL,
    BATCH_SIZE,
    DELAY_BETWEEN_BATCHES,
    CHROME_RESTART_EVERY,
)
```

- [ ] **Step 2: Update `fetch_ag_review` to also extract review text**

Replace `fetch_ag_review` (`scripts/check_ag_status.py` lines 180-255) with:

```python
def fetch_ag_review(
    driver: uc.Chrome, ag_link: str, ag_user: str, current_status: str = ""
) -> tuple:
    """Visit the AG casino review page and search player reviews for ag_user.

    Returns (status, rating, review_text):
      ('Published', 1-5 or None, text or None)  — username found in reviews
      (None, None, None)                        — not found; caller resolves the next status via resolve_status()
      ('__skip__', None, None)                  — page blocked/CAPTCHA; skip without changing status
    """
    url = normalize_review_list_url(ag_link.strip())
    if not url.startswith("http"):
        url = f"https://{url}"
    try:
        driver.get(url)
    except Exception:
        pass  # page load timeout — JS content usually still renders

    time.sleep(POST_LOAD_SLEEP)

    current_url = driver.current_url.lower()
    if "askgamblers.com" not in current_url:
        print(f"    redirected off-site -> {driver.current_url}")
        return ("Removed", None, None)

    # Scroll down to trigger lazy-loaded reviews section
    try:
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight / 2);")
        time.sleep(1.5)
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(1.5)
    except Exception:
        pass

    ag_user_lower = ag_user.lower()

    # No page cap — page all the way to the true last "Load More" before
    # concluding not-found. A fixed cap previously stopped at page 10, which
    # could wrongly call a review "not found" (and mark it Refused/Removed)
    # when it was really just further back in a long review list.
    page_num = 0
    while True:
        html = driver.page_source

        # First page only: check for CAPTCHA / bot-block before drawing conclusions
        if page_num == 0:
            print(f"    [page] length={len(html)}, url={driver.current_url[:60]}")
            if page_blocked(html, driver.title):
                print(f"    -> page blocked/CAPTCHA — skipping (no status change)")
                return ("__skip__", None, None)

        # Only the rendered visible text proves an authored review exists — a raw
        # HTML match can come from a hidden widget reusing review markup (confirmed
        # on CasinoGuru's "found this helpful" tooltip; hardened here too as a
        # precaution, though no live AG false positive has been observed).
        try:
            visible_text = driver.find_element(By.TAG_NAME, "body").text.lower()
        except Exception:
            visible_text = ""

        if ag_user_lower in visible_text:
            html_lower = html.lower()
            idx = html_lower.find(ag_user_lower)
            # Extract rating from surrounding HTML context
            context = html[max(0, idx - 500) : idx + 1500]
            rating = _extract_rating_from_context(context)
            try:
                review_text = extract_review_card_text(driver, ag_user_lower)
            except Exception as exc:
                print(f"    [text] extraction error: {exc}")
                review_text = None
            return ("Published", rating, review_text)

        clicked = _try_load_more(driver)
        page_num += 1
        if not clicked:
            break
        time.sleep(LOAD_MORE_SLEEP)

    # Username not found after all pages — caller decides next status
    return (None, None, None)
```

- [ ] **Step 3: Update `check_ag_for_tab`'s signature and per-entry loop**

In `scripts/check_ag_status.py`, add a `dry_run: bool = False` parameter to
`check_ag_for_tab`'s signature (line 259-268):

```python
def check_ag_for_tab(
    tab: Optional[str] = None,
    include_published: bool = True,
    headless: bool = True,
    country: Optional[str] = None,
    status_filter: Optional[str] = None,
    brands: Optional[list] = None,
    agent: Optional[str] = None,
    proxy: Optional[str] = None,
    dry_run: bool = False,
) -> dict:
```

Replace the block from `try:\n                    new_status, new_rating = fetch_ag_review(...)`
through `updated += 1` (original lines 321-355) with:

```python
                try:
                    new_status, new_rating, new_review_text = fetch_ag_review(driver, ag_link, ag_user, current)
                except Exception as exc:
                    print(f"    -> ERROR: {exc}")
                    log_check_error("AG", ag_link, exc)
                    errors += 1
                    continue

                if new_status == "__skip__":
                    continue

                if new_status is None:
                    ag_date = _val(data, AG_DATE_COLS)
                    new_status = resolve_status(found=False, current_status=current, added_date=ag_date)

                updates: dict = {}
                if new_status != current:
                    updates[status_col] = new_status
                new_score_str = str(new_rating) if new_rating is not None else None
                is_boolean_col = current_score.strip().lower() in {"yes", "no", ""}
                if score_col and new_score_str and new_score_str != current_score and not is_boolean_col:
                    updates[score_col] = new_score_str
                current_review_text = data.get("AG Review Text") or ""
                if new_review_text and new_review_text != current_review_text:
                    updates["AG Review Text"] = new_review_text

                if not updates:
                    print(f"    -> {current!r} *{current_score or '-'} (no change)")
                    continue

                if dry_run:
                    sheet_ok = True
                    print(f"    -> {current!r} -> {new_status!r} *{new_rating or '-'} (dry run)")
                else:
                    sheet_ok = update_entry(
                        entry["id"], data, updates,
                        tab=entry.get("tab"), sheet_row_id=entry.get("sheet_row_id"),
                    )
                    if not sheet_ok:
                        sheet_errors += 1
                    print(f"    -> {current!r} -> {new_status!r} *{new_rating or '-'} (sheet: {'ok' if sheet_ok else 'FAILED'})")
                updated += 1
```

- [ ] **Step 4: Add `--dry-run` to `main()`**

Replace `main()` (`scripts/check_ag_status.py` lines 367-384) with:

```python
def main() -> None:
    ap = argparse.ArgumentParser(description="Selenium stealth AskGamblers status checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--country", help="Restrict to one country (full name or ISO-2, e.g. Germany or de)")
    ap.add_argument("--no-headless", dest="headless", action="store_false", help="Show Chrome browser window")
    ap.add_argument("--dry-run", action="store_true", help="Print changes without writing to Supabase")
    ap.set_defaults(headless=True)
    args = ap.parse_args()

    scope = f"tab: {args.tab}" if args.tab else "all tabs"
    if args.country:
        scope += f", country: {args.country}"
    print(f"Loading AG entries ({scope})...")
    result = check_ag_for_tab(args.tab, include_published=True, headless=args.headless,
                               country=args.country, dry_run=args.dry_run)
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']}")
    if args.dry_run:
        print("(dry-run — no writes made)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the full Python suite to confirm no regression**

Run: `cd scripts && python3 -m pytest -q`
Expected: all tests pass (no existing test calls `fetch_ag_review` directly, so the 2→3-tuple
change has no test to update here).

- [ ] **Step 6: Do not commit**

---

### Task 5: CasinoGuru review-text extraction

**Files:**
- Modify: `scripts/check_cg_status.py` — import block (lines 38-54), `fetch_cg_review` (lines 197-269), `check_cg_for_tab` (lines 274-374), `main` (lines 377-394)

**Interfaces:**
- Consumes: `extract_review_card_text` from Task 2.
- Produces: `fetch_cg_review` now returns `(status, rating, review_text)`. `check_cg_for_tab` gains `dry_run: bool = False`.

- [ ] **Step 1: Add the import**

In `scripts/check_cg_status.py`, add `extract_review_card_text` to the existing
`from check_review_status import (...)` block (lines 38-54), same position as Task 4's Step 1.

- [ ] **Step 2: Update `fetch_cg_review` to also extract review text**

Replace `fetch_cg_review` (`scripts/check_cg_status.py` lines 197-269) with:

```python
def fetch_cg_review(
    driver: uc.Chrome, cg_link: str, cg_user: str, current_status: str = "", added_date: str = ""
) -> tuple:
    """Visit the CG casino review page and search player reviews for cg_user.

    Returns (status, rating, review_text):
      ('Published', 1-5 or None, text or None)  — username found in reviews
      ('Removed', None, None)     — not found, current status was 'published'
      ('Pending', None, None)     — not found, added within the grace period (see resolve_status)
      ('Refused', None, None)     — not found, not previously published, past the grace period
      ('__skip__', None, None)    — page blocked/CAPTCHA; skip without changing status
    """
    url = normalize_review_list_url(cg_link.strip())
    if not url.startswith("http"):
        url = f"https://{url}"
    try:
        driver.get(url)
    except Exception:
        pass

    time.sleep(POST_LOAD_SLEEP)

    # Safety: if redirected completely off casino.guru, treat as Removed
    current_url = driver.current_url.lower()
    if "casino.guru" not in current_url:
        print(f"    redirected off-site -> {driver.current_url}")
        return ("Removed", None, None)

    # Scroll down to trigger lazy-loaded reviews section
    try:
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight / 2);")
        time.sleep(1.5)
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(1.5)
    except Exception:
        pass

    cg_user_lower = cg_user.lower()

    # No page cap — page all the way to the true last "Load More" before
    # concluding not-found. A fixed cap previously stopped at page 10, which
    # could wrongly call a review "not found" (and mark it Refused/Removed)
    # when it was really just further back in a long review list.
    page_num = 0
    while True:
        html = driver.page_source

        # First page only: check for CAPTCHA / bot-block before drawing conclusions.
        # Must happen before any "not found" conclusion — otherwise a blocked page
        # reads identically to a genuinely-removed review.
        if page_num == 0 and page_blocked(html, driver.title):
            print(f"    -> page blocked/CAPTCHA — skipping (no status change)")
            return ("__skip__", None, None)

        # Only the rendered visible text proves an authored review exists — the
        # hidden liker tooltip never appears here, unlike in raw page_source.
        try:
            visible_text = driver.find_element(By.TAG_NAME, "body").text.lower()
        except Exception:
            visible_text = ""

        if cg_user_lower in visible_text:
            context = _find_authored_context(html, html.lower(), cg_user_lower)
            rating = _extract_rating_from_context(context) if context else None
            try:
                review_text = extract_review_card_text(driver, cg_user_lower, exclude_class=_LIKER_TOOLTIP_MARKER)
            except Exception as exc:
                print(f"    [text] extraction error: {exc}")
                review_text = None
            return ("Published", rating, review_text)

        clicked = _try_load_more(driver)
        page_num += 1
        if not clicked:
            break
        time.sleep(LOAD_MORE_SLEEP)

    return (resolve_status(found=False, current_status=current_status, added_date=added_date), None, None)
```

- [ ] **Step 3: Update `check_cg_for_tab`'s signature and per-entry loop**

In `scripts/check_cg_status.py`, add `dry_run: bool = False` to `check_cg_for_tab`'s signature
(lines 274-283), same shape as Task 4's Step 3.

Replace the block from `try:\n                    new_status, new_rating = fetch_cg_review(...)`
through `updated += 1` (original lines 335-365) with:

```python
                try:
                    new_status, new_rating, new_review_text = fetch_cg_review(driver, cg_link, cg_user, current, cg_date)
                except Exception as exc:
                    print(f"    -> ERROR: {exc}")
                    log_check_error("CG", cg_link, exc)
                    errors += 1
                    continue

                if new_status == "__skip__":
                    continue

                updates: dict = {}
                if new_status != current:
                    updates[status_col] = new_status
                new_score_str = str(new_rating) if new_rating is not None else None
                is_boolean_col = current_score.strip().lower() in {"yes", "no", ""}
                if score_col and new_score_str and new_score_str != current_score and not is_boolean_col:
                    updates[score_col] = new_score_str
                current_review_text = data.get("CG Review Text") or ""
                if new_review_text and new_review_text != current_review_text:
                    updates["CG Review Text"] = new_review_text

                if not updates:
                    print(f"    -> {current!r} *{current_score or '-'} (no change)")
                    continue

                if dry_run:
                    sheet_ok = True
                    print(f"    -> {current!r} -> {new_status!r} *{new_rating or '-'} (dry run)")
                else:
                    sheet_ok = update_entry(
                        entry["id"], data, updates,
                        tab=entry.get("tab"), sheet_row_id=entry.get("sheet_row_id"),
                    )
                    if not sheet_ok:
                        sheet_errors += 1
                    print(f"    -> {current!r} -> {new_status!r} *{new_rating or '-'} (sheet: {'ok' if sheet_ok else 'FAILED'})")
                updated += 1
```

- [ ] **Step 4: Add `--dry-run` to `main()`**

Replace `main()` (`scripts/check_cg_status.py` lines 377-394) with the same shape as Task 4's
Step 4, substituting `cg`/`CG`/`check_cg_for_tab` for `ag`/`AG`/`check_ag_for_tab`:

```python
def main() -> None:
    ap = argparse.ArgumentParser(description="Selenium stealth CasinoGuru status checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--country", help="Restrict to one country (full name or ISO-2, e.g. Germany or de)")
    ap.add_argument("--no-headless", dest="headless", action="store_false", help="Show Chrome browser window")
    ap.add_argument("--dry-run", action="store_true", help="Print changes without writing to Supabase")
    ap.set_defaults(headless=True)
    args = ap.parse_args()

    scope = f"tab: {args.tab}" if args.tab else "all tabs"
    if args.country:
        scope += f", country: {args.country}"
    print(f"Loading CG entries ({scope})...")
    result = check_cg_for_tab(args.tab, include_published=True, headless=args.headless,
                               country=args.country, dry_run=args.dry_run)
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']}")
    if args.dry_run:
        print("(dry-run — no writes made)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the full Python suite to confirm no regression**

Run: `cd scripts && python3 -m pytest -q`
Expected: all tests pass (no existing test calls `fetch_cg_review` directly).

- [ ] **Step 6: Do not commit**

---

### Task 6: Wizard of Odds review-text extraction

**Files:**
- Modify: `scripts/check_wo_status.py` — import block (lines 31-40), `fetch_wo_review` (lines 171-219), `check_wo_for_tab` (lines 224-314), `main` (lines 317-329)
- Modify: `scripts/test_check_wo_status.py` — fix the existing 2-tuple unpack (line 97-99)

**Interfaces:**
- Consumes: `extract_review_card_text` from Task 2.
- Produces: `fetch_wo_review` now returns `(status, rating, review_text)` — a 3-tuple, up
  from 2. **Breaking change to an existing test** (`test_fetch_wo_review_does_not_crash_when_user_not_found`)
  — must be fixed in this same task or the suite goes red.

- [ ] **Step 1: Add the import**

In `scripts/check_wo_status.py`, add `extract_review_card_text` to the existing
`from check_review_status import (...)` block (lines 31-40):

```python
from check_review_status import (
    build_driver,
    update_entry,
    _fetch_all,
    BATCH_SIZE,
    DELAY_BETWEEN_BATCHES,
    log_check_error,
    STATUS_FILTER_MAP,
    matches_scope_filters,
    extract_review_card_text,
)
```

- [ ] **Step 2: Fix the existing test for the upcoming 3-tuple return**

In `scripts/test_check_wo_status.py`, replace lines 91-99 with:

```python
def test_fetch_wo_review_does_not_crash_when_user_not_found(monkeypatch):
    # fetch_wo_review referenced an undefined MAX_LOAD_MORE constant, so every
    # real call raised NameError and was counted as an error — a 100% failure
    # rate for WO Check Status confirmed live in production 2026-07-10.
    monkeypatch.setattr(wos.time, 'sleep', lambda *_: None)

    status, rating, review_text = wos.fetch_wo_review(_FakeDriver(), 'https://wizardofodds.com/x', 'NoSuchUser')

    assert (status, rating, review_text) == (None, None, None)
```

- [ ] **Step 3: Run test to verify it fails (against the not-yet-updated function)**

Run: `cd scripts && python3 -m pytest test_check_wo_status.py -k does_not_crash -v`
Expected: FAIL — `fetch_wo_review` still returns a 2-tuple, so unpacking into 3 names raises
`ValueError: not enough values to unpack`. This confirms the test now correctly expects the
post-change shape.

- [ ] **Step 4: Update `fetch_wo_review` to also extract review text**

Replace `fetch_wo_review` (`scripts/check_wo_status.py` lines 171-219) with:

```python
def fetch_wo_review(
    driver: uc.Chrome, wo_link: str, wo_user: str, current_status: str = ""
) -> tuple:
    """Visit the WO casino review page and search player reviews for wo_user.

    Returns (status, rating, review_text):
      ('Published', 1-5 or None, text or None)  — username found in reviews
      ('Removed', None, None)                   — not found, current status was 'published'
      (None, None, None)                         — not found, status was not published (no write)
    """
    url = wo_link.strip()
    if not url.startswith("http"):
        url = f"https://{url}"
    try:
        driver.get(url)
    except Exception:
        pass

    time.sleep(POST_LOAD_SLEEP)

    current_url = driver.current_url.lower()
    if "wizardofodds.com" not in current_url:
        print(f"    redirected off-site -> {driver.current_url}")
        return ("Removed", None, None)

    wo_user_lower = wo_user.lower()

    # No page cap — page all the way to the true last "Load More" before
    # concluding not-found, same reasoning as AG/CG (see check_ag_status.py):
    # a fixed cap can wrongly call a review "not found" when it's really just
    # further back in a long review list.
    while True:
        html = driver.page_source
        html_lower = html.lower()

        if wo_user_lower in html_lower:
            idx = html_lower.find(wo_user_lower)
            context = html[max(0, idx - 500) : idx + 1500]
            rating = _extract_rating_from_context(context)
            try:
                review_text = extract_review_card_text(driver, wo_user_lower)
            except Exception as exc:
                print(f"    [text] extraction error: {exc}")
                review_text = None
            return ("Published", rating, review_text)

        clicked = _try_load_more(driver)
        if not clicked:
            break
        time.sleep(LOAD_MORE_SLEEP)

    if current_status.strip().lower() == "published":
        return ("Removed", None, None)
    return (None, None, None)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd scripts && python3 -m pytest test_check_wo_status.py -k does_not_crash -v`
Expected: PASS.

- [ ] **Step 6: Update `check_wo_for_tab`'s signature and per-entry loop**

In `scripts/check_wo_status.py`, add `dry_run: bool = False` to `check_wo_for_tab`'s signature
(lines 224-233):

```python
def check_wo_for_tab(
    tab: Optional[str] = None,
    include_published: bool = True,
    headless: bool = True,
    status_filter: Optional[str] = None,
    brands: Optional[list] = None,
    agent: Optional[str] = None,
    proxy: Optional[str] = None,
    country: Optional[str] = None,
    dry_run: bool = False,
) -> dict:
```

Replace the block from `try:\n                    new_status, new_rating = fetch_wo_review(...)`
through `updated += 1` (original lines 263-306) with:

```python
                try:
                    new_status, new_rating, new_review_text = fetch_wo_review(driver, wo_link, wo_user, current)
                except Exception as exc:
                    print(f"    -> ERROR: {exc}")
                    log_check_error("WO", wo_link, exc)
                    errors += 1
                    continue

                if new_status is None:
                    # Username not found on WO page.
                    # If status is "Done" and >= 1 day old → mark Refused.
                    if current.strip().lower() == "done":
                        wo_date = _val(data, WO_DATE_COLS)
                        if wo_date and _older_than(wo_date, REFUSED_AFTER_DAYS):
                            new_status = "Refused"
                            print(f"    -> Done for >{REFUSED_AFTER_DAYS}d, not found -> Refused")
                        else:
                            age = f"date={wo_date}" if wo_date else "no date"
                            print(f"    -> Done but too recent ({age}) — skipping")
                            continue
                    else:
                        print(f"    -> not found / no status change needed")
                        continue

                updates: dict = {}
                if new_status != current:
                    updates[status_col] = new_status
                new_score_str = str(new_rating) if new_rating is not None else None
                is_boolean_col = current_score.strip().lower() in {"yes", "no", ""}
                if score_col and new_score_str and new_score_str != current_score and not is_boolean_col:
                    updates[score_col] = new_score_str
                current_review_text = data.get("WO Review Text") or ""
                if new_review_text and new_review_text != current_review_text:
                    updates["WO Review Text"] = new_review_text

                if not updates:
                    print(f"    -> {current!r} *{current_score or '-'} (no change)")
                    continue

                if dry_run:
                    sheet_ok = True
                    print(f"    -> {current!r} -> {new_status!r} *{new_rating or '-'} (dry run)")
                else:
                    sheet_ok = update_entry(
                        entry["id"], data, updates,
                        tab=entry.get("tab"), sheet_row_id=entry.get("sheet_row_id"),
                    )
                    if not sheet_ok:
                        sheet_errors += 1
                    print(f"    -> {current!r} -> {new_status!r} *{new_rating or '-'} (sheet: {'ok' if sheet_ok else 'FAILED'})")
                updated += 1
```

- [ ] **Step 7: Add `--dry-run` to `main()`**

Replace `main()` (`scripts/check_wo_status.py` lines 317-329) with:

```python
def main() -> None:
    ap = argparse.ArgumentParser(description="Selenium stealth Wizard of Odds status checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="Print changes without writing to Supabase")
    args = ap.parse_args()

    scope = f"tab: {args.tab}" if args.tab else "all tabs"
    print(f"Loading WO entries ({scope})...")
    result = check_wo_for_tab(args.tab, include_published=True, headless=args.headless, dry_run=args.dry_run)
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']}")
    if args.dry_run:
        print("(dry-run — no writes made)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 8: Run the full Python suite to confirm no regression**

Run: `cd scripts && python3 -m pytest -q`
Expected: all tests pass, including the fixed WO test.

- [ ] **Step 9: Do not commit**

---

### Task 7: Local validation against real live pages (no code changes)

**Files:** none modified — this task runs the scripts built in Tasks 3-6.

**Interfaces:** none (manual verification task).

- [ ] **Step 1: TP dry-run against one real tab**

Run: `cd scripts && python3 check_review_status.py --tab "TP Brand Injection" --dry-run`

Read the console output for a handful of entries. For each one that reaches "Published",
confirm the printed status line looks right; if `parse_review_text` is silently returning
`None` for entries that clearly have a `__NEXT_DATA__` blob, temporarily add a one-line debug
print inside `_review_text_from_next_data` (right after `if not review: return None`) dumping
`sorted(review.keys())` for one real entry, rerun, note the real key name, then fix the
priority order in `_review_text_from_next_data` (Task 3, Step 3) to put it first. Remove the
debug print once confirmed.

- [ ] **Step 2: AG/CG/WO dry-run against one real tab each**

Run each of:
```bash
cd scripts
python3 check_ag_status.py --tab "Rooster Partners" --dry-run --no-headless
python3 check_cg_status.py --tab "Rooster Partners" --dry-run --no-headless
python3 check_wo_status.py --tab "Wizard of Odds" --dry-run
```

For each "Published" result, inspect the printed extracted text (add a temporary
`print(f"    [text] {review_text!r}")` right after each `try/except` block calling
`extract_review_card_text` in `fetch_ag_review`/`fetch_cg_review`/`fetch_wo_review` if the
existing print statements don't already surface it clearly enough). Check for:
- Clean review body text, not truncated mid-sentence or bleeding into a timestamp/"helpful"-count widget.
- If text is `None` when a review clearly has visible content, or clearly wrong/noisy, adjust
  `min_len`/`max_len`/`max_ancestors` in `extract_review_card_text` (Task 2, Step 3) and rerun.
- Confirm CasinoGuru's `tooltip-user-row` exclusion still works — pick one entry known to have
  triggered the historical liker-tooltip false positive if one is still identifiable, otherwise
  confirm CG's returned text never contains "helpful" widget phrasing.

Remove any temporary debug prints once satisfied.

- [ ] **Step 3: One real (non-dry-run) local pass against a small scope**

Pick one small, low-risk tab/brand scope (e.g. a single `--tab` with few entries). Run each
script WITHOUT `--dry-run`:

```bash
cd scripts
python3 check_review_status.py --tab "TP Brand Injection" --headless
python3 check_ag_status.py --tab "Rooster Partners" --no-headless
python3 check_cg_status.py --tab "Rooster Partners" --no-headless
python3 check_wo_status.py --tab "Wizard of Odds"
```

- [ ] **Step 4: Confirm real writes landed via a direct Supabase read**

For at least one entry from each platform run above, query Supabase directly (e.g. via the
Supabase SQL editor or a `curl` against the REST API using `SUPABASE_SERVICE_ROLE_KEY` from
`scripts/.env`) for that row's `id` and confirm `data->>'TP Review Text'` /
`data->>'AG Review Text'` / `data->>'CG Review Text'` / `data->>'WO Review Text'` holds the
same text that was printed to the console, and that no other field in `data` changed
unexpectedly.

- [ ] **Step 5: Report findings, do not deploy**

Summarize what was confirmed (which platforms extract clean text reliably, any remaining
noise/edge cases) for the user. Per standing instruction: no EC2 deploy, no commit, no push —
this stays local pending explicit user review and go-ahead.

---

## Self-Review Notes (for the plan author, not a task)

- **Spec coverage:** Scope (fetch+store only) ✅ Task 1-6. Data model (4 jsonb keys, no
  migration) ✅ Task 3-6. Frontend accessor ✅ Task 1. Extraction approach per platform ✅
  Task 2-6. Write path / re-fetch-preserves-last-known ✅ Task 3-6 (omit-from-updates pattern).
  `--dry-run` parity ✅ Task 4-6 (Task 3's TP already had it). Validation & rollout ✅ Task 7.
  No commit/push/deploy ✅ every task's last step.
- **Placeholder scan:** no TBD/TODO; the two "confirm live" points (TP's JSON key name,
  AG/CG/WO's length thresholds) are concrete, actionable discovery steps in Task 7, not vague
  placeholders — each has a specific method (dump keys, adjust named constants) and a specific
  file/line to fix.
- **Type consistency:** `fetch_status`/`fetch_ag_review`/`fetch_cg_review`/`fetch_wo_review`
  all consistently return `(status, rating, review_text)` 3-tuples. `extract_review_card_text`
  and `_xpath_literal` signatures are identical between their Task 2 definition and every
  Task 3-6 call site. Corrected during planning: the spec's claim of "no automated test suite
  exists" was wrong — a real pytest suite (`scripts/test_check_*.py`, 63 passing tests) already
  exists; Task 2/3/6 add to it, and Task 6 fixes a test that would otherwise break.
