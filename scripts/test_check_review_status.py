import check_review_status as crs


class _FakeResponse:
    def raise_for_status(self):
        pass


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
