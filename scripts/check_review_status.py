#!/usr/bin/env python3
"""
check_review_status.py — Selenium stealth Trustpilot review status checker.

Reads entries from Supabase, visits each Trustpilot review URL with an
undetected-chromedriver (stealth), extracts the review status, and writes
updates back to Supabase.

Status values: Published | Pending | Refused | Removed

Usage:
    python check_review_status.py [--tab "Tab Name"] [--dry-run] [--headless]

Required env vars (copy .env.example -> .env and fill in):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import json
import logging
import os
import re
import tempfile
import time
import zipfile
from datetime import datetime, timezone, timedelta
from typing import Iterable, Optional, Union

import requests
from dotenv import load_dotenv
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By

from geo_proxy import country_code_for_entry
from schedule_groups import in_active_group

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

# ─── Config ──────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

BATCH_SIZE = 3
DELAY_BETWEEN_BATCHES = 2.5

# Proxy name (from "Proxy Used" column) → env var holding "host:port:user:pass"
PROXY_ENV_MAP: dict[str, str] = {
    "proxylite":   "PROXY_PROXYLITE",
    "spyderproxy": "PROXY_SPYDERPROXY",
    "enigma":      "PROXY_ENIGMA",
}

def proxy_for_entry(data: dict) -> str:
    """Return the proxy connection string for this entry from env vars, or ''."""
    name = (data.get("Proxy Used") or "").strip().lower()
    env_key = PROXY_ENV_MAP.get(name, "")
    return os.environ.get(env_key, "") if env_key else ""

def _build_proxy_extension(host: str, port: str, user: str, pwd: str) -> str:
    """Write a temporary Chrome proxy-auth extension and return its zip path."""
    manifest = json.dumps({
        "version": "1.0.0", "manifest_version": 2, "name": "ProxyAuth",
        "permissions": [
            "proxy", "tabs", "unlimitedStorage", "storage",
            "<all_urls>", "webRequest", "webRequestBlocking",
        ],
        "background": {"scripts": ["bg.js"]},
        "minimum_chrome_version": "22.0.0",
    })
    bg = (
        f'var c={{mode:"fixed_servers",rules:{{singleProxy:{{scheme:"http",'
        f'host:"{host}",port:parseInt("{port}")}},bypassList:["localhost"]}}}};'
        f'chrome.proxy.settings.set({{value:c,scope:"regular"}},function(){{}});'
        f'chrome.webRequest.onAuthRequired.addListener('
        f'function(d){{return{{authCredentials:{{username:"{user}",password:"{pwd}"}}}};}},'
        f'{{urls:["<all_urls>"]}},["blocking"]);'
    )
    path = tempfile.mktemp(suffix=".zip")
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("manifest.json", manifest)
        zf.writestr("bg.js", bg)
    return path
PAGE_LOAD_TIMEOUT = 25
POST_LOAD_SLEEP = 1.5
CHROME_RESTART_EVERY = 50  # restart Chrome every N entries to prevent memory exhaustion

# ─── Error logging ───────────────────────────────────────────────────────────
# status_server.py is launched via pythonw.exe with no console (see
# start_status_server.ps1), so print() output is discarded. Per-entry scrape
# exceptions (the "errors" count surfaced in the dashboard toast) must go to a
# file or they're unrecoverable after the fact.
ERROR_LOG_PATH = os.path.join(os.path.dirname(__file__), "status_check_errors.log")
_error_logger = logging.getLogger("status_check_errors")
_error_logger.setLevel(logging.ERROR)
_error_logger.propagate = False
if not _error_logger.handlers:
    _handler = logging.FileHandler(ERROR_LOG_PATH, encoding="utf-8")
    _handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    _error_logger.addHandler(_handler)


def log_check_error(platform: str, url: str, exc: Exception) -> None:
    """Persist a per-entry scrape exception so a failed check run stays diagnosable."""
    _error_logger.error("[%s] %s -> %r", platform, url, exc)


# ─── URL normalization (shared by AG/CG) ──────────────────────────────────────
# AG/CG review-list links are pasted by hand into the Sheet and occasionally
# carry a trailing page-number segment (e.g. ".../silverplay-casino/2#reviews")
# from whatever page happened to be open in the browser at copy time.
# AskGamblers' review order shifts over time (reviews added/removed), so a
# page number pinned into the link can go stale — confirmed live: SilverPlay's
# stored link pointed to page 2 while the target review was on page 1. The
# checker only ever pages *forward* from wherever it lands (via "Load More"),
# so a stale page-2 link permanently hides a review that has since moved back
# to page 1, producing a false Refused/Removed. Stripping any trailing
# all-digit path segment always starts the search at the canonical listing.
def normalize_review_list_url(url: str) -> str:
    """Strip a trailing all-digit page-number path segment, e.g.
    '.../silverplay-casino/2#reviews' -> '.../silverplay-casino#reviews'.
    Leaves slugs that merely end in digits (e.g. 'vegas2web-casino') and
    non-numeric fragments (e.g. '#review-<hash>') untouched."""
    return re.sub(r"/\d+(#.*)?$", lambda m: m.group(1) or "", url.strip())


# ─── Bot-block detection (shared by AG/CG) ────────────────────────────────────
# AskGamblers and CasinoGuru both sit behind Cloudflare's "Just a moment"
# challenge, which blocks headless Chrome outright but clears for a real
# headful browser (see geo_bridge.ensure_display). A real bot-challenge page is
# identified by its TITLE, not by body keywords — a fully-loaded review page
# legitimately contains words like "captcha" (e.g. in a Cloudflare Turnstile
# script tag), so keyword-matching the body caused false positives that
# skipped good pages.
_BLOCK_TITLE_KEYWORDS = (
    "just a moment", "attention required", "access denied",
    "verifying you are human", "verify you are human",
)


def page_blocked(html: str, title: str = "") -> bool:
    """Return True only for an actual bot/Cloudflare challenge page, detected by
    the challenge title or a tiny page — never by keywords in a real, fully-loaded
    review page. Callers must check this before treating "user not found" as a
    real result — otherwise a blocked page silently reads the same as a
    genuinely-removed review."""
    t = (title or "").lower()
    if any(k in t for k in _BLOCK_TITLE_KEYWORDS):
        print(f"    [blocked] challenge title: {title!r}")
        return True
    if len(html) < 5000:  # a real review page is 100K+; a tiny page is a wall/error
        print(f"    [blocked] page too small ({len(html)} chars)")
        return True
    return False


# ─── Review-text extraction (shared by AG/CG/WO) ──────────────────────────────
# None of AG/CG/WO isolate a review-card DOM element today — they only prove a
# review exists via a whole-page text search, then discard everything except a
# rating regex. This locates the actual card so its clean text can be stored.

# Single source of truth for the jsonb key each platform's review text is
# stored under — every checker below reads/writes through this, so the four
# can't silently drift the way independently-written key names have before
# in this repo (see CLAUDE.md's Task 180/174/173 history).
REVIEW_TEXT_KEYS = {
    "tp": "TP Review Text",
    "ag": "AG Review Text",
    "cg": "CG Review Text",
    "wo": "WO Review Text",
}


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


_ClassNameArg = Union[str, Iterable[str], None]


def _as_tuple(class_or_classes: _ClassNameArg) -> tuple:
    """Normalize (None, a single class name, or an iterable of class names)
    to a tuple for uniform iteration."""
    if not class_or_classes:
        return ()
    if isinstance(class_or_classes, str):
        return (class_or_classes,)
    return tuple(class_or_classes)


def _has_ancestor_with_class(element, class_names: tuple) -> bool:
    """Walk up from `element` looking for an ancestor carrying any of `class_names`."""
    try:
        node = element
        for _ in range(8):
            classes = (node.get_attribute("class") or "").split()
            if any(c in classes for c in class_names):
                return True
            node = node.find_element(By.XPATH, "..")
    except Exception:
        pass
    return False


def _strip_first_matching_descendant(node, class_names: tuple, text: str) -> str:
    """Trim `text` (the already-fetched .text of `node`) at the start of the
    *leftmost* (earliest-occurring) descendant whose `class` attribute carries
    any of `class_names` as an exact, whole-token match — e.g. a business
    reply block nested inside the same review-card container as the real
    review, always positioned after it. Confirmed live on AskGamblers'
    `review__reply`, which nests inside the same review card as the real
    review with no ancestor level containing one without the other, and is a
    single, unambiguous class with no BEM-modifier siblings observed live.

    Matching is exact-token (via XPath 1.0's padded-space `contains()` idiom)
    rather than substring, so a class like `review__reply` cannot also match
    a differently-scoped sibling such as `review__reply-header` — which would
    otherwise risk the leftmost match landing on an inner sub-element instead
    of the real reply block. With exact-token matching there should be at
    most one match for any single-purpose class, so leftmost and rightmost
    are equivalent in practice; leftmost is kept as the more conservative
    choice. Callers who need to guard against genuine multi-purpose class
    reuse (seen live on CasinoGuru, where the same class also tags an
    unrelated translate-toggle duplicate of the review text itself) should
    use `exclude_class` instead, which skips the whole candidate rather than
    trying to trim around an ambiguous marker."""
    if not class_names:
        return text
    try:
        selector = " or ".join(
            f"contains(concat(' ', normalize-space(@class), ' '), {_xpath_literal(' ' + c + ' ')})"
            for c in class_names
        )
        descendants = node.find_elements(By.XPATH, f".//*[{selector}]")
    except Exception:
        return text
    leftmost = None
    for d in descendants:
        try:
            d_text = (d.text or "").strip()
        except Exception:
            continue
        if not d_text:
            continue
        # Assumes a descendant's own .text is a literal, findable substring of
        # its ancestor's .text — true for Selenium's rendered-text extraction
        # in every case observed live, but not guaranteed if a site renders
        # whitespace differently at different DOM depths.
        idx = text.find(d_text)
        if idx != -1 and (leftmost is None or idx < leftmost):
            leftmost = idx
    if leftmost is None:
        return text
    return text[:leftmost].strip()


def extract_review_card_text(
    driver: uc.Chrome,
    user_lower: str,
    exclude_class: _ClassNameArg = None,
    strip_class: _ClassNameArg = None,
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

    `min_len`/`max_len` defaults were tuned against real live AskGamblers and
    CasinoGuru pages during this feature's Task 7 live-validation pass — not
    TrustPilot, which never calls this function (TP extracts via structured
    `__NEXT_DATA__` JSON, not DOM-walking); Wizard of Odds' real pages, while
    also validated live, didn't need threshold tuning since its cards render
    without reply/noise bleed.

    Two independent, deliberately separate exclusion mechanisms, since a
    single class name can need either behavior depending on the platform:
    - `exclude_class`: skip a candidate entirely when it's nested inside (or
      is) a matching element — for markers that are NEVER part of a real
      review (CasinoGuru's hidden 'tooltip-user-row' "helpful" widget), or
      whose only visible occurrence of the username IS the excluded thing
      (confirmed live on CasinoGuru's `js-reply` business-reply block, which
      can be the *only* text-searchable match when a review's own byline
      isn't a plain text node).
    - `strip_class`: once a candidate ancestor is otherwise accepted, trim its
      text at a nested descendant matching this class — for a marker that IS
      unambiguously trailing content bundled inside the same card as a real
      review (confirmed live on AskGamblers' `review__reply`). Do not reuse a
      class that also tags unrelated content elsewhere in the card for this
      parameter — that ambiguity is exactly what caused a real regression
      during this feature's live validation (CasinoGuru's `js-reply` also
      tags a translate-toggle duplicate of the review text itself, so
      strip-based trimming on it cut into real review content; that platform
      uses `exclude_class` for the same marker instead)."""
    exclude_classes = _as_tuple(exclude_class)
    strip_classes = _as_tuple(strip_class)
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
            if exclude_classes and _has_ancestor_with_class(el, exclude_classes):
                continue
            node = el
            for _ in range(max_ancestors):
                text = (node.text or "").strip()
                if min_len <= len(text) <= max_len:
                    if strip_classes:
                        stripped = _strip_first_matching_descendant(node, strip_classes, text)
                        if len(stripped) >= min_len:
                            return stripped
                        # Stripping cut this candidate below min_len -- a wider
                        # ancestor is more surrounding noise, not more of this
                        # review. Move to the next candidate element entirely
                        # rather than keep climbing from here.
                        break
                    return text
                parent = node.find_element(By.XPATH, "..")
                if parent == node:
                    break
                node = parent
        except Exception:
            continue
    return None


# ─── Review-header/footer stripping (shared by AG/CG/WO) ──────────────────────
# `extract_review_card_text` returns a card's *entire* rendered text, which on
# some platforms bundles the reviewer's byline/date/star-rating (WO, rendered
# as a leading few short lines) or a vote-count footer (AG's "Helpful (N)")
# around the actual review body. Every platform already has its own Date/Score
# columns for that same date/rating — the stored review text should be body
# content only, not a duplicate of what those columns already hold.

_DATE_LINE_RE = re.compile(
    r"^(?:"
    r"[A-Za-z]+ \d{1,2},? \d{4}(?:,? \d{1,2}:\d{2}(?:\s?[APap][Mm])?)?"  # July 20, 2026 17:51
    r"|\d{1,2} [A-Za-z]+ \d{4}"                                          # 20 July 2026
    r"|\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?"                            # 2026-07-20
    r"|\d{1,2}/\d{1,2}/\d{2,4}"                                          # 20/07/2026
    r")$"
)
# CasinoGuru renders "N <unit> ago" / "today" / "yesterday" instead of an
# absolute date — confirmed live on a real card (Ivar88 @ Rooster Bet, 2026-08-11):
# "Ivar88\nBronze\n1 month ago\n<body>". Real header signal, safe to strip, but
# too imprecise to write into a Date column other logic (grace-period day-math)
# parses as an absolute date — so a match here is never returned as `date_str`.
_RELATIVE_DATE_RE = re.compile(
    r"^(?:today|yesterday|\d+\s+(?:day|days|week|weeks|month|months|year|years)\s+ago)$",
    re.IGNORECASE,
)
# CasinoGuru's loyalty-tier badge, rendered as its own line right after the
# username (see the Ivar88 example above). A small closed vocabulary, not
# proof of a header on its own — only consumed if a date/rating line
# corroborates it immediately after (see the loop below).
_BADGE_LINE_RE = re.compile(r"^(?:bronze|silver|gold|platinum|diamond|vip)$", re.IGNORECASE)
_RATING_BARE_RE = re.compile(r"^[1-5]$")
_RATING_COMBINED_RE = re.compile(r"^[1-5]\s*(?:/\s*5|out of 5)\s*(?:stars?)?$", re.IGNORECASE)
_RATING_CONTINUATION_RE = re.compile(r"^/\s*5$")
_TRAILING_HELPFUL_RE = re.compile(r"\n?\s*helpful\s*\(\s*\d+\s*\)\s*$", re.IGNORECASE)


def split_review_header(card_text: Optional[str], user: Optional[str]) -> tuple[Optional[str], Optional[str], Optional[int]]:
    """Split a review card's rendered text into (clean_body, date, rating).

    Assumes any byline/badge/date/rating header renders as its own short
    line(s) immediately after the line naming the reviewer — confirmed live
    on two real shapes: Wizard of Odds (username, absolute date, then a
    rating rendered as either "5 / 5" on one line or "5" and "/ 5" on two)
    and CasinoGuru (username, an optional loyalty-tier badge, then a
    relative date like "1 month ago"). A card with no such header (the
    common AG shape) simply finds nothing to consume in the scan window and
    is returned unchanged, with date/rating both None — safe to call
    unconditionally on any platform's card text. `date` is only ever
    returned for an absolute date (never a relative one) so callers can
    write it straight into a Date column without corrupting its format.
    """
    if not card_text or not user:
        return card_text, None, None
    lines = [ln.strip() for ln in card_text.splitlines() if ln.strip()]
    if not lines:
        return card_text, None, None

    user_lower = user.strip().lower()
    user_idx = next((i for i, ln in enumerate(lines) if ln.lower() == user_lower), None)
    if user_idx is None:
        return card_text, None, None

    date_str: Optional[str] = None
    rating: Optional[int] = None
    found_header = False
    i = user_idx + 1
    scan_limit = min(len(lines), user_idx + 5)
    while i < scan_limit:
        line = lines[i]
        if not found_header and date_str is None and rating is None and _BADGE_LINE_RE.match(line):
            # Provisional -- only counts if a date/rating line follows right after.
            i += 1
            continue
        if date_str is None and _DATE_LINE_RE.match(line):
            date_str = line
            found_header = True
            i += 1
            continue
        if date_str is None and _RELATIVE_DATE_RE.match(line):
            found_header = True
            i += 1
            continue
        if rating is None:
            if _RATING_COMBINED_RE.match(line):
                rating = int(line[0])
                found_header = True
                i += 1
                continue
            if _RATING_BARE_RE.match(line):
                rating = int(line)
                found_header = True
                i += 1
                if i < len(lines) and _RATING_CONTINUATION_RE.match(lines[i]):
                    i += 1
                continue
        break

    if not found_header:
        return card_text, None, None

    body = "\n".join(lines[i:]).strip()
    return (body or card_text), date_str, rating


def strip_trailing_helpful(text: Optional[str]) -> Optional[str]:
    """Strip a trailing 'Helpful (N)' vote-count line some AskGamblers review
    cards carry after the review body (a known bleed characteristic — see
    this feature's design doc — previously never stripped)."""
    if not text:
        return text
    stripped = _TRAILING_HELPFUL_RE.sub("", text).strip()
    return stripped or text


# ─── Status resolution (shared by AG/CG) ──────────────────────────────────────

REFUSED_AFTER_DAYS = 1  # grace period before an unconfirmed AG/CG entry flips to Refused


def _older_than(date_str: str, days: int) -> bool:
    """Return True if date_str is more than `days` days in the past."""
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            dt = datetime.strptime(date_str.strip(), fmt).replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - dt) > timedelta(days=days)
        except ValueError:
            continue
    return False  # unparseable — don't auto-refuse


