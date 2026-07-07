from datetime import datetime, timedelta, timezone

import check_review_status as crs


class _FakeResponse:
    def __init__(self, payload=None):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_find_brand_col_prefers_first_match():
    assert crs.find_brand_col({'Brand Name': 'X', 'Brands': 'Y'}) == 'Brands'


def test_find_brand_col_returns_none_when_absent():
    assert crs.find_brand_col({'Other': 'X'}) is None


def _row(brand_col: str, brand_value: str, status: str = 'Published') -> dict:
    return {
        'id': 'row-1',
        'tab': 'TP Brand Injection',
        'sheet_row_id': 'sr-1',
        'data': {
            'Link to the profile': 'https://trustpilot.com/reviews/abc',
            'Review Status': status,
            brand_col: brand_value,
        },
    }


def test_load_entries_filters_by_brands(monkeypatch):
    rows = [
        _row('Brand / TP URL PAGE', 'Boho Casino'),
        _row('Brand / TP URL PAGE', '7Bit Casino crypto'),
    ]
    monkeypatch.setattr(crs, '_fetch_all', lambda params: rows)

    result = crs.load_entries('TP Brand Injection', include_published=True, brands=['Boho Casino'])

    assert len(result) == 1
    assert result[0]['data']['Brand / TP URL PAGE'] == 'Boho Casino'


def test_load_entries_without_brands_returns_all(monkeypatch):
    rows = [
        _row('Brand / TP URL PAGE', 'Boho Casino'),
        _row('Brand / TP URL PAGE', '7Bit Casino crypto'),
    ]
    monkeypatch.setattr(crs, '_fetch_all', lambda params: rows)

    result = crs.load_entries('TP Brand Injection', include_published=True)

    assert len(result) == 2


def test_load_entries_status_filter_live_scopes_to_published(monkeypatch):
    # A user filtering the table to "Live" and clicking Check Status opts into
    # re-checking Published TP entries specifically, same as AG/CG.
    rows = [
        _row('Brand / TP URL PAGE', 'A', status='Done'),
        _row('Brand / TP URL PAGE', 'B', status='Pending'),
        _row('Brand / TP URL PAGE', 'C', status='Published'),
    ]
    monkeypatch.setattr(crs, '_fetch_all', lambda params: rows)

    result = crs.load_entries('TP Brand Injection', status_filter='live')

    assert len(result) == 1
    assert result[0]['data']['Review Status'] == 'Published'


def test_load_entries_status_filter_removed_scopes_to_refused_and_removed(monkeypatch):
    # TP's default CHECKABLE_STATUSES never includes Refused/Removed at all —
    # this is the first path that lets a Refused/Removed TP entry be re-checked.
    rows = [
        _row('Brand / TP URL PAGE', 'A', status='Done'),
        _row('Brand / TP URL PAGE', 'B', status='Refused'),
        _row('Brand / TP URL PAGE', 'C', status='Removed'),
        _row('Brand / TP URL PAGE', 'D', status='Published'),
    ]
    monkeypatch.setattr(crs, '_fetch_all', lambda params: rows)

    result = crs.load_entries('TP Brand Injection', status_filter='removed')

    statuses = {r['data']['Review Status'] for r in result}
    assert statuses == {'Refused', 'Removed'}


def test_load_entries_status_filter_unmapped_value_yields_no_entries(monkeypatch):
    rows = [
        _row('Brand / TP URL PAGE', 'A', status='Done'),
        _row('Brand / TP URL PAGE', 'B', status='Published'),
    ]
    monkeypatch.setattr(crs, '_fetch_all', lambda params: rows)

    result = crs.load_entries('TP Brand Injection', status_filter='on-pause')

    assert result == []


def test_matches_scope_filters_no_filters_matches_everything():
    assert crs.matches_scope_filters({'Agent': 'Lai', 'Proxy Used': 'Enigma', 'Country': 'Germany'}) is True
    assert crs.matches_scope_filters({}) is True


def test_matches_scope_filters_brands_matches_via_find_brand_col():
    data = {'Brands': 'Rollero'}
    assert crs.matches_scope_filters(data, brands={'Rollero', 'Luckyvibe'}) is True
    assert crs.matches_scope_filters(data, brands={'Luckyvibe'}) is False
    # No brand column present at all -> never matches an active brand filter.
    assert crs.matches_scope_filters({}, brands={'Rollero'}) is False


def test_matches_scope_filters_agent_case_insensitive_and_trimmed():
    assert crs.matches_scope_filters({'Agent': ' Lai '}, agent='lai') is True
    assert crs.matches_scope_filters({'Agent': 'Lai'}, agent='Levi') is False
    assert crs.matches_scope_filters({}, agent='Lai') is False


