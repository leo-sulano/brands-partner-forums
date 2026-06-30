#!/usr/bin/env python3
"""
proxy_geo_test.py — discover & verify a residential proxy's country-targeting syntax.

The AG/CG scrapers need to exit in a brand's target country (e.g. Germany) so the
review pages render the right regional view. Residential providers expose country
targeting by tweaking the proxy *username* — but the exact syntax differs per
provider and lives in their dashboard/docs. This tool finds it empirically:

  1. Take a provider (a key in PROXY_ENV_MAP, e.g. proxylite/spyderproxy/enigma).
  2. Build the proxy string for one or more candidate username patterns.
  3. Launch Chrome through it (reusing the real build_driver) and read the
     detected exit country from an IP-geolocation endpoint.
  4. Report which pattern actually lands you in the target country.

Usage:
    # Try all built-in candidate patterns, stop at the first that hits the target:
    python proxy_geo_test.py --provider proxylite --country Germany

    # Test one specific pattern:
    python proxy_geo_test.py --provider proxylite --country Germany --pattern "{user}-country-{cc}"

    # Also show the provider's DEFAULT exit country (no country injection):
    python proxy_geo_test.py --provider proxylite --country Germany --baseline

    # Watch the browser (debug):
    python proxy_geo_test.py --provider proxylite --country Germany --no-headless

Required env vars (scripts/.env): SUPABASE_URL etc. not needed here, but the
PROXY_<NAME> var for your chosen provider must be set to "host:port:user:pass".
"""

import argparse
import json
import os
import re
import sys
import time
from typing import Optional

from dotenv import load_dotenv
from selenium.webdriver.common.by import By

sys.path.insert(0, os.path.dirname(__file__))
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from check_review_status import build_driver, PROXY_ENV_MAP

# ─── Config ──────────────────────────────────────────────────────────────────

# Username templates to try, in order. {user} = base username from the env var,
# {cc} = ISO-3166-1 alpha-2 country code (lowercase). These cover the common
# residential-provider conventions; add more if your provider uses something else.
CANDIDATE_PATTERNS = [
    "{user}-country-{cc}",
    "{user}-cc-{cc}",
    "{user}_country-{cc}",
    "{user}-region-{cc}",
    "{user}-c-{cc}",
    "{user}-{cc}",
    "country-{cc}-{user}",
]

# Full country name → ISO-3166-1 alpha-2. Extend as new countries appear in the
# Sheet's `Country` column. (This mirrors the map the scrapers will use.)
COUNTRY_CODE = {
    "germany": "de",
    "united kingdom": "gb",
    "uk": "gb",
    "great britain": "gb",
    "united states": "us",
    "usa": "us",
    "canada": "ca",
    "australia": "au",
    "netherlands": "nl",
    "france": "fr",
    "spain": "es",
    "italy": "it",
    "sweden": "se",
    "norway": "no",
    "finland": "fi",
    "ireland": "ie",
    "new zealand": "nz",
    "austria": "at",
    "switzerland": "ch",
    "portugal": "pt",
}

# IP-geolocation endpoints. Each returns JSON; we read the country code from a
# known field. Tried in order until one responds.
GEO_ENDPOINTS = [
    ("https://ipinfo.io/json", ("country",)),
    ("https://ifconfig.co/json", ("country_iso",)),
    ("http://ip-api.com/json", ("countryCode",)),
]


def to_cc(country: str) -> str:
    """Normalize a full country name (or a 2-letter code) to lowercase ISO-2."""
    c = country.strip().lower()
    if len(c) == 2 and c.isalpha():
        return c
    cc = COUNTRY_CODE.get(c)
    if not cc:
        raise SystemExit(
            f"Unknown country {country!r}. Add it to COUNTRY_CODE in this file "
            f"(known: {', '.join(sorted(COUNTRY_CODE))})."
        )
    return cc