def resolve_status(found: bool, current_status: str, added_date: Optional[str] = None) -> str:
    """Decide the next status from a scrape result. `found` is whether the
    username was located on the review page; `current_status` is the status
    before this check; `added_date` is the entry's "review added" date (the
    AG/CG date column), used for the not-found grace period. Shared by AG
    and CG so they can't drift apart:
      found                                     -> Published
      not found, current was Published          -> Removed
      not found, current was Removed            -> Removed (stays put; a
        Removed entry is only ever re-checked when explicitly requested via
        STATUS_FILTER_MAP, and re-found flips it back to Published above)
      not found, current was anything else, and added_date is within
        REFUSED_AFTER_DAYS                      -> Pending (recheck later)
      not found, current was anything else, and added_date is older than
        REFUSED_AFTER_DAYS (or missing/unparseable) -> Refused
    Refused is not a dead end — it's re-checked on every future run, so a
    review misjudged as Refused before moderation catches up simply flips to
    Published once it's actually found live."""
    if found:
        return "Published"
    current_lower = current_status.strip().lower()
    if current_lower == "published":
        return "Removed"
    if current_lower == "removed":
        return "Removed"
    if added_date and not _older_than(added_date, REFUSED_AFTER_DAYS):
        return "Pending"
    return "Refused"


