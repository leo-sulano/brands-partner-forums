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


class _FakeResponse:
    def __init__(self, payload=None, status_ok=True):
        self._payload = payload
        self._status_ok = status_ok

    def raise_for_status(self):
        if not self._status_ok:
            raise RuntimeError("HTTP error")

    def json(self):
        return self._payload


def test_fetch_all_entries_paginates_until_a_short_page(monkeypatch):
    page1 = [{"id": i, "tab": "Hanan", "data": {}} for i in range(1000)]
    page2 = [{"id": 1000, "tab": "Hanan", "data": {}}]
    calls = []

    def fake_get(url, headers, params):
        calls.append(params)
        return _FakeResponse(page1 if params["offset"] == 0 else page2)

    monkeypatch.setattr(cbpr.requests, "get", fake_get)

    result = cbpr.fetch_all_entries()

    assert len(result) == 1001
    assert len(calls) == 2


def test_distinct_tab_brands_dedupes_and_skips_blank_brand():
    entries = [
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
        {"tab": "Hanan", "data": {"Brands": ""}},
        {"tab": "TP Brand Injection", "data": {"Brand / TP URL PAGE": "Prive Casino"}},
    ]
    result = cbpr.distinct_tab_brands(entries)
    assert result == {
        ("Hanan", "WinMega.com"),
        ("TP Brand Injection", "Prive Casino"),
    }


def test_fetch_removed_keys_returns_tab_brand_key_pairs(monkeypatch):
    def fake_get(url, headers, params):
        assert params["platform"] == "eq.tp"
        return _FakeResponse([
            {"tab": "Hanan", "brand_key": "winmega.com"},
            {"tab": "TP Brand Injection", "brand_key": "prive casino"},
        ])

    monkeypatch.setattr(cbpr.requests, "get", fake_get)

    result = cbpr.fetch_removed_keys("tp")

    assert result == {("Hanan", "winmega.com"), ("TP Brand Injection", "prive casino")}


def test_flag_brand_removed_upserts_with_merge_duplicates(monkeypatch):
    captured = {}

    def fake_post(url, headers, params, json):
        captured["url"] = url
        captured["headers"] = headers
        captured["params"] = params
        captured["json"] = json
        return _FakeResponse()

    monkeypatch.setattr(cbpr.requests, "post", fake_post)

    cbpr.flag_brand_removed("Hanan", "WinMega.com", "tp")

    assert captured["params"]["on_conflict"] == "tab,brand_key,platform"
    assert "resolution=merge-duplicates" in captured["headers"]["Prefer"]
    assert captured["json"] == [{
        "tab": "Hanan",
        "brand": "WinMega.com",
        "platform": "tp",
        "removed_by": "Automated Check",
    }]


def test_notify_brand_removed_sends_the_real_payload_shape(monkeypatch):
    captured = {}

    def fake_post(url, headers, json):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return _FakeResponse()

    monkeypatch.setattr(cbpr.requests, "post", fake_post)
    monkeypatch.setenv("NOTIFY_BRAND_REMOVED_URL", "https://example.com/notify-brand-removed")

    cbpr.notify_brand_removed("WinMega.com", "Hanan", "TP", "13/08/2026")

    assert captured["url"] == "https://example.com/notify-brand-removed"
    assert captured["json"] == {
        "brand": "WinMega.com",
        "tabLabel": "Hanan",
        "platformShortLabel": "TP",
        "removedAtLabel": "13/08/2026",
    }
    assert captured["headers"]["Authorization"].startswith("Bearer ")
