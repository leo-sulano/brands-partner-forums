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
