from unittest.mock import MagicMock

import pytest
from selenium.common.exceptions import NoSuchElementException

import check_brand_page_removed as cbpr


@pytest.fixture(autouse=True)
def _notify_brand_removed_url_env(monkeypatch):
    """run() now validates NOTIFY_BRAND_REMOVED_URL up front (Finding 2 of
    the final review). Default it to present for every test except the ones
    specifically exercising the missing-var case, which delenv it themselves."""
    monkeypatch.setenv("NOTIFY_BRAND_REMOVED_URL", "https://example.com/notify-brand-removed")


@pytest.fixture(autouse=True)
def _skip_scraper_wait(monkeypatch):
    """other_scraper_running() shells out to `pgrep`, which doesn't exist on
    a Windows dev machine and would fail every test that reaches run().
    Default subprocess.run to report "nothing running" for every test except
    the ones dedicated to this logic, which override it back locally."""
    class _NoMatch:
        returncode = 1

    monkeypatch.setattr(cbpr.subprocess, "run", lambda *args, **kwargs: _NoMatch())


def test_other_scraper_running_true_when_pgrep_finds_a_match(monkeypatch):
    calls = []

    class _FakeCompleted:
        returncode = 0

    def fake_run(cmd, stdout, stderr):
        calls.append(cmd)
        return _FakeCompleted()

    monkeypatch.setattr(cbpr.subprocess, "run", fake_run)

    assert cbpr.other_scraper_running() is True
    assert calls == [["pgrep", "-f", "--", cbpr.OTHER_SCRAPER_LOCK_PATTERN]]


def test_other_scraper_running_false_when_pgrep_finds_nothing(monkeypatch):
    class _FakeCompleted:
        returncode = 1

    monkeypatch.setattr(cbpr.subprocess, "run", lambda cmd, stdout, stderr: _FakeCompleted())

    assert cbpr.other_scraper_running() is False


def test_wait_for_other_scrapers_polls_until_clear(monkeypatch):
    statuses = iter([True, True, False])
    monkeypatch.setattr(cbpr, "other_scraper_running", lambda: next(statuses))

    slept = []
    monkeypatch.setattr(cbpr.time, "sleep", lambda seconds: slept.append(seconds))

    cbpr.wait_for_other_scrapers()

    assert slept == [cbpr.SCRAPER_WAIT_POLL_SECONDS, cbpr.SCRAPER_WAIT_POLL_SECONDS]


def test_wait_for_other_scrapers_returns_immediately_when_already_clear(monkeypatch):
    monkeypatch.setattr(cbpr, "other_scraper_running", lambda: False)
    monkeypatch.setattr(cbpr.time, "sleep", lambda seconds: (_ for _ in ()).throw(AssertionError("must not sleep")))

    cbpr.wait_for_other_scrapers()  # no exception = never slept


def test_run_waits_for_other_scrapers_before_any_other_work(monkeypatch):
    order = []
    monkeypatch.setattr(cbpr, "wait_for_other_scrapers", lambda: order.append("wait"))
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: order.append("load_brand_urls") or {
        "brand_tp_urls": {}, "tab_brand_urls": {}, "tab_display_names": {},
    })
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: order.append("fetch_removed_keys") or set())
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: order.append("fetch_all_entries") or [])

    cbpr.run(dry_run=False)

    assert order[0] == "wait"


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


