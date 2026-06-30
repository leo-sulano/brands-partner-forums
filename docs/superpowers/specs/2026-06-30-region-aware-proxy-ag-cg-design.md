# Region-Aware Proxy Selection for AG/CG Status Checks — Design

**Date:** 2026-06-30
**Status:** Approved (design); de-risked; pending implementation plan

## Problem

The "Check Status" button scrapes AskGamblers (AG) and CasinoGuru (CG) review
pages to detect whether a brand's review is Published or Removed. The scraper
runs on an EC2 instance in Singapore (`ap-southeast-1`). AG and CG serve
**region-specific** content based on the visitor's IP geolocation, so a
Singapore-sourced request sees the wrong regional view of a brand's reviews —
e.g. a brand that should be checked as **Germany** is checked as Singapore, and
the expected reviews never appear.

### Confirmed root cause (2026-06-30 investigation)

The EC2 box's `~/.env` contained **only** `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `CHECK_STATUS_TOKEN` — **no proxy credentials
at all.** The scraper's `proxy_for_entry()` looks up env vars
(`PROXY_PROXYLITE` / `PROXY_SPYDERPROXY` / `PROXY_ENIGMA`), found none, and
returned `""`, so Chrome launched **with no proxy** on every run. Every AG/CG
check therefore went out from the Singapore IP. This is the actual cause of the
geo problem — not bot detection, and not a code defect.

The country proxies *do* exist: they live in the user's **GoLogin** account as
one saved proxy per country (`resi.enigmaproxy.net`), but they were never copied
into EC2's `~/.env`, and the GoLogin profiles were being run manually (clicking
"Run") separately from the automated EC2 scraper.

## Goal

Make each AG/CG check appear to originate from the brand's target country by
selecting the matching enigmaproxy residential proxy per brand, driven by a new
`Country` column. Keep the existing EC2 host, the existing Selenium stack, and
the existing always-available "Check Status" button.

## Non-Goals

- **No GoLogin browser integration.** enigmaproxy answers over **HTTP** (proven
  via `curl` — see "De-risking results"), so the existing Chrome + HTTP-proxy
  machinery works directly. Running GoLogin's Orbita browser on EC2 is the
  documented fallback only (see "Rejected / fallback alternatives").
- **No Trustpilot (TP) changes.** Scope is AG + CG only; TP stays as-is to limit
  blast radius. Can be extended later if TP proves geo-sensitive.
- **No frontend changes.** Region is data-driven per brand, so the existing
  Check Status button works unchanged.

## De-risking results (proven before writing this plan)

Run from the EC2 box with the Germany proxy credentials:

```
curl -x "http://0048277fc210:<pw>@resi.enigmaproxy.net:12321" https://ipinfo.io/json
curl -x "socks5h://0048277fc210:<pw>@resi.enigmaproxy.net:12321" https://ipinfo.io/json
```

Both returned a genuine German residential IP (`83.135.178.78`, Baden-
Württemberg, AS8881 1&1 Versatel, `"country":"DE"`). Key takeaways:

1. enigmaproxy serves **both HTTP and SOCKS5** on `resi.enigmaproxy.net:12321`.
   HTTP support means the existing scraper works without a SOCKS5 bridge.
2. The Germany credential exits in Germany — the country is **baked into each
   saved proxy**, not chosen via a username parameter.
3. The **login is shared** (`0048277fc210`); the **password is unique and opaque
   per country** with no derivable country token. So we store one password per
   country (no parameterization possible).

## Approach (chosen)

**Region-aware HTTP residential proxies on the existing stack.** Keep EC2, keep
`undetected-chromedriver`. Add a per-brand `Country` column and resolve it to the
matching enigmaproxy HTTP credential, which the existing `build_driver(proxy=…)`
machinery already consumes via its proxy-auth extension.

### 1. Data model

- New per-brand column **`Country`** in the Google Sheet, synced into
  `entries.data` like every other column.
- Holds the target country as a human-readable full name, e.g. `Germany`,
  `United Kingdom`.
- **Blank is allowed** and must not cause a failure.

### 2. Country → proxy resolution (Python)

New helper in `scripts/check_review_status.py`:

```python
def geo_proxy_for_entry(data: dict) -> str:
    """Return an enigmaproxy HTTP proxy 'host:port:user:pass' for this entry's
    Country, or '' to fall back to existing behavior (no proxy)."""
```

- Read the `Country` value, normalize to ISO-3166-1 alpha-2 via a small
  `COUNTRY_CODE` map (`Germany → de`, `United Kingdom → gb`, …).
- Look up that country's password from `ENIGMA_PW_<CC>` (e.g. `ENIGMA_PW_DE`).
- Build `f"{ENIGMA_HOST}:{ENIGMA_PORT}:{ENIGMA_LOGIN}:{password}"` —
  the 4-part `host:port:user:pass` shape `build_driver` treats as an HTTP proxy.