def test_matches_scope_filters_proxy_case_insensitive_and_trimmed():
    assert crs.matches_scope_filters({'Proxy Used': ' Enigma '}, proxy='enigma') is True
    assert crs.matches_scope_filters({'Proxy Used': 'SpyderProxy'}, proxy='Enigma') is False


def test_matches_scope_filters_country_matches_via_resolved_code():
    # Same convention AG/CG's --country CLI flag already uses: compare resolved
    # ISO codes so "Germany" and "DE" behave identically, not raw string equality.
    assert crs.matches_scope_filters({'Country': 'Germany'}, country='Germany') is True
    assert crs.matches_scope_filters({'Country': 'DE'}, country='Germany') is True
    assert crs.matches_scope_filters({'Country': 'Germany'}, country='Norway') is False


def test_matches_scope_filters_combines_all_filters_with_and():
    data = {'Brands': 'Rollero', 'Agent': 'Lai', 'Proxy Used': 'Enigma', 'Country': 'Germany'}
    assert crs.matches_scope_filters(data, brands={'Rollero'}, agent='Lai', proxy='Enigma', country='Germany') is True
    # Any single mismatched filter fails the whole check.
    assert crs.matches_scope_filters(data, brands={'Rollero'}, agent='Levi', proxy='Enigma', country='Germany') is False


def test_load_entries_filters_by_brands_ignores_whitespace(monkeypatch):
    rows = [
        _row('Brand / TP URL PAGE', 'Boho Casino '),
    ]
    monkeypatch.setattr(crs, '_fetch_all', lambda params: rows)

    result = crs.load_entries('TP Brand Injection', include_published=True, brands=['Boho Casino'])

    assert len(result) == 1


def test_load_entries_skips_rows_with_no_brand_col_when_filtering(monkeypatch):
    rows = [
        {
            'id': 'row-2',
            'tab': 'TP Brand Injection',
            'sheet_row_id': 'sr-2',
            'data': {
                'Link to the profile': 'https://trustpilot.com/reviews/xyz',
                'Review Status': 'Published',
            },
        },
    ]
    monkeypatch.setattr(crs, '_fetch_all', lambda params: rows)

    result = crs.load_entries('TP Brand Injection', include_published=True, brands=['Boho Casino'])

    assert result == []


def test_fetch_all_paginates_with_deterministic_order(monkeypatch):
    # Real incident: paginating via limit/offset with no ORDER BY let Postgres
    # return rows in an unstable order across the two separate HTTP requests,
    # silently dropping a row that fell on the page-1/page-2 boundary — the AG
    # status checker never saw it, so "Check Status" reported fewer entries
    # checked than were actually eligible. Every page must request the same
    # explicit order so page boundaries are stable.
    page1 = [{'id': f'row-{i}'} for i in range(1000)]
    page2 = [{'id': f'row-{i}'} for i in range(1000, 1234)]
    captured_params = []

    def fake_get(url, headers=None, params=None):
        captured_params.append(params)
        offset = params['offset']
        return _FakeResponse(page1 if offset == 0 else page2)

    monkeypatch.setattr(crs.requests, 'get', fake_get)

    result = crs._fetch_all({'select': 'id', 'tab': 'eq.Rooster Partners'})

    assert len(result) == 1234
    assert all(p['order'] == 'id' for p in captured_params)


def test_update_entry_marks_status_as_check_review_status_authoritative(monkeypatch):
    # import-tabs (Sheet -> Dashboard sync) only preserves a row's status/score
    # columns against a stale Sheet value when last_edited_by == 'check-review-status'.
    # If update_entry doesn't stamp that marker, the next Sheet sync silently
    # reverts the freshly-detected status back to whatever's still in the Sheet.
    captured = {}

    def fake_patch(url, headers=None, params=None, json=None):
        captured['json'] = json
        return _FakeResponse()

    monkeypatch.setattr(crs.requests, 'patch', fake_patch)

    crs.update_entry('row-1', {'Review Status': 'Done'}, {'Review Status': 'Published'})

    assert captured['json']['last_edited_by'] == 'check-review-status'


def test_page_blocked_detects_cloudflare_challenge_title():
    # Real reported case: headless Chrome hitting AskGamblers/CasinoGuru gets
    # Cloudflare's interstitial instead of the review page.
    assert crs.page_blocked('x' * 6000, 'Just a moment...') is True


def test_page_blocked_detects_other_challenge_titles():
    for title in ('Attention Required!', 'Access denied', 'Verifying you are human'):
        assert crs.page_blocked('x' * 6000, title) is True


def test_page_blocked_detects_tiny_page_regardless_of_title():
    assert crs.page_blocked('short', 'Some Casino Review') is True