# Maps the dashboard's status-filter dropdown value to the raw status values
# eligible for a check when that filter is active. Shared by all four platform
# checkers (TP/AG/CG/WO) — their default CHECKABLE_STATUSES deliberately
# excludes "published" and "removed" (to avoid re-scraping every already-
# resolved account on every run); this map lets a user opt into re-checking
# either by filtering the table to that status first and then clicking Check
# Status, scoped to just that status.
STATUS_FILTER_MAP: dict[str, set[str]] = {
    "done":     {"done"},
    "pending":  {"pending"},
    "live":     {"published"},
    "removed":  {"refused", "removed"},
}

# "On Pause"/"Not Done" have no single fixed spelling like the 4 real review
# states above do, so they're matched by substring rather than exact-set
# membership -- mirrors BrandGroup.tsx's isOnPause (`v.includes('pause')`) and
# isNotDone (`v.includes('not done')`) exactly. Keep both in sync; that file
# cross-references this one in turn.
STATUS_FILTER_SUBSTRINGS: dict[str, str] = {
    "on-pause": "pause",
    "not-done": "not done",
}


def status_filter_matches(current_lower: str, filters: Optional[list[str]], default: set[str]) -> bool:
    """True if `current_lower` (an entry's own status column value, already
    stripped+lowered) satisfies ANY of the requested `filters` (OR across
    every requested filter key) -- the opt-in path for scoping a Check Status
    run to specific status(es). With no filters active, falls back to
    `default` (each platform's normal checkable-statuses sweep)."""
    if not filters:
        return current_lower in default
    for f in filters:
        substr = STATUS_FILTER_SUBSTRINGS.get(f)
        if substr is not None:
            if substr in current_lower:
                return True
        elif current_lower in STATUS_FILTER_MAP.get(f, set()):
            return True
    return False