def base_proxy(provider: str) -> tuple[str, str, str, str]:
    """Resolve provider → (host, port, user, pwd) from PROXY_<NAME> env var."""
    env_key = PROXY_ENV_MAP.get(provider.strip().lower())
    if not env_key:
        raise SystemExit(
            f"Unknown provider {provider!r}. Known: {', '.join(PROXY_ENV_MAP)}."
        )
    raw = os.environ.get(env_key, "")
    if not raw:
        raise SystemExit(f"Env var {env_key} is empty/unset (for provider {provider!r}).")
    parts = raw.split(":")
    if len(parts) < 4:
        raise SystemExit(
            f"{env_key} must be 'host:port:user:pass' (got {len(parts)} parts)."
        )
    host, port, user = parts[0], parts[1], parts[2]
    pwd = ":".join(parts[3:])  # password may itself contain ':'
    return host, port, user, pwd


def proxy_string(provider: str, pattern: Optional[str], cc: str) -> str:
    """Build 'host:port:user:pass'. pattern=None → base creds (no injection)."""
    host, port, user, pwd = base_proxy(provider)
    new_user = pattern.format(user=user, cc=cc) if pattern else user
    return f"{host}:{port}:{new_user}:{pwd}"


def _parse_country(text: str) -> Optional[str]:
    """Pull a 2-letter country code out of a geo-endpoint JSON response."""
    try:
        obj = json.loads(text)
    except (ValueError, TypeError):
        m = re.search(r'"countryCode"\s*:\s*"([A-Za-z]{2})"', text) or \
            re.search(r'"country(?:_iso)?"\s*:\s*"([A-Za-z]{2})"', text)
        return m.group(1).lower() if m else None
    for _, fields in GEO_ENDPOINTS:
        for f in fields:
            v = obj.get(f)
            if isinstance(v, str) and len(v) == 2 and v.isalpha():
                return v.lower()
    return None


def detect_exit_country(proxy: str, headless: bool) -> tuple[Optional[str], Optional[str]]:
    """Launch Chrome through `proxy`, return (country_code, raw_response_snippet)."""
    driver = build_driver(headless=headless, proxy=proxy)
    try:
        for url, _ in GEO_ENDPOINTS:
            try:
                driver.get(url)
                time.sleep(2.0)
                body = driver.find_element(By.TAG_NAME, "body").text
                cc = _parse_country(body)
                if cc:
                    return cc, body[:200]
            except Exception as exc:
                print(f"      ({url} failed: {exc})")
                continue
        return None, None
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def main() -> None:
    ap = argparse.ArgumentParser(description="Discover/verify proxy country-targeting syntax")
    ap.add_argument("--provider", required=True, help=f"One of: {', '.join(PROXY_ENV_MAP)}")
    ap.add_argument("--country", required=True, help="Target country, e.g. 'Germany' or 'de'")
    ap.add_argument("--pattern", help="Test ONLY this username template (with {user} and {cc})")
    ap.add_argument("--baseline", action="store_true", help="Also test base creds (no injection)")
    ap.add_argument("--no-headless", dest="headless", action="store_false")
    ap.set_defaults(headless=True)
    args = ap.parse_args()

    cc = to_cc(args.country)
    print(f"Provider: {args.provider}   Target: {args.country} -> cc={cc!r}   headless={args.headless}\n")

    if args.baseline:
        print("[baseline] base creds, no country injection ...")
        got, snippet = detect_exit_country(proxy_string(args.provider, None, cc), args.headless)
        print(f"  -> default exit country: {got or 'UNKNOWN'}   {snippet or ''}\n")

    patterns = [args.pattern] if args.pattern else CANDIDATE_PATTERNS
    winner = None
    for pat in patterns:
        sample_user = pat.format(user="<user>", cc=cc)
        print(f"[try] pattern={pat!r}  (username becomes: {sample_user})")
        got, snippet = detect_exit_country(proxy_string(args.provider, pat, cc), args.headless)
        status = "PASS ✅" if got == cc else f"got {got or 'UNKNOWN'}"
        print(f"  -> exit country: {got or 'UNKNOWN'}   [{status}]   {snippet or ''}\n")
        if got == cc:
            winner = pat
            break

    print("─" * 60)
    if winner:
        print(f"WINNER: {args.provider} targets {cc!r} with username pattern:\n    {winner}")
        print(f"\nUse this in geo_proxy_for_entry's per-provider format map.")
    else:
        print(f"No pattern produced exit country {cc!r} for {args.provider}.")
        print("Next: check the provider's dashboard/docs for the geo syntax and pass")
        print("it via --pattern, or confirm the provider supports country targeting.")


if __name__ == "__main__":
    main()
