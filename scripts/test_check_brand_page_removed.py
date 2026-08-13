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
