# Region-Aware Proxy Selection for AG/CG Status Checks — Design

**Date:** 2026-06-30
**Status:** Approved (design); pending implementation plan

## Problem

The "Check Status" button scrapes AskGamblers (AG) and CasinoGuru (CG) review
pages to detect whether a brand's review is Published or Removed. The scraper
runs on an EC2 instance in Singapore (`ap-southeast-1`). AG and CG serve
**region-specific** content based on the visitor's IP geolocation, so a
Singapore-sourced request sees the wrong regional view of a brand's reviews —
e.g. a brand that should be checked as **Germany** is checked as Singapore, and
the expected reviews never appear.

This is a **geo problem, not a bot-detection problem.** The scraper already uses
`undetected-chromedriver` and already has per-entry proxy rotation
(`proxy_for_entry` + the proxy-auth Chrome extension). What's missing is the
ability to route each brand's check through a residential proxy located in that
brand's target country.

## Goal

Make each AG/CG check appear to originate from the brand's target country by
selecting a country-targeted residential proxy per brand, driven by a new
`Country` column. Keep the existing EC2 host, the existing Selenium stack, and
the existing always-available "Check Status" button.

## Non-Goals

- **No GoLogin.** GoLogin's headline feature is fingerprint spoofing, which
  addresses a problem we do not currently have. See "Rejected / fallback
  alternatives" below.
- **No Trustpilot (TP) changes.** Scope is AG + CG only; TP stays as-is to limit
  blast radius. Can be extended later if TP proves geo-sensitive.
- **No frontend changes.** Region is data-driven per brand, so the existing
  Check Status button works unchanged.

## Approach (chosen)

**Region-aware residential proxies on the existing stack.** Keep EC2, keep
`undetected-chromedriver`. Add a per-brand `Country` column and resolve it to a
country-targeted residential proxy that the existing `build_driver()` proxy
machinery already knows how to consume.

### 1. Data model

- New per-brand column **`Country`** in the Google Sheet, synced into
  `entries.data` like every other column.
- Holds the target country as a human-readable name, e.g. `Germany`,
  `United Kingdom`.
- **Blank is allowed** and must not cause a failure.

### 2. Country → proxy resolution (Python)

New helper in `scripts/check_review_status.py`:

```python
def geo_proxy_for_entry(data: dict) -> str:
    """Return a country-targeted residential proxy 'host:port:user:pass'
    for this entry's Country, or '' to fall back to existing behavior."""
```

- Read the `Country` value, normalize to ISO-3166-1 alpha-2 via a small
  `COUNTRY_CODE` map (`Germany → de`, `United Kingdom → gb`, …).
- Build a `host:port:user:pass` string that injects the country code into the
  residential provider's username (e.g. `user-cc-de`). The **exact injection
  format is an open item** to confirm from the provider dashboard/docs.
- Return the same `host:port:user:pass` shape that `build_driver(proxy=...)`
  already consumes via `_build_proxy_extension`.

**Fallback:** blank `Country` or a country missing from `COUNTRY_CODE` → fall
back to the existing name-based `proxy_for_entry(data)` (or no proxy). Log a
warning for an unknown-but-present country; never hard-fail.

### 3. Driver lifecycle — group by country

Today `build_driver()` is created once per run (with `CHROME_RESTART_EVERY`
recycling). Because the proxy now varies by country, the AG/CG loops change to:

1. Load eligible entries (existing filter logic).
2. **Group entries by resolved country.**
3. For each country group: build one Chrome pinned to that country's proxy,
   process the whole group, then `driver.quit()` before the next country.

This is far fewer Chrome launches than rebuilding per entry and keeps each
browser session cleanly pinned to a single exit country. The existing
`CHROME_RESTART_EVERY` memory-recycle still applies *within* a large country
group.

### 4. Wiring

- `scripts/check_ag_status.py` and `scripts/check_cg_status.py` adopt the
  grouped-by-country loop and pass the geo proxy into
  `build_driver(headless=..., proxy=geo_proxy_for_entry(data))`.
- Entries whose country group resolves to `''` (no geo proxy) are processed in a
  default group using existing behavior.

### 5. Config

- One new env var, **`PROXY_GEO`**, holding the residential geo-proxy base
  connection string (the username being the country-injectable base).
- Documented alongside the existing `PROXY_PROXYLITE` / `PROXY_SPYDERPROXY` /
  `PROXY_ENIGMA` vars in `scripts/.env.example` and in
  `docs/ec2-scraper-runbook.md`.

### 6. Verification built in

- **Geo self-check:** before scraping each country group, the driver hits a
  lightweight "what country is my IP" endpoint through the proxy and logs the
  detected country, asserting it matches the target. This turns "did the proxy
  actually land in Germany?" into a printed line rather than a silent
  assumption.
- **Manual smoke test:** run one German brand through AG and CG with
  `--headless` off and confirm the German regional view renders and the username
  search resolves.

## Data Flow

```
Dashboard "Check Status"
  → Supabase Edge Function (proxy-check-status)
    → EC2 status_server.py (Flask: /check-ag-status, /check-cg-status)
      → check_ag_status.py / check_cg_status.py
        → group eligible entries by Country
          → for each country: build_driver(proxy = geo_proxy_for_entry(data))
            → geo self-check (assert exit country)
            → scrape AG/CG, search reviews for username
            → write Published/Removed (+ rating) back to entries + Sheet
```

## Error Handling

| Condition | Behavior |
|---|---|
| Blank `Country` | Fall back to `proxy_for_entry` / no proxy. No error. |
| `Country` present but not in `COUNTRY_CODE` | Log warning, use default group, no proxy. No error. |
| Proxy connect failure | Existing per-entry error handling; counted as an error, loop continues. |
| Geo self-check mismatch | Log a clear warning so the run is auditable; continue (do not abort the whole group). |

## Testing

1. Unit-level: `geo_proxy_for_entry` returns the right string for a known
   country, `''` for blank/unknown, and the country code is correctly injected.
2. Geo self-check confirms exit country for at least one configured country.
3. Smoke test one German brand end-to-end (AG + CG), `--headless` off.
4. Regression: a brand with blank `Country` still checks exactly as it does
   today.

## Rejected / fallback alternatives

- **B — GoLogin profiles per region on EC2 (documented fallback).** Replace the
  driver with GoLogin (one profile per country, each with a country proxy),
  connecting Selenium to GoLogin's debugger address. Adds managed fingerprint
  spoofing + warm persistent profiles + removes the `version_main` pinning
  chore. **Rejected for now** because it solves fingerprint blocking, which we
  don't have; it adds a recurring vendor cost on top of proxy traffic, more
  moving parts, and headless-Orbita-on-Linux fragility. **Revisit only if**, once
  correctly in-region, AG/CG begin fingerprint/behavioral-blocking the scraper.
- **C — GoLogin Cloud (drop EC2).** Conflicts with the "keep EC2
  always-available" requirement and would still need a host for the Flask
  endpoint. Rejected.

## Open Items (confirm during implementation)

1. **Proxy country-injection format** — exact username pattern the residential
   provider uses for country targeting (e.g. `user-cc-de` vs. per-country
   endpoint). Confirm from the provider dashboard before wiring `geo_proxy_for_entry`.
2. **Country naming convention in the Sheet** — confirm the values the developer
   will put in the `Country` column (full names vs. codes) so `COUNTRY_CODE`
   covers them.
3. **Which residential provider** backs `PROXY_GEO` (the one confirmed to
   support country targeting).