TP_STATUS_COLS = [
    "TP Review Status",
    "Trust Pilot Review Status",
    "Trustpilot Review Status",
    "Trust pilot Review Status",
    "Review Status",
]

# Columns that hold a numeric 1-5 star rating (written as "1"–"5").
# "Score added" / "Score Added" are Yes/No boolean columns — excluded intentionally.
SCORE_COLS = ["Score"]

# Same priority order as BRAND_COLS in src/pages/BrandGroup.tsx — keep in sync.
BRAND_COLS = ["Brands", "Brand Name", "Brand", "Brand / TP URL PAGE", "URL PAGE", "Account Name"]

# Only entries with these statuses are eligible for a status check.
# "Done"      = review was just posted by the agent; TP hasn't processed it yet.
# "Pending"   = TP received the review but moderation hasn't resolved it yet.
# "Published" = already live, but TP can still remove/refuse it later, so we
#               keep re-checking to catch a Published -> Removed/Refused change.
CHECKABLE_STATUSES = {"done", "pending", "published"}

# Caps an *unscoped* Check Status click (no status/brand/agent/proxy/country
# filter active) to this many entries per platform per tab, so a click can't
# balloon into a bulk run across a large tab. Replaces the old 3-week
# brand-group rotation (schedule_groups.py / filter_by_active_group) as this
# project's EC2-load control for Check Status specifically (2026-08-25) --
# rotation meant any given brand only got checked once every 3 weeks even on a
# manual click; this instead lets every brand be eligible every day, just a
# few entries at a time. A request already narrowed by an explicit filter is
# NOT capped -- same "explicit filter = exactly what was asked for" precedent
# Task 265 established for the rotation gate this replaces.
MAX_UNSCOPED_BATCH = 20

