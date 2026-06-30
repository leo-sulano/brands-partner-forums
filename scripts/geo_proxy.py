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

import json
import os
import re
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


# ─── Local bridge ports ───────────────────────────────────────────────────────
# Chrome 149 dropped Manifest-V2 extensions, so the proxy-auth extension trick no
# longer works. Instead, a local auth-free pproxy bridge per country forwards to
# the authenticated enigma proxy, and Chrome connects to the bridge via
# --proxy-server (no extension needed). geo_bridge.py launches the bridges.

BRIDGE_PORT_BASE = 8900


def _all_ccs() -> list:
    """All ISO-2 codes this module knows, sorted — defines stable bridge ports."""
    return sorted(set(COUNTRY_CODE.values()))


def bridge_port_for_cc(cc: str) -> int:
    """Deterministic local port for a country's enigma->local bridge."""
    return BRIDGE_PORT_BASE + _all_ccs().index(cc)


def configured_ccs() -> list:
    """Country codes that have an ENIGMA_PW_<CC> set in the environment."""
    return [cc for cc in _all_ccs() if os.environ.get(f"ENIGMA_PW_{cc.upper()}")]


def geo_proxy_for_entry(data: dict) -> str:
    """Return the LOCAL bridge address '127.0.0.1:port' for this entry's Country.
    Chrome connects to a local, auth-free pproxy bridge that forwards to the
    authenticated enigma residential proxy for that country (see geo_bridge.py).
    Returns '' to fall back to no proxy (blank/unknown/unconfigured country)."""
    cc = country_code_for_entry(data)
    if not cc or cc not in _all_ccs():
        return ""
    if not os.environ.get(f"ENIGMA_PW_{cc.upper()}"):
        print(f"  [geo] no ENIGMA_PW_{cc.upper()} configured — skipping proxy for {cc!r}")
        return ""
    return f"127.0.0.1:{bridge_port_for_cc(cc)}"


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