**Fallback:** blank `Country`, a country missing from `COUNTRY_CODE`, or a
missing `ENIGMA_PW_<CC>` → return `""` (no proxy; current behavior). Log a clear
warning for a present-but-unconfigured country; never hard-fail.

### 3. Driver lifecycle — already handles per-proxy restart

`check_ag_for_tab` already rebuilds Chrome whenever the per-entry proxy changes
(`entry_proxy != current_proxy`) and on `CHROME_RESTART_EVERY`. We:

1. Swap the `entry_proxy = proxy_for_entry(...)` line for
   `entry_proxy = geo_proxy_for_entry(data) or proxy_for_entry(data)`.
2. **Sort eligible entries by resolved proxy** in `load_*_entries` so each
   country's brands are processed consecutively → one Chrome launch per country
   instead of thrashing.

`check_cg_for_tab` currently lacks the proxy-aware restart logic (it only rebuilds
on `CHROME_RESTART_EVERY`); this plan adds the same `entry_proxy`/`current_proxy`
restart pattern that AG already has.

### 4. Wiring

- `scripts/check_ag_status.py` and `scripts/check_cg_status.py` use
  `geo_proxy_for_entry` for proxy selection and sort entries by proxy.
- **Scope is AG + CG only** — TP (`check_review_status.py`'s own loop) is
  untouched.

### 5. Config (EC2 `~/.env`)

New variables, added to EC2's `~/.env` (and documented in `scripts/.env.example`
and `docs/ec2-scraper-runbook.md`):

```
ENIGMA_HOST=resi.enigmaproxy.net
ENIGMA_PORT=12321
ENIGMA_LOGIN=0048277fc210
ENIGMA_PW_DE=<germany password>
ENIGMA_PW_GB=<uk password>
# …one ENIGMA_PW_<CC> line per country that appears in the Country column
```

Only countries that actually appear in the `Country` column need a password line.

### 6. Verification built in

- **Geo self-check:** before scraping each country group, the driver hits a
  lightweight "what country is my IP" endpoint through the proxy and logs the
  detected country, asserting it matches the target. Turns "did the proxy land in
  Germany?" into a printed line.
- **Manual smoke test:** run one German brand through AG and CG and confirm the
  German regional view renders and the username search resolves.
- `scripts/proxy_geo_test.py` (already committed) remains the standalone tool for
  validating a provider/credential's exit country.

## Data Flow

```
Dashboard "Check Status"
  → Supabase Edge Function (proxy-check-status)
    → EC2 status_server.py (Flask: /check-ag-status, /check-cg-status)
      → check_ag_status.py / check_cg_status.py
        → load entries, sort by resolved Country proxy
          → for each country: build_driver(proxy = geo_proxy_for_entry(data))
            → geo self-check (assert exit country)
            → scrape AG/CG, search reviews for username
            → write Published/Removed (+ rating) back to entries + Sheet
```

## Error Handling

| Condition | Behavior |
|---|---|
| Blank `Country` | Return `""` → no proxy. No error. |
| `Country` present but not in `COUNTRY_CODE` | Log warning, no proxy. No error. |
| `ENIGMA_PW_<CC>` not set for a present country | Log warning, no proxy. No error. |
| Proxy connect failure | Existing per-entry error handling; counted as an error, loop continues. |
| Geo self-check mismatch | Log a clear warning so the run is auditable; continue (do not abort the group). |

## Testing

1. Unit-level: `geo_proxy_for_entry` returns the right `host:port:user:pass` for
   a configured country, and `""` for blank/unknown/unconfigured.
2. Geo self-check confirms exit country for at least one configured country.
3. Smoke test one German brand end-to-end (AG + CG).
4. Regression: a brand with blank `Country` still checks exactly as it does
   today.

## Rejected / fallback alternatives

- **B — GoLogin browser on EC2 (documented fallback).** Drive GoLogin's Orbita
  (which handles the SOCKS5 proxy + fingerprint natively) via the GoLogin API,
  mapping each `Country` to its GoLogin profile id. **Rejected for now** because
  enigmaproxy answers over HTTP, so the existing stack suffices; GoLogin adds
  Orbita-on-headless-Linux setup (likely xvfb), an API token, profile-id mapping,
  and memory pressure on the t2.small. **Revisit only if** AG/CG later begin
  fingerprint/behavioral-blocking the plain-Chrome scraper.
- **SOCKS5→HTTP bridge (e.g. `gost`).** Only needed if HTTP were unavailable; it
  is available, so this is unnecessary.
- **C — GoLogin Cloud (drop EC2).** Conflicts with the "keep EC2
  always-available" requirement. Rejected.

## Manual setup the user must do (outside the code)

1. Developer adds a **`Country`** column to the Google Sheet, populated with full
   country names for the brands that need geo checks.
2. Add the `ENIGMA_*` variables (host/port/login + one `ENIGMA_PW_<CC>` per
   needed country) to EC2's `~/.env`, pulling each country's password from the
   corresponding GoLogin saved proxy.
3. Restart `status_server.py` so it picks up the new env vars.