# ─── Status Parsing (mirrors parser.ts) ──────────────────────────────────────

STATE_MAP: dict[str, str] = {
    "published": "Published",
    "pending":   "Pending",
    "refused":   "Refused",
    "archived":  "Removed",
    "flagged":   "Removed",
    "removed":   "Removed",
}

TEXT_SIGNALS: list[tuple[str, str]] = [
    # ── Removed ──────────────────────────────────────────────────────────────
    ("review removed",              "Removed"),
    ("bewertung entfernt",          "Removed"),
    ("beoordeling verwijderd",      "Removed"),
    ("avis supprimé",               "Removed"),
    ("opinión eliminada",           "Removed"),
    ("recensione rimossa",          "Removed"),
    ("anmeldelse fjernet",          "Removed"),
    ("recension borttagen",         "Removed"),
    ("arvostelu poistettu",         "Removed"),
    ("recenzja usunięta",           "Removed"),
    ("avaliação removida",          "Removed"),
    ("отзыв удалён",                "Removed"),
    ("レビューが削除されました",        "Removed"),
    ("리뷰가 삭제되었습니다",           "Removed"),
    ("yorum kaldırıldı",            "Removed"),
    ("تمت إزالة المراجعة",          "Removed"),
    # ── Refused ──────────────────────────────────────────────────────────────
    ("review not published",                  "Refused"),
    ("nicht veröffentlicht",                  "Refused"),
    ("niet gepubliceerd",                     "Refused"),
    ("avis non publié",                       "Refused"),
    ("opinión no publicada",                  "Refused"),
    ("recensione non pubblicata",             "Refused"),
    ("anmeldelse ikke publisert",             "Refused"),
    ("anmeldelse ikke publiceret",            "Refused"),
    ("recension inte publicerad",             "Refused"),
    ("arvostelua ei julkaistu",               "Refused"),
    ("recenzja nie została opublikowana",     "Refused"),
    ("avaliação não publicada",               "Refused"),
    ("отзыв не опубликован",                  "Refused"),
    ("レビューは公開されていません",             "Refused"),
    ("리뷰가 게시되지 않았습니다",              "Refused"),
    ("yorum yayınlanmadı",                    "Refused"),
    ("لم يتم نشر المراجعة",                  "Refused"),
    # ── Pending ───────────────────────────────────────────────────────────────
    ("review is pending",                    "Pending"),
    ("wartet auf die veröffentlichung",      "Pending"),
    ("wacht op publicatie",                  "Pending"),
    ("avis en attente",                      "Pending"),
    ("opinión pendiente",                    "Pending"),
    ("recensione in attesa",                 "Pending"),
    ("anmeldelse venter",                    "Pending"),
    ("recension väntar",                     "Pending"),
    ("arvostelu odottaa",                    "Pending"),
    ("recenzja oczekuje",                    "Pending"),
    ("avaliação pendente",                   "Pending"),
    ("отзыв ожидает",                        "Pending"),
    ("レビューが審査中",                       "Pending"),
    ("리뷰가 검토 중입니다",                   "Pending"),
    ("yorum beklemede",                      "Pending"),
    ("المراجعة قيد المراجعة",               "Pending"),
    # ── Published (fallback) ──────────────────────────────────────────────────
    ("thanks for your review",              "Published"),
    ("thank you for your review",           "Published"),
    ("ihre bewertung zählt",                "Published"),
    ("bedankt voor uw beoordeling",         "Published"),
    ("merci pour votre avis",               "Published"),
    ("gracias por tu opinión",              "Published"),
    ("grazie per la tua recensione",        "Published"),
    ("takk for din anmeldelse",             "Published"),
    ("tak for din anmeldelse",              "Published"),
    ("tack för din recension",              "Published"),
    ("kiitos arvostelustasi",               "Published"),
    ("dziękujemy za recenzję",              "Published"),
    ("obrigado pela sua avaliação",         "Published"),
    ("спасибо за ваш отзыв",                "Published"),
    ("レビューをありがとうございます",           "Published"),
    ("리뷰를 남겨주셔서 감사합니다",             "Published"),
    ("yorumunuz için teşekkürler",          "Published"),
    ("شكراً على مراجعتك",                   "Published"),
]


