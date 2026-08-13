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