def test_run_flags_and_notifies_a_newly_detected_removal(monkeypatch):
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: set())
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {"winmega.com": "https://www.trustpilot.com/review/winmega.com"},
        "tab_brand_urls": {},
        "tab_display_names": {},
    })

    fake_driver = object()
    monkeypatch.setattr(cbpr, "build_driver", lambda headless=False, proxy="": fake_driver)
    monkeypatch.setattr(cbpr, "load_page", lambda driver, url: None)
    monkeypatch.setattr(cbpr, "is_brand_page_removed", lambda driver: True)

    flagged = []
    notified = []
    monkeypatch.setattr(cbpr, "flag_brand_removed", lambda tab, brand, platform: flagged.append((tab, brand, platform)))
    monkeypatch.setattr(cbpr, "notify_brand_removed", lambda brand, tab_label_value, platform_short_label, removed_at_label: notified.append(brand))

    summary = cbpr.run(dry_run=False)

    assert flagged == [("Hanan", "WinMega.com", "tp")]
    assert notified == ["WinMega.com"]
    assert summary == {"checked": 1, "newly_flagged": 1, "already_flagged": 0, "no_url": 0, "errors": 0}


def test_run_builds_the_driver_headless(monkeypatch):
    # Regression lock: discovered live on scraper-leo (2026-08-13) that the
    # default headful build_driver() call requires a display this EC2 box
    # doesn't provide outside AG/CG's Xvfb setup -- TrustPilot itself needs
    # no Cloudflare-evasion headful mode (check_review_status.py's own TP
    # weekly job already runs --headless successfully in production).
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: set())
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {"winmega.com": "https://www.trustpilot.com/review/winmega.com"},
        "tab_brand_urls": {},
        "tab_display_names": {},
    })

    calls = []

    def fake_build_driver(headless=False, proxy=""):
        calls.append(headless)
        return object()

    monkeypatch.setattr(cbpr, "build_driver", fake_build_driver)
    monkeypatch.setattr(cbpr, "load_page", lambda driver, url: None)
    monkeypatch.setattr(cbpr, "is_brand_page_removed", lambda driver: False)
    monkeypatch.setattr(cbpr, "flag_brand_removed", lambda *a: (_ for _ in ()).throw(AssertionError("not reached")))
    monkeypatch.setattr(cbpr, "notify_brand_removed", lambda *a: (_ for _ in ()).throw(AssertionError("not reached")))

    cbpr.run(dry_run=False)

    assert calls == [True]


def test_run_skips_already_flagged_brands(monkeypatch):
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: {("Hanan", "winmega.com")})
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {"winmega.com": "https://www.trustpilot.com/review/winmega.com"},
        "tab_brand_urls": {},
        "tab_display_names": {},
    })
    monkeypatch.setattr(cbpr, "build_driver", lambda headless=False, proxy="": object())

    called = []
    monkeypatch.setattr(cbpr, "load_page", lambda driver, url: called.append(url))

    summary = cbpr.run(dry_run=False)

    assert called == []
    assert summary == {"checked": 0, "newly_flagged": 0, "already_flagged": 1, "no_url": 0, "errors": 0}


def test_run_dry_run_never_writes(monkeypatch):
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: set())
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {"winmega.com": "https://www.trustpilot.com/review/winmega.com"},
        "tab_brand_urls": {},
        "tab_display_names": {},
    })
    monkeypatch.setattr(cbpr, "build_driver", lambda headless=False, proxy="": object())
    monkeypatch.setattr(cbpr, "load_page", lambda driver, url: None)
    monkeypatch.setattr(cbpr, "is_brand_page_removed", lambda driver: True)

    def fail(*args, **kwargs):
        raise AssertionError("must not write during a dry run")

    monkeypatch.setattr(cbpr, "flag_brand_removed", fail)
    monkeypatch.setattr(cbpr, "notify_brand_removed", fail)

    summary = cbpr.run(dry_run=True)

    assert summary["newly_flagged"] == 1  # counted, just not written


def test_run_treats_a_load_error_as_skip_not_removed(monkeypatch):
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Hanan", "data": {"Brands": "WinMega.com"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: set())
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {"winmega.com": "https://www.trustpilot.com/review/winmega.com"},
        "tab_brand_urls": {},
        "tab_display_names": {},
    })
    monkeypatch.setattr(cbpr, "build_driver", lambda headless=False, proxy="": object())

    def raise_load(driver, url):
        raise RuntimeError("proxy timeout")

    monkeypatch.setattr(cbpr, "load_page", raise_load)

    flagged = []
    monkeypatch.setattr(cbpr, "flag_brand_removed", lambda *a: flagged.append(a))

    summary = cbpr.run(dry_run=False)

    assert flagged == []
    assert summary["errors"] == 1