def _from_next_data(html: str) -> Optional[str]:
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
    if review:
        # isPending takes precedence — state/status can say "published" (meaning
        # "submitted") while isPending:true means it's still awaiting moderation.
        if review.get("isPending") is True:
            return "Pending"
        raw_state: Optional[str] = review.get("state") or review.get("status")
        if raw_state:
            return STATE_MAP.get(raw_state.lower())
    return None


def _strip_scripts(html: str) -> str:
    # Remove <script>...</script> blocks so i18n bundles don't pollute signal matching
    return re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)


def _from_text_signals(html: str) -> Optional[str]:
    lower = _strip_scripts(html).lower()
    for signal, status in TEXT_SIGNALS:
        if signal in lower:
            return status
    return None


def parse_review_status(html: str) -> Optional[str]:
    return _from_next_data(html) or _from_text_signals(html)


def _normalize_rating(raw) -> Optional[int]:
    if raw is None:
        return None
    try:
        n = int(raw) if isinstance(raw, int) else int(str(raw).strip())
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 5 else None


def _rating_from_next_data(html: str) -> Optional[int]:
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
    raw = review.get("stars") or review.get("rating") or review.get("reviewRating")
    return _normalize_rating(raw)


def _rating_from_html(html: str) -> Optional[int]:
    alt = re.search(r'alt="Rated\s+(\d)\s+out of 5 stars?"', html, re.IGNORECASE)
    if alt:
        return _normalize_rating(alt.group(1))
    data_attr = re.search(r'data-service-review-rating="(\d)"', html, re.IGNORECASE)
    if data_attr:
        return _normalize_rating(data_attr.group(1))
    return None


def parse_review_rating(html: str) -> Optional[int]:
    """Extract the 1-5 star rating from a Trustpilot review/confirmation page."""
    return _rating_from_next_data(html) or _rating_from_html(html)


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


# ─── Supabase REST helpers (no heavy SDK needed) ─────────────────────────────

def _headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def find_status_col(data: dict) -> Optional[str]:
    for col in TP_STATUS_COLS:
        if col in data:
            return col
    return None


def find_score_col(data: dict) -> Optional[str]:
    for col in SCORE_COLS:
        if col in data:
            return col
    return None


def find_brand_col(data: dict) -> Optional[str]:
    for col in BRAND_COLS:
        if col in data:
            return col
    return None


def filter_by_active_group(entries: list[dict], bypass: bool = False) -> tuple[list[dict], int]:
    """Keep only entries whose (tab, brand) hashes into this run's active
    schedule group (see schedule_groups.py). Entries that are skipped here
    are left completely untouched -- this only decides whether they're
    visited this run, never anything about their stored status/data.

    `bypass=True` skips the rotation gate entirely (every entry is kept,
    skipped count is 0). Callers pass this when the run was already scoped
    down to specific entries via an explicit status/brand/agent/proxy/country
    filter -- an operator who filtered the dashboard to one entry and clicked
    Check Status is asking for exactly that entry, not "whatever this week's
    rotation allows." A fully unscoped run (the weekly cron, or a manual click
    with no filters active) still respects rotation."""
    if bypass:
        return entries, 0
    kept: list[dict] = []
    skipped = 0
    for entry in entries:
        data = entry.get("data") or {}
        brand_col = find_brand_col(data)
        brand_val = (data.get(brand_col) or "").strip() if brand_col else ""
        if in_active_group(entry.get("tab") or "", brand_val):
            kept.append(entry)
        else:
            skipped += 1
    return kept, skipped