def test_page_blocked_false_for_real_review_page():
    # A real, fully-loaded review page can legitimately contain the word
    # "captcha" (e.g. inside a Cloudflare Turnstile script tag) — must not be
    # mistaken for a block based on body content.
    html = ('<html><head><title>Real Review</title></head><body>' +
            'genuine review content ' * 500 +
            '<script>captcha widget config</script></body></html>')
    assert crs.page_blocked(html, 'Real Casino Review') is False


def test_resolve_status_found_is_always_published():
    assert crs.resolve_status(found=True, current_status='Done') == 'Published'
    assert crs.resolve_status(found=True, current_status='Pending') == 'Published'
    assert crs.resolve_status(found=True, current_status='Refused') == 'Published'
    assert crs.resolve_status(found=True, current_status='Published') == 'Published'


def test_resolve_status_not_found_from_published_is_removed():
    assert crs.resolve_status(found=False, current_status='Published') == 'Removed'
    assert crs.resolve_status(found=False, current_status='published') == 'Removed'
    assert crs.resolve_status(found=False, current_status='  Published  ') == 'Removed'


def test_resolve_status_not_found_from_done_pending_or_refused_is_refused():
    assert crs.resolve_status(found=False, current_status='Done') == 'Refused'
    assert crs.resolve_status(found=False, current_status='Pending') == 'Refused'
    assert crs.resolve_status(found=False, current_status='Refused') == 'Refused'


def _days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%d/%m/%Y')


def test_resolve_status_not_found_within_grace_period_is_pending():
    # AG/CG entry added today (or yesterday, still under REFUSED_AFTER_DAYS) and
    # not yet found on the review page should wait as Pending, not jump to Refused.
    assert crs.resolve_status(found=False, current_status='Done', added_date=_days_ago(0)) == 'Pending'


def test_resolve_status_not_found_past_grace_period_is_refused():
    assert crs.resolve_status(found=False, current_status='Done', added_date=_days_ago(2)) == 'Refused'


def test_resolve_status_not_found_no_added_date_defaults_to_refused():
    assert crs.resolve_status(found=False, current_status='Done', added_date=None) == 'Refused'
    assert crs.resolve_status(found=False, current_status='Done', added_date='') == 'Refused'


def test_resolve_status_published_always_wins_over_grace_period():
    # Published takes precedence over the grace period even if added_date is recent.
    assert crs.resolve_status(found=False, current_status='Published', added_date=_days_ago(0)) == 'Removed'


def test_resolve_status_not_found_from_removed_stays_removed():
    # A Removed entry is only re-checked when explicitly opted into via the
    # 'removed' status filter — if still not found, it must stay Removed rather
    # than falling into the Pending/Refused grace-period branch meant for
    # never-yet-published entries.
    assert crs.resolve_status(found=False, current_status='Removed') == 'Removed'
    assert crs.resolve_status(found=False, current_status='removed', added_date=_days_ago(0)) == 'Removed'


def test_resolve_status_found_flips_removed_back_to_published():
    assert crs.resolve_status(found=True, current_status='Removed') == 'Published'


def test_normalize_review_list_url_strips_trailing_page_number():
    # Real case: SilverPlay's stored AG link points to page 2, but the review
    # in question is on page 1. AskGamblers' review order shifts over time, so
    # a page number pinned into the link at copy-time can go stale; the checker
    # only ever pages forward from wherever it lands, so it must always start
    # at the canonical (unpaginated) listing.
    url = 'https://www.askgamblers.com/online-casinos/reviews/silverplay-casino/2#reviews'
    assert crs.normalize_review_list_url(url) == (
        'https://www.askgamblers.com/online-casinos/reviews/silverplay-casino#reviews'
    )


def test_normalize_review_list_url_strips_page_number_without_fragment():
    url = 'https://www.askgamblers.com/online-casinos/reviews/silverplay-casino/12'
    assert crs.normalize_review_list_url(url) == (
        'https://www.askgamblers.com/online-casinos/reviews/silverplay-casino'
    )


def test_normalize_review_list_url_leaves_canonical_url_unchanged():
    url = 'https://www.askgamblers.com/online-casinos/reviews/silverplay-casino'
    assert crs.normalize_review_list_url(url) == url


def test_normalize_review_list_url_leaves_review_anchor_unchanged():
    # A #review-<hash> fragment isn't a page number — must not be touched.
    url = 'https://www.askgamblers.com/online-casinos/reviews/silverplay-casino#review-6a43c6054f08b3cb2e017be3'
    assert crs.normalize_review_list_url(url) == url


def test_normalize_review_list_url_leaves_numeric_looking_slug_unchanged():
    # A brand slug ending in digits (not an isolated page-number segment) must survive.
    url = 'https://www.askgamblers.com/online-casinos/reviews/vegas2web-casino'
    assert crs.normalize_review_list_url(url) == url
