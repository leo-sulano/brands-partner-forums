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
