# Region-Aware Proxy (AG/CG Geo Checks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AG/CG status checks exit from each brand's target country by selecting the matching enigmaproxy HTTP residential proxy, driven by a new `Country` column.

**Architecture:** A new pure module `scripts/geo_proxy.py` maps a brand's `Country` to an enigmaproxy `host:port:user:pass` HTTP proxy string (login shared, password per-country from env). The AG and CG scrapers sort entries by that proxy and feed it into the existing `build_driver(proxy=…)` machinery, which already rebuilds Chrome when the proxy changes. A geo self-check logs the actual exit country per country group. TP is untouched.

**Tech Stack:** Python 3 · Selenium/undetected-chromedriver · pytest · enigmaproxy (residential HTTP proxy via the user's GoLogin account)

## Global Constraints

- enigmaproxy answers over **HTTP** at `resi.enigmaproxy.net:12321`, shared login `0048277fc210`, **unique opaque password per country** (no derivable pattern). Confirmed via curl (German cred → German residential IP).
- `build_driver(proxy="host:port:user:pass")` treats a 4-part string as an **HTTP** proxy via its proxy-auth extension. Always pass enigma as 4-part.
- `Country` column holds **full country names** (`Germany`, `United Kingdom`), blank allowed.
- Any unresolved/blank/unconfigured country → return `""` (no proxy); **never hard-fail**.
- Scope is **AG + CG only**. Do not modify TP logic in `check_review_status.py`'s own scrape loop.
- `build_driver()` version pin is `version_main=149` — do not change.
- Importing `check_review_status` requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in env at module load. `geo_proxy.py` must NOT import `check_review_status`, so it stays unit-testable without Supabase creds.
- Verification for the scraper changes is a real run/smoke test (no `tsc`); pure-function changes are verified with `python -m pytest`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `scripts/geo_proxy.py` | Pure: `COUNTRY_CODE`, `country_code_for_entry`, `geo_proxy_for_entry`, `_parse_country`; + selenium `detect_exit_country` (lazy import) |
| Create | `scripts/test_geo_proxy.py` | pytest unit tests for the pure functions |
| Modify | `scripts/check_ag_status.py` | Use `geo_proxy_for_entry`, sort entries by proxy, geo self-check |
| Modify | `scripts/check_cg_status.py` | Add proxy-aware restart (AG pattern) + same integration |
| Modify | `scripts/.env.example` | Document `ENIGMA_*` vars |
| Modify | `docs/ec2-scraper-runbook.md` | Document enigma setup + per-country password extraction |

---

### Task 1: Pure geo-proxy resolver — `scripts/geo_proxy.py`

**Files:**
- Create: `scripts/geo_proxy.py`
- Test: `scripts/test_geo_proxy.py`

**Interfaces:**
- Produces:
  - `COUNTRY_CODE: dict[str, str]` (full name → ISO-2 lowercase)
  - `country_code_for_entry(data: dict) -> Optional[str]`
  - `geo_proxy_for_entry(data: dict) -> str` (`"host:port:login:pw"` or `""`)
- Consumed by Tasks 3 & 4.

- [ ] **Step 1: Write the failing test — `scripts/test_geo_proxy.py`**

```python
import importlib
import geo_proxy


def reload_with_env(monkeypatch, **env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    return importlib.reload(geo_proxy)


def _base_env(monkeypatch):
    monkeypatch.setenv("ENIGMA_HOST", "resi.enigmaproxy.net")
    monkeypatch.setenv("ENIGMA_PORT", "12321")
    monkeypatch.setenv("ENIGMA_LOGIN", "0048277fc210")
    monkeypatch.setenv("ENIGMA_PW_DE", "pw-de")


def test_configured_country_returns_proxy(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": "Germany"}) == \
        "resi.enigmaproxy.net:12321:0048277fc210:pw-de"


def test_country_name_is_case_insensitive(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": "GERMANY"}) == \
        "resi.enigmaproxy.net:12321:0048277fc210:pw-de"


def test_iso_code_accepted(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": "de"}) == \
        "resi.enigmaproxy.net:12321:0048277fc210:pw-de"


def test_blank_country_returns_empty(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": ""}) == ""
    assert geo_proxy.geo_proxy_for_entry({}) == ""


def test_unknown_country_returns_empty(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": "Atlantis"}) == ""


def test_missing_password_returns_empty(monkeypatch):
    _base_env(monkeypatch)
    # GB has no ENIGMA_PW_GB set
    assert geo_proxy.geo_proxy_for_entry({"Country": "United Kingdom"}) == ""


def test_country_code_for_entry(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.country_code_for_entry({"Country": "Germany"}) == "de"
    assert geo_proxy.country_code_for_entry({"Country": ""}) is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd scripts && python -m pytest test_geo_proxy.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'geo_proxy'`.
(If pytest is missing: `pip install pytest`.)

- [ ] **Step 3: Create `scripts/geo_proxy.py` with the pure functions**

```python
#!/usr/bin/env python3
"""
geo_proxy.py — resolve a brand's Country to an enigmaproxy HTTP proxy string.

Pure & dependency-light on purpose (imports only stdlib at module load) so it is
unit-testable without Supabase creds or selenium. enigmaproxy answers over HTTP
at resi.enigmaproxy.net:12321 with a shared login and a per-country password
supplied via ENIGMA_PW_<CC> env vars.

Env vars (set in EC2 ~/.env):
    ENIGMA_HOST   e.g. resi.enigmaproxy.net
    ENIGMA_PORT   e.g. 12321
    ENIGMA_LOGIN  e.g. 0048277fc210
    ENIGMA_PW_DE, ENIGMA_PW_GB, ...  one per country in use
"""

import os
from typing import Optional

# Full country name → ISO-3166-1 alpha-2 (lowercase). Extend as the Sheet's
# `Country` column gains new countries (must match the GoLogin saved proxies).
COUNTRY_CODE: dict[str, str] = {
    "germany": "de",
    "united kingdom": "gb",
    "uk": "gb",
    "great britain": "gb",
    "switzerland": "ch",
    "denmark": "dk",
    "italy": "it",
    "australia": "au",
    "oman": "om",
    "kuwait": "kw",
    "bahrain": "bh",
    "qatar": "qa",
    "saudi arabia": "sa",
    "united arab emirates": "ae",
    "uae": "ae",
    "norway": "no",
    "austria": "at",
    "new zealand": "nz",
    "canada": "ca",
    "netherlands": "nl",
    "france": "fr",
    "spain": "es",
    "sweden": "se",
    "finland": "fi",
    "ireland": "ie",
    "portugal": "pt",
    "united states": "us",
    "usa": "us",
}

COUNTRY_COLS = ["Country", "Region"]


def _country_value(data: dict) -> str:
    for c in COUNTRY_COLS:
        v = data.get(c)
        if v and str(v).strip():
            return str(v).strip()
    return ""


def country_code_for_entry(data: dict) -> Optional[str]:
    """Return the ISO-2 code for this entry's Country, or None if blank/unknown."""
    raw = _country_value(data)
    if not raw:
        return None
    c = raw.lower()
    if len(c) == 2 and c.isalpha():
        return c
    return COUNTRY_CODE.get(c)


def geo_proxy_for_entry(data: dict) -> str:
    """Return 'host:port:login:password' for this entry's Country, or '' to fall
    back to no geo proxy (blank/unknown country, or password not configured)."""
    cc = country_code_for_entry(data)
    if not cc:
        return ""
    host = os.environ.get("ENIGMA_HOST", "")
    port = os.environ.get("ENIGMA_PORT", "")
    login = os.environ.get("ENIGMA_LOGIN", "")
    pw = os.environ.get(f"ENIGMA_PW_{cc.upper()}", "")
    if not (host and port and login and pw):
        if pw == "":
            print(f"  [geo] no ENIGMA_PW_{cc.upper()} configured — skipping proxy for {cc!r}")
        return ""
    return f"{host}:{port}:{login}:{pw}"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd scripts && python -m pytest test_geo_proxy.py -v`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/geo_proxy.py scripts/test_geo_proxy.py
git commit -m "feat: add geo_proxy resolver (Country -> enigma HTTP proxy)"
```

---

### Task 2: Geo self-check helpers — extend `scripts/geo_proxy.py`

**Files:**
- Modify: `scripts/geo_proxy.py`
- Test: `scripts/test_geo_proxy.py`

**Interfaces:**
- Produces:
  - `_parse_country(text: str) -> Optional[str]` (pure; extract ISO-2 from geo-endpoint JSON)
  - `detect_exit_country(driver) -> Optional[str]` (selenium; lazy `By` import)
- Consumed by Tasks 3 & 4 (the per-country exit-country log line).

- [ ] **Step 1: Add the failing test for `_parse_country`**

Append to `scripts/test_geo_proxy.py`:

```python
def test_parse_country_ipinfo():
    assert geo_proxy._parse_country('{"ip":"1.2.3.4","country":"DE"}') == "de"


def test_parse_country_ipapi():
    assert geo_proxy._parse_country('{"countryCode":"GB","query":"1.2.3.4"}') == "gb"


def test_parse_country_garbage_returns_none():
    assert geo_proxy._parse_country("not json and no country") is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd scripts && python -m pytest test_geo_proxy.py -k parse_country -v`
Expected: FAIL — `AttributeError: module 'geo_proxy' has no attribute '_parse_country'`.

- [ ] **Step 3: Add `_parse_country` and `detect_exit_country` to `geo_proxy.py`**

Add `import json` and `import re` near the top (after `import os`), then append:

```python
GEO_ENDPOINTS = [
    "https://ipinfo.io/json",
    "https://ifconfig.co/json",
    "http://ip-api.com/json",
]


def _parse_country(text: str) -> Optional[str]:
    """Pull a 2-letter ISO country code out of a geo-endpoint JSON response."""
    try:
        obj = json.loads(text)
        for f in ("country", "country_iso", "countryCode"):
            v = obj.get(f)
            if isinstance(v, str) and len(v) == 2 and v.isalpha():
                return v.lower()
    except (ValueError, TypeError, AttributeError):
        pass
    m = (re.search(r'"countryCode"\s*:\s*"([A-Za-z]{2})"', text)
         or re.search(r'"country(?:_iso)?"\s*:\s*"([A-Za-z]{2})"', text))
    return m.group(1).lower() if m else None


def detect_exit_country(driver) -> Optional[str]:
    """Navigate `driver` to an IP-geolocation endpoint and return its ISO-2
    exit country, or None. Selenium imported lazily so this module stays
    importable (and unit-testable) without selenium installed."""
    import time
    from selenium.webdriver.common.by import By
    for url in GEO_ENDPOINTS:
        try:
            driver.get(url)
            time.sleep(2.0)
            body = driver.find_element(By.TAG_NAME, "body").text
            cc = _parse_country(body)
            if cc:
                return cc
        except Exception:
            continue
    return None
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd scripts && python -m pytest test_geo_proxy.py -v`
Expected: all tests PASS (10 total).

- [ ] **Step 5: Commit**

```bash
git add scripts/geo_proxy.py scripts/test_geo_proxy.py
git commit -m "feat: add geo self-check (detect_exit_country) to geo_proxy"
```

---

### Task 3: Integrate into AG scraper — `scripts/check_ag_status.py`

**Files:**
- Modify: `scripts/check_ag_status.py`

**Interfaces:**
- Consumes: `geo_proxy_for_entry`, `country_code_for_entry`, `detect_exit_country` from `geo_proxy`.

- [ ] **Step 1: Add the import**

After the `from check_review_status import (...)` block (around line 35-45), add:

```python
from geo_proxy import geo_proxy_for_entry, country_code_for_entry, detect_exit_country
```

- [ ] **Step 2: Sort eligible entries by proxy in `load_ag_entries`**

In `load_ag_entries` (lines 90-113), immediately before the final `return out`, insert:

```python
    # Group brands by their resolved geo proxy so each country = one Chrome launch.
    out.sort(key=lambda r: geo_proxy_for_entry(r.get("data") or {}))
```

- [ ] **Step 3: Use the geo proxy for restart decisions**

In `check_ag_for_tab`, replace the current line 264:

```python
                entry_proxy = proxy_for_entry(entry.get("data") or {})
```

with:

```python
                _edata = entry.get("data") or {}
                entry_proxy = geo_proxy_for_entry(_edata) or proxy_for_entry(_edata)
```

- [ ] **Step 4: Add the geo self-check right after a driver (re)start**

Inside the `if restart:` block, immediately after `current_proxy = entry_proxy` (line 279), add:

```python
                    expected_cc = country_code_for_entry(_edata)
                    if expected_cc and entry_proxy:
                        got = detect_exit_country(driver)
                        if got and got != expected_cc:
                            print(f"  [geo] WARNING expected {expected_cc!r} but proxy exited {got!r}")
                        else:
                            print(f"  [geo] exit country {got or 'unknown'!r} (target {expected_cc!r})")
```

- [ ] **Step 5: Syntax check**

Run: `cd scripts && python -m py_compile check_ag_status.py`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add scripts/check_ag_status.py
git commit -m "feat: AG scraper uses Country-based enigma proxy + geo self-check"
```

---

### Task 4: Integrate into CG scraper — `scripts/check_cg_status.py`

**Files:**
- Modify: `scripts/check_cg_status.py`

**Note:** CG currently builds the driver once (line 201) and only restarts on `CHROME_RESTART_EVERY` (lines 208-214). This task adds the same proxy-aware restart loop AG already has.

**Interfaces:**
- Consumes: `geo_proxy_for_entry`, `country_code_for_entry`, `detect_exit_country` from `geo_proxy`.

- [ ] **Step 1: Add the import**

After the `from check_review_status import (...)` block (lines 31-40), add:

```python
from geo_proxy import geo_proxy_for_entry, country_code_for_entry, detect_exit_country
```

- [ ] **Step 2: Sort eligible entries by proxy in `load_cg_entries`**

In `load_cg_entries`, immediately before its final `return out`, insert:

```python
    out.sort(key=lambda r: geo_proxy_for_entry(r.get("data") or {}))
```

- [ ] **Step 3: Replace the driver setup + restart block in `check_cg_for_tab`**

Replace the current lines 200-214:

```python
    checked = updated = errors = sheet_errors = 0
    driver = build_driver(headless=headless)
    try:
        for i in range(0, total, BATCH_SIZE):
            batch = entries[i : i + BATCH_SIZE]
            for entry in batch:
                checked += 1

                if checked > 1 and (checked - 1) % CHROME_RESTART_EVERY == 0:
                    print(f"  ... restarting Chrome at entry {checked}/{total}\n")
                    try:
                        driver.quit()
                    except Exception:
                        pass
                    driver = build_driver(headless=headless)
```

with:

```python
    checked = updated = errors = sheet_errors = 0
    driver = None
    current_proxy = None
    try:
        for i in range(0, total, BATCH_SIZE):
            batch = entries[i : i + BATCH_SIZE]
            for entry in batch:
                checked += 1
                _edata = entry.get("data") or {}
                entry_proxy = geo_proxy_for_entry(_edata) or proxy_for_entry(_edata)

                restart = (
                    driver is None
                    or entry_proxy != current_proxy
                    or (checked > 1 and (checked - 1) % CHROME_RESTART_EVERY == 0)
                )
                if restart:
                    if driver:
                        print(f"  ... restarting Chrome at entry {checked}/{total} (proxy={entry_proxy or 'none'})\n")
                        try:
                            driver.quit()
                        except Exception:
                            pass
                    driver = build_driver(headless=headless, proxy=entry_proxy)
                    current_proxy = entry_proxy
                    expected_cc = country_code_for_entry(_edata)
                    if expected_cc and entry_proxy:
                        got = detect_exit_country(driver)
                        if got and got != expected_cc:
                            print(f"  [geo] WARNING expected {expected_cc!r} but proxy exited {got!r}")
                        else:
                            print(f"  [geo] exit country {got or 'unknown'!r} (target {expected_cc!r})")
```

- [ ] **Step 4: Add `proxy_for_entry` to the CG import block**

CG does not currently import `proxy_for_entry`. In the `from check_review_status import (...)` block (lines 31-40), add `proxy_for_entry,` to the imported names.

- [ ] **Step 5: Syntax check**

Run: `cd scripts && python -m py_compile check_cg_status.py`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add scripts/check_cg_status.py
git commit -m "feat: CG scraper proxy-aware restart + Country-based enigma proxy"
```

---

### Task 5: Document config — `.env.example` + runbook

**Files:**
- Modify: `scripts/.env.example`
- Modify: `docs/ec2-scraper-runbook.md`

- [ ] **Step 1: Append the enigma vars to `scripts/.env.example`**

Add to the end of `scripts/.env.example`:

```
# ─── enigmaproxy residential proxy (geo-targeted AG/CG checks) ───
# Shared connection; one password per country. enigmaproxy answers over HTTP.
ENIGMA_HOST=resi.enigmaproxy.net
ENIGMA_PORT=12321
ENIGMA_LOGIN=0048277fc210
# One line per country in the Sheet's `Country` column (ISO-2, uppercase).
# Get each password from the matching saved proxy in the GoLogin app.
ENIGMA_PW_DE=germany-proxy-password
ENIGMA_PW_GB=uk-proxy-password
```

- [ ] **Step 2: Add an enigma section to the runbook**

Add a new section to `docs/ec2-scraper-runbook.md` (after the "Updating the .env" section):

```markdown
## Geo Proxies (enigmaproxy) for AG/CG

AG/CG checks must exit from each brand's country (the `Country` column). They use
enigmaproxy residential proxies over HTTP. Add these to `~/.env`:

    ENIGMA_HOST=resi.enigmaproxy.net
    ENIGMA_PORT=12321
    ENIGMA_LOGIN=0048277fc210
    ENIGMA_PW_DE=<germany password>
    ENIGMA_PW_GB=<uk password>
    # ...one ENIGMA_PW_<CC> per country in use

**Where the passwords come from:** GoLogin app → open the country's "TP Test"
profile → Proxy tab → reveal the Password. Login is shared (`0048277fc210`);
each country has its own password.

**Add a new country:** add its full name → ISO-2 to `COUNTRY_CODE` in
`scripts/geo_proxy.py`, then add an `ENIGMA_PW_<CC>` line here.

**Verify a country works:**

    python3 ~/proxy_geo_test.py --provider enigma --country Germany --baseline

(Requires `PROXY_ENIGMA=resi.enigmaproxy.net:12321:0048277fc210:<pw>` set, or test
directly with curl: `curl -x "http://0048277fc210:<pw>@resi.enigmaproxy.net:12321" https://ipinfo.io/json`)
```

- [ ] **Step 3: Commit**

```bash
git add scripts/.env.example docs/ec2-scraper-runbook.md
git commit -m "docs: document enigma geo-proxy env vars + runbook section"
```

---

### Task 6: Operational rollout (on EC2)

**Not code** — the live steps to make it work. Do these after Tasks 1–5 are merged and the updated scripts are on EC2.

- [ ] **Step 1: Confirm the `Country` column exists** in the Google Sheet and is populated with full country names for the brands that need geo checks (developer task).

- [ ] **Step 2: Upload the new/updated scripts to EC2** (from local terminal; substitute key/IP, or paste via EC2 Instance Connect):

```bash
scp -i <key.pem> scripts/geo_proxy.py        ec2-user@<ip>:~/geo_proxy.py
scp -i <key.pem> scripts/check_ag_status.py  ec2-user@<ip>:~/check_ag_status.py
scp -i <key.pem> scripts/check_cg_status.py  ec2-user@<ip>:~/check_cg_status.py
```

- [ ] **Step 3: Add the `ENIGMA_*` vars to EC2 `~/.env`** (append; pull each password from the GoLogin saved proxy for that country):

```bash
cat >> ~/.env << 'EOF'
ENIGMA_HOST=resi.enigmaproxy.net
ENIGMA_PORT=12321
ENIGMA_LOGIN=0048277fc210
ENIGMA_PW_DE=<germany password>
EOF
```

- [ ] **Step 4: Smoke test one German brand (headless) and confirm the geo line:**

```bash
python3 ~/check_ag_status.py --tab "<a tab with a German brand>"
```
Expected: a `[geo] exit country 'de' (target 'de')` line, the AG page renders the German view, and username search resolves. Repeat with `check_cg_status.py`.

- [ ] **Step 5: Restart the status server** so the dashboard button uses the new env + scripts:

```bash
pkill -f status_server
nohup python3 ~/status_server.py --port 5001 > ~/server.log 2>&1 &
```

- [ ] **Step 6: Click "Check Status" on a German brand in the dashboard** and confirm reviews resolve correctly.

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| New `Country` column drives geo | Task 1 (`country_code_for_entry`) + Task 6 Step 1 |
| Country → enigma HTTP proxy string | Task 1 (`geo_proxy_for_entry`) |
| Shared login, per-country password from env | Task 1 + Task 5 |
| Blank/unknown/unconfigured → no proxy, no fail | Task 1 (returns `""`) + tests |
| One Chrome per country (group by proxy) | Tasks 3 & 4 (`out.sort` + restart-on-proxy-change) |
| CG gains proxy-aware restart | Task 4 Step 3 |
| Geo self-check logs exit country | Task 2 + Tasks 3/4 |
| AG + CG only, TP untouched | No change to `check_review_status` scrape loop |
| `.env.example` + runbook documented | Task 5 |
| Live rollout (env vars, smoke test) | Task 6 |

### Placeholder scan

Passwords shown as `<…>` placeholders are intentional (real secrets must not be committed); all code steps contain complete code.

### Type consistency

- `geo_proxy_for_entry(data) -> str`, `country_code_for_entry(data) -> Optional[str]`, `detect_exit_country(driver) -> Optional[str]` — names/signatures identical across definition (Tasks 1–2) and call sites (Tasks 3–4).
- AG and CG both call `build_driver(headless=…, proxy=entry_proxy)` with a 4-part HTTP string from `geo_proxy_for_entry` — matches the Global Constraint.
- `_edata` is defined before first use in both AG (Task 3 Step 3) and CG (Task 4 Step 3) loops.
```