def cap_unscoped_batch(entries: list[dict], has_scope_filter: bool,
                        max_batch: int = MAX_UNSCOPED_BATCH) -> list[dict]:
    """Caps an *unscoped* Check Status run to `max_batch` entries -- this
    project's EC2-load control for the dashboard's Check Status button
    (status_server.py's TP branch, check_ag_for_tab, check_cg_for_tab,
    check_wo_for_tab), replacing the 3-week rotation gate above
    (filter_by_active_group) for that one feature specifically (2026-08-25).
    `has_scope_filter=True` (an explicit status/brand/agent/proxy/country
    filter is active) returns `entries` unchanged -- same "explicit filter
    means check exactly this" precedent `filter_by_active_group`'s own
    `bypass` parameter already established."""
    if has_scope_filter:
        return entries
    return entries[:max_batch]


# Mirrors src/lib/proxyAliases.ts's resolveProxyLabel/isRedactedProxyValue: a raw
# Proxy Used value is folded into "No Proxy" if blank or an all-asterisk redacted
# placeholder (e.g. "***"). Keep in sync -- that file cross-references this one.
def _is_no_proxy_value(raw_proxy: str) -> bool:
    trimmed = raw_proxy.strip()
    return not trimmed or re.fullmatch(r"\*+", trimmed) is not None


# Mirrors the dashboard's own Brand/Agent/Proxy/Country filter dropdowns so a
# "Check Status" run can be scoped to exactly what's currently filtered in the
# table for any of TP/AG/CG/WO, the same way status_filter scopes to a status.
def matches_scope_filters(
    data: dict,
    brands: Optional[set[str]] = None,
    agents: Optional[list[str]] = None,
    proxies: Optional[list[str]] = None,
    countries: Optional[list[str]] = None,
) -> bool:
    """Return True if `data` matches every provided scope filter (AND across
    fields — same semantics as the dashboard's own filter chain), where each
    field matches if the entry hits ANY of that field's requested values (OR
    within a field — same as the dashboard's own multi-select filters and how
    `brands` here has always worked). Country compares resolved ISO codes (via
    country_code_for_entry) rather than raw strings, so "Germany" and "DE"
    behave identically — same convention AG/CG's --country CLI flag already
    uses. Agent/Proxy are case-insensitive, trimmed equality checks against the
    raw column value; a blank column value never matches a non-blank filter,
    except a "No Proxy" request, which matches a blank/redacted Proxy Used
    value specifically (see `_is_no_proxy_value`)."""
    if brands is not None:
        brand_col = find_brand_col(data)
        brand_val = (data.get(brand_col) or "").strip() if brand_col else ""
        if not brand_col or brand_val not in brands:
            return False
    if agents:
        agent_val = (data.get("Agent") or "").strip().lower()
        if agent_val not in {a.strip().lower() for a in agents}:
            return False
    if proxies:
        raw_proxy = (data.get("Proxy Used") or "").strip()
        wants_no_proxy = any(p.strip().lower() == "no proxy" for p in proxies)
        real_wanted = {p.strip().lower() for p in proxies if p.strip().lower() != "no proxy"}
        if not ((wants_no_proxy and _is_no_proxy_value(raw_proxy)) or raw_proxy.lower() in real_wanted):
            return False
    if countries:
        entry_cc = country_code_for_entry(data)
        wanted_ccs = {country_code_for_entry({"Country": c}) for c in countries}
        if entry_cc not in wanted_ccs:
            return False
    return True


def _fetch_all(params: dict) -> list:
    """Paginate through Supabase REST (server caps at 1000 rows per request).

    Postgres/PostgREST make no ordering guarantee across separate requests
    without an explicit ORDER BY — confirmed live: fetching a 2380-row tab
    without one silently dropped rows across the offset=1000/2000 page
    boundary, so entries eligible for a status check were never loaded and
    the "Check Status" button reported fewer checked than were actually due.
    Ordering by the primary key makes every page's row set stable.
    """
    PAGE = 1000
    all_rows: list = []
    offset = 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/entries",
            headers=_headers(),
            params={**params, "order": "id", "limit": PAGE, "offset": offset},
        )
        r.raise_for_status()
        batch: list = r.json()
        all_rows.extend(batch)
        if len(batch) < PAGE:
            break
        offset += PAGE
    return all_rows


def load_entries(tab: Optional[str] = None, include_published: bool = True,
                  brands: Optional[list[str]] = None, status_filters: Optional[list[str]] = None,
                  agents: Optional[list[str]] = None, proxies: Optional[list[str]] = None,
                  countries: Optional[list[str]] = None) -> list[dict]:
    params: dict = {"select": "id,tab,sheet_row_id,data"}
    if tab:
        params["tab"] = f"eq.{tab}"
    rows: list[dict] = _fetch_all(params)

    # status_filters (driven by the dashboard's status-filter dropdown) narrows to
    # exactly those status(es) — the opt-in path for re-checking Published/Removed
    # (and now On Pause/Not Done), which CHECKABLE_STATUSES/include_published
    # never cover on their own.
    default_statuses = CHECKABLE_STATUSES if include_published else {"done", "pending"}
    brand_set = set(brands) if brands else None

    out = []
    for row in rows:
        data: dict = row.get("data") or {}
        profile_url: str = data.get("Link to the profile", "") or ""
        if not profile_url.strip():
            continue
        status_col = find_status_col(data)
        if not status_col:
            continue
        current = (data.get(status_col) or "").strip().lower()
        if not status_filter_matches(current, status_filters, default_statuses):
            continue
        if not matches_scope_filters(data, brands=brand_set, agents=agents, proxies=proxies, countries=countries):
            continue
        out.append(row)
    return out


