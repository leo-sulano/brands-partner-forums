from unittest.mock import MagicMock

from selenium.common.exceptions import NoSuchElementException

import check_brand_page_removed as cbpr


def test_is_brand_page_removed_true_for_the_real_removed_heading():
    # Exact rendered <h1> text confirmed live against a known-removed
    # TrustPilot brand page (Prive Casino) during this feature's research.
    driver = MagicMock()
    driver.find_element.return_value.text = "This profile has been removed"
    assert cbpr.is_brand_page_removed(driver) is True


def test_is_brand_page_removed_false_for_a_real_live_heading():
    # Exact rendered <h1> .text confirmed live on a known-live brand
    # (Lucky7even) -- includes an embedded newline from nested markup,
    # which is exactly why this must compare Selenium's rendered .text and
    # not a raw-HTML substring search.
    driver = MagicMock()
    driver.find_element.return_value.text = "Lucky7even \nReviews"
    assert cbpr.is_brand_page_removed(driver) is False


def test_is_brand_page_removed_false_when_h1_is_missing():
    driver = MagicMock()
    driver.find_element.side_effect = NoSuchElementException()
    assert cbpr.is_brand_page_removed(driver) is False


BRAND_URLS_FIXTURE = {
    "brand_tp_urls": {
        "prive casino": "https://www.trustpilot.com/review/privecasino.bet",
        "rocketspin": "https://www.trustpilot.com/review/rocketspin.com",
    },
    "tab_brand_urls": {
        "Wizard of Odds": {
            "rocketspin": "https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/",
        },
    },
    "tab_display_names": {
        "TP Affiliate": "FTP",
        "TP Brand Injection": "BITP",
    },
}


def test_get_brand_tp_url_uses_tab_override_when_present():
    url = cbpr.get_brand_tp_url("RocketSpin", "Wizard of Odds", BRAND_URLS_FIXTURE)
    assert url == "https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/"


def test_get_brand_tp_url_falls_back_to_flat_map():
    url = cbpr.get_brand_tp_url("Rocketspin", "Rooster Partners", BRAND_URLS_FIXTURE)
    assert url == "https://www.trustpilot.com/review/rocketspin.com"


def test_get_brand_tp_url_is_case_and_whitespace_insensitive():
    url = cbpr.get_brand_tp_url("  Prive Casino  ", "TP Brand Injection", BRAND_URLS_FIXTURE)
    assert url == "https://www.trustpilot.com/review/privecasino.bet"


def test_get_brand_tp_url_returns_none_when_unknown():
    assert cbpr.get_brand_tp_url("Nonexistent Brand", "Hanan", BRAND_URLS_FIXTURE) is None


def test_tab_label_uses_display_name_when_present():
    assert cbpr.tab_label("TP Affiliate", BRAND_URLS_FIXTURE) == "FTP"


def test_tab_label_falls_back_to_raw_tab_name():
    assert cbpr.tab_label("Rooster Partners", BRAND_URLS_FIXTURE) == "Rooster Partners"