def test_run_skips_brands_with_no_configured_url(monkeypatch):
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Hanan", "data": {"Brands": "Some Untracked Brand"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: set())
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {}, "tab_brand_urls": {}, "tab_display_names": {},
    })

    summary = cbpr.run(dry_run=False)

    assert summary == {"checked": 0, "newly_flagged": 0, "already_flagged": 0, "no_url": 1, "errors": 0}


def test_run_treats_a_resolved_non_trustpilot_url_as_no_url(monkeypatch):
    # Finding 1: brand_urls.generated.json's tab_brand_urls is the frontend's
    # generic brand-link map, not TrustPilot-only. Real cases: every "Wizard
    # of Odds" tab entry points to wizardofodds.com (that tab has no TP
    # platform at all), and Revolution Casino's "god of casino" entry points
    # to askgamblers.com ("God Of Casino has no Trustpilot page (AG only)").
    # A resolved non-TP URL must land in no_url, never get the TP-specific
    # removal check run against it.
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Wizard of Odds", "data": {"Brands": "RocketSpin"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: set())
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {"rocketspin": "https://www.trustpilot.com/review/rocketspin.com"},
        "tab_brand_urls": {
            "Wizard of Odds": {
                "rocketspin": "https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/",
            },
        },
        "tab_display_names": {},
    })

    called = []
    monkeypatch.setattr(cbpr, "build_driver", lambda headless=False, proxy="": called.append("build_driver") or object())
    monkeypatch.setattr(cbpr, "load_page", lambda driver, url: called.append(url))

    summary = cbpr.run(dry_run=False)

    assert called == []  # never loaded the page or built a driver
    assert summary == {"checked": 0, "newly_flagged": 0, "already_flagged": 0, "no_url": 1, "errors": 0}


def test_run_treats_an_askgamblers_only_url_as_no_url(monkeypatch):
    # Revolution Casino's "god of casino" case specifically -- AG-only, no TP page.
    monkeypatch.setattr(cbpr, "fetch_all_entries", lambda: [
        {"tab": "Revolution Casino", "data": {"Brands": "god of casino"}},
    ])
    monkeypatch.setattr(cbpr, "fetch_removed_keys", lambda platform: set())
    monkeypatch.setattr(cbpr, "load_brand_urls", lambda: {
        "brand_tp_urls": {},
        "tab_brand_urls": {
            "Revolution Casino": {
                "god of casino": "https://www.askgamblers.com/online-casinos/reviews/god-of-casino",
            },
        },
        "tab_display_names": {},
    })

    summary = cbpr.run(dry_run=False)

    assert summary == {"checked": 0, "newly_flagged": 0, "already_flagged": 0, "no_url": 1, "errors": 0}


def test_run_raises_if_notify_url_missing_before_doing_any_work(monkeypatch):
    # Finding 2: validate NOTIFY_BRAND_REMOVED_URL up front, before the loop
    # (and before any network/Selenium work), so a missing var is a loud,
    # immediate failure instead of a silently-lost notification discovered
    # mid-run on the first real removal.
    monkeypatch.delenv("NOTIFY_BRAND_REMOVED_URL", raising=False)

    def fail(*args, **kwargs):
        raise AssertionError("must not do any work before validating NOTIFY_BRAND_REMOVED_URL")

    monkeypatch.setattr(cbpr, "load_brand_urls", fail)
    monkeypatch.setattr(cbpr, "fetch_removed_keys", fail)
    monkeypatch.setattr(cbpr, "fetch_all_entries", fail)

    with pytest.raises(RuntimeError, match="NOTIFY_BRAND_REMOVED_URL"):
        cbpr.run(dry_run=False)