def update_entry(entry_id: str, data: dict, updates: dict[str, str],
                 tab: Optional[str] = None, sheet_row_id: Optional[str] = None) -> bool:
    """Apply `updates` (e.g. {status_col: 'Published', score_col: '5'}) to the
    entry's data blob. Does not touch the Sheet — the Sheet is not updated by
    this checker. last_edited_by is stamped 'check-review-status' so import-tabs
    (Sheet -> Dashboard sync) knows this row's status/score are authoritative in
    the DB and must not be reverted to a stale Sheet value."""
    if not updates:
        return True
    updated_data = {**data, **updates}
    payload = {
        "data": updated_data,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "last_edited_by": "check-review-status",
    }
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/entries",
        headers=_headers(),
        params={"id": f"eq.{entry_id}"},
        json=payload,
    )
    r.raise_for_status()

    return True


# ─── Selenium ────────────────────────────────────────────────────────────────

def build_driver(headless: bool = False, proxy: str = "") -> uc.Chrome:
    """Build a Chrome driver. proxy format: 'host:port:user:pass' or 'host:port'."""
    options = uc.ChromeOptions()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-plugins-discovery")
    options.add_argument("--renderer-process-limit=1")
    options.add_argument("--window-size=1280,900")
    options.add_argument("--lang=en-US")

    _ext_path = ""
    if proxy:
        parts = proxy.split(":")
        if len(parts) == 4:
            _ext_path = _build_proxy_extension(*parts)
            options.add_extension(_ext_path)
        elif len(parts) >= 2:
            options.add_argument(f"--proxy-server={parts[0]}:{parts[1]}")
            options.add_argument("--disable-extensions")
    else:
        options.add_argument("--disable-extensions")

    if headless:
        options.add_argument("--headless=new")
    else:
        # Real (non-headless) Chrome is required to pass Cloudflare's headless
        # detection on AskGamblers/CasinoGuru — but a visible window popping up
        # during checks is disruptive. Position it off-screen instead: Chrome
        # still runs as a fully-rendered, real browser (defeating the headless
        # fingerprint) without ever appearing on the user's desktop.
        options.add_argument("--window-position=-2400,-2400")

    driver = uc.Chrome(options=options, version_main=149)
    driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT)

    if _ext_path:
        try:
            os.unlink(_ext_path)
        except Exception:
            pass

    return driver


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


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="Selenium stealth Trustpilot status checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--dry-run", action="store_true", help="Print changes without writing to Supabase")
    ap.add_argument("--headless", action="store_true", help="Run Chrome headless (may reduce stealth)")
    args = ap.parse_args()

    scope = f"tab: {args.tab}" if args.tab else "all tabs"
    print(f"Loading entries ({scope})...")
    entries = load_entries(args.tab)
    entries, skipped_group = filter_by_active_group(entries)
    total = len(entries)
    print(f"  -> {total} entries to check ({skipped_group} skipped -- not in this run's schedule group)\n")

    if not total:
        print("Nothing to do.")
        return

    driver = build_driver(headless=args.headless)
    try:
        checked = updated = errors = 0

        for i in range(0, total, BATCH_SIZE):
            batch = entries[i : i + BATCH_SIZE]
            for entry in batch:
                checked += 1

                # Restart Chrome every N entries to prevent renderer memory exhaustion.
                # Check at start of entry so it fires regardless of continue paths below.
                if checked > 1 and (checked - 1) % CHROME_RESTART_EVERY == 0:
                    print(f"  ... restarting Chrome at entry {checked}/{total}\n")
                    try:
                        driver.quit()
                    except Exception:
                        pass
                    driver = build_driver(headless=args.headless)

                data: dict = entry["data"]
                status_col = find_status_col(data)
                score_col = find_score_col(data)
                current = data.get(status_col, "") or ""
                current_score = str(data.get(score_col, "") or "") if score_col else ""
                url: str = data["Link to the profile"]

                print(f"[{checked}/{total}] {url}")
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
                current_review_text = data.get(REVIEW_TEXT_KEYS["tp"]) or ""
                if new_review_text and new_review_text != current_review_text:
                    updates[REVIEW_TEXT_KEYS["tp"]] = new_review_text

                if not updates:
                    print(f"    -> {current!r} *{current_score or '-'} (no change)")
                    continue

                tag = " (dry run)" if args.dry_run else ""
                print(f"    -> {current!r} -> {new_status!r} *{new_rating or '-'}{tag}")
                if not args.dry_run:
                    update_entry(entry["id"], data, updates,
                                 tab=entry.get("tab"), sheet_row_id=entry.get("sheet_row_id"))
                updated += 1

            remaining = total - (i + len(batch))
            if remaining > 0:
                print(f"  ... sleeping {DELAY_BETWEEN_BATCHES}s ({remaining} left)\n")
                time.sleep(DELAY_BETWEEN_BATCHES)

    finally:
        driver.quit()

    print(f"\n{'-'*40}")
    print(f"Done.  checked={checked}  updated={updated}  errors={errors}  skipped_group={skipped_group}")
    if args.dry_run:
        print("(dry-run — no writes made)")


if __name__ == "__main__":
    main()
