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

    result = crs.load_entries('TP Brand Injection', status_filters=['live'])

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

    result = crs.load_entries('TP Brand Injection', status_filters=['removed'])

    statuses = {r['data']['Review Status'] for r in result}
    assert statuses == {'Refused', 'Removed'}


def test_load_entries_status_filter_multiple_values_is_union(monkeypatch):
    rows = [
        _row('Brand / TP URL PAGE', 'A', status='Published'),
        _row('Brand / TP URL PAGE', 'B', status='Refused'),
        _row('Brand / TP URL PAGE', 'C', status='Done'),
    ]
    monkeypatch.setattr(crs, '_fetch_all', lambda params: rows)

    result = crs.load_entries('TP Brand Injection', status_filters=['live', 'removed'])

    statuses = {r['data']['Review Status'] for r in result}
    assert statuses == {'Published', 'Refused'}


def test_load_entries_status_filter_on_pause_matches_substring():
    # "On Pause"/"Not Done" have no fixed exact spelling like the 4 real review
    # states do, so matching is substring-based (mirrors BrandGroup.tsx's
    # isOnPause: `v.includes('pause')`), not exact-set membership.
    assert crs.status_filter_matches('on pause', ['on-pause'], set()) is True
    assert crs.status_filter_matches('paused (manual)', ['on-pause'], set()) is True
    assert crs.status_filter_matches('done', ['on-pause'], set()) is False


def test_load_entries_status_filter_not_done_matches_substring():
    assert crs.status_filter_matches('not done', ['not-done'], set()) is True
    assert crs.status_filter_matches('done', ['not-done'], set()) is False


def test_status_filter_matches_falls_back_to_default_when_no_filters():
    assert crs.status_filter_matches('done', None, {'done', 'pending'}) is True
    assert crs.status_filter_matches('published', None, {'done', 'pending'}) is False
    assert crs.status_filter_matches('done', [], {'done', 'pending'}) is True


def test_filter_by_active_group_splits_kept_and_skipped(monkeypatch):
    monkeypatch.setattr(crs, 'in_active_group', lambda tab, brand, today=None: brand == 'Boho Casino')
    rows = [
        _row('Brand / TP URL PAGE', 'Boho Casino'),
        _row('Brand / TP URL PAGE', '7Bit Casino crypto'),
    ]

    kept, skipped = crs.filter_by_active_group(rows)

    assert len(kept) == 1
    assert kept[0]['data']['Brand / TP URL PAGE'] == 'Boho Casino'
    assert skipped == 1


def test_filter_by_active_group_treats_missing_brand_col_as_blank_brand(monkeypatch):
    monkeypatch.setattr(crs, 'in_active_group', lambda tab, brand, today=None: brand == '')
    rows = [{'id': 'row-1', 'tab': 'TP Brand Injection', 'sheet_row_id': 'sr-1', 'data': {'Link to the profile': 'x'}}]

    kept, skipped = crs.filter_by_active_group(rows)

    assert len(kept) == 1
    assert skipped == 0


def test_filter_by_active_group_bypass_keeps_everything(monkeypatch):
    # A caller that already scoped the run to specific entries (e.g. a Status
    # filter narrowed to one brand) is asking to check exactly those entries --
    # the rotation gate must not silently drop them.
    monkeypatch.setattr(crs, 'in_active_group', lambda tab, brand, today=None: False)
    rows = [
        _row('Brand / TP URL PAGE', 'Boho Casino'),
        _row('Brand / TP URL PAGE', '7Bit Casino crypto'),
    ]

    kept, skipped = crs.filter_by_active_group(rows, bypass=True)

    assert len(kept) == 2
    assert skipped == 0


def test_cap_unscoped_batch_truncates_when_no_scope_filter():
    rows = [_row('Brand / TP URL PAGE', f'Brand {i}') for i in range(5)]

    result = crs.cap_unscoped_batch(rows, has_scope_filter=False, max_batch=3)

    assert len(result) == 3
    assert result == rows[:3]


def test_cap_unscoped_batch_leaves_scoped_run_uncapped():
    # An explicit status/brand/agent/proxy/country filter means the caller asked
    # to check exactly these entries -- the batch cap must not silently drop any.
    rows = [_row('Brand / TP URL PAGE', f'Brand {i}') for i in range(5)]

    result = crs.cap_unscoped_batch(rows, has_scope_filter=True, max_batch=3)

    assert result == rows


def test_cap_unscoped_batch_uses_module_default_when_under_it():
    rows = [_row('Brand / TP URL PAGE', f'Brand {i}') for i in range(3)]

    result = crs.cap_unscoped_batch(rows, has_scope_filter=False)

    assert result == rows
    assert len(rows) <= crs.MAX_UNSCOPED_BATCH


def test_matches_scope_filters_no_filters_matches_everything():
    assert crs.matches_scope_filters({'Agent': 'Lai', 'Proxy Used': 'Enigma', 'Country': 'Germany'}) is True
    assert crs.matches_scope_filters({}) is True


def test_matches_scope_filters_brands_matches_via_find_brand_col():
    data = {'Brands': 'Rollero'}
    assert crs.matches_scope_filters(data, brands={'Rollero', 'Luckyvibe'}) is True
    assert crs.matches_scope_filters(data, brands={'Luckyvibe'}) is False
    # No brand column present at all -> never matches an active brand filter.
    assert crs.matches_scope_filters({}, brands={'Rollero'}) is False


def test_matches_scope_filters_agents_case_insensitive_and_trimmed():
    assert crs.matches_scope_filters({'Agent': ' Lai '}, agents=['lai']) is True
    assert crs.matches_scope_filters({'Agent': 'Lai'}, agents=['Levi']) is False
    assert crs.matches_scope_filters({}, agents=['Lai']) is False


def test_matches_scope_filters_agents_multi_value_matches_any():
    # OR within a field: matches if the entry's Agent is ANY of the requested values.
    assert crs.matches_scope_filters({'Agent': 'Jen'}, agents=['Ann', 'Jen']) is True
    assert crs.matches_scope_filters({'Agent': 'Lai'}, agents=['Ann', 'Jen']) is False


def test_matches_scope_filters_proxies_case_insensitive_and_trimmed():
    assert crs.matches_scope_filters({'Proxy Used': ' Enigma '}, proxies=['enigma']) is True
    assert crs.matches_scope_filters({'Proxy Used': 'SpyderProxy'}, proxies=['Enigma']) is False


def test_matches_scope_filters_proxies_multi_value_matches_any():
    assert crs.matches_scope_filters({'Proxy Used': 'Enigma'}, proxies=['Datarama', 'Enigma']) is True
    assert crs.matches_scope_filters({'Proxy Used': 'Proxio'}, proxies=['Datarama', 'Enigma']) is False


def test_matches_scope_filters_proxies_no_proxy_matches_blank_or_redacted():
    # "No Proxy" has no literal value in the data -- mirrors resolveProxyLabel's
    # blank-or-all-asterisk-redacted bucketing (src/lib/proxyAliases.ts).
    assert crs.matches_scope_filters({'Proxy Used': ''}, proxies=['No Proxy']) is True
    assert crs.matches_scope_filters({}, proxies=['No Proxy']) is True
    assert crs.matches_scope_filters({'Proxy Used': '***'}, proxies=['No Proxy']) is True
    assert crs.matches_scope_filters({'Proxy Used': 'Enigma'}, proxies=['No Proxy']) is False
    # A real proxy request must not accidentally match a blank entry.
    assert crs.matches_scope_filters({'Proxy Used': ''}, proxies=['Enigma']) is False


def test_matches_scope_filters_countries_matches_via_resolved_code():
    # Same convention AG/CG's --country CLI flag already uses: compare resolved
    # ISO codes so "Germany" and "DE" behave identically, not raw string equality.
    assert crs.matches_scope_filters({'Country': 'Germany'}, countries=['Germany']) is True
    assert crs.matches_scope_filters({'Country': 'DE'}, countries=['Germany']) is True
    assert crs.matches_scope_filters({'Country': 'Germany'}, countries=['Norway']) is False


def test_matches_scope_filters_countries_multi_value_matches_any():
    assert crs.matches_scope_filters({'Country': 'Norway'}, countries=['Germany', 'Norway']) is True
    assert crs.matches_scope_filters({'Country': 'Sweden'}, countries=['Germany', 'Norway']) is False


def test_matches_scope_filters_combines_all_filters_with_and():
    data = {'Brands': 'Rollero', 'Agent': 'Lai', 'Proxy Used': 'Enigma', 'Country': 'Germany'}
    assert crs.matches_scope_filters(data, brands={'Rollero'}, agents=['Lai'], proxies=['Enigma'], countries=['Germany']) is True
    # Any single mismatched filter fails the whole check.
    assert crs.matches_scope_filters(data, brands={'Rollero'}, agents=['Levi'], proxies=['Enigma'], countries=['Germany']) is False


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


def test_xpath_literal_wraps_plain_string_in_single_quotes():
    assert crs._xpath_literal('niklasweber') == "'niklasweber'"


def test_xpath_literal_uses_double_quotes_when_value_has_single_quote():
    assert crs._xpath_literal("o'brien") == '"o\'brien"'


def test_xpath_literal_uses_concat_when_value_has_both_quote_types():
    # Pathological but must not crash or produce invalid XPath — split on
    # single quotes and rejoin with an escaped single-quote literal.
    value = '''o'br"ien'''
    result = crs._xpath_literal(value)
    assert result == 'concat(\'o\', "\'", \'br"ien\')'


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


_NEXT_DATA_WITH_REVIEW_TEXT = '''<html><body><script id="__NEXT_DATA__" type="application/json">
{"props": {"pageProps": {"review": {"state": "published", "stars": 5, "text": "Das Casino ist sehr gut."}}}}
</script></body></html>'''

_NEXT_DATA_NO_TEXT_FIELD = '''<html><body><script id="__NEXT_DATA__" type="application/json">
{"props": {"pageProps": {"review": {"state": "published", "stars": 4}}}}
</script></body></html>'''

_NO_NEXT_DATA = '<html><body>thanks for your review</body></html>'


def test_parse_review_text_reads_text_field_from_next_data():
    assert crs.parse_review_text(_NEXT_DATA_WITH_REVIEW_TEXT) == 'Das Casino ist sehr gut.'


def test_parse_review_text_none_when_review_object_has_no_text_field():
    assert crs.parse_review_text(_NEXT_DATA_NO_TEXT_FIELD) is None


def test_parse_review_text_none_without_next_data_blob():
    assert crs.parse_review_text(_NO_NEXT_DATA) is None


def test_review_text_keys_are_stable():
    assert crs.REVIEW_TEXT_KEYS == {
        "tp": "TP Review Text",
        "ag": "AG Review Text",
        "cg": "CG Review Text",
        "wo": "WO Review Text",
    }


# ─── split_review_header / strip_trailing_helpful ────────────────────────────

_WO_CARD_TEXT_TWO_LINE_RATING = (
    "AManiaW\n"
    "July 20, 2026 17:51\n"
    "5\n"
    "/ 5\n"
    "I had a similar experience after cashing out around $180. The withdrawal "
    "was approved, and the money was in my bank account within three days. "
    "It's always good when the payout process is smooth."
)


def test_split_review_header_extracts_wo_username_date_rating():
    body, date, rating = crs.split_review_header(_WO_CARD_TEXT_TWO_LINE_RATING, "AManiaW")
    assert date == "July 20, 2026 17:51"
    assert rating == 5
    assert body.startswith("I had a similar experience")
    assert "AManiaW" not in body
    assert "July 20, 2026" not in body


def test_split_review_header_handles_combined_rating_line():
    text = "PlayerX\nJune 1, 2026\n4 / 5\nGreat casino, fast payouts."
    body, date, rating = crs.split_review_header(text, "PlayerX")
    assert date == "June 1, 2026"
    assert rating == 4
    assert body == "Great casino, fast payouts."


def test_split_review_header_no_change_when_username_not_found():
    text = "Just a review body with no byline at all."
    body, date, rating = crs.split_review_header(text, "SomeUser")
    assert body == text
    assert date is None
    assert rating is None


def test_split_review_header_no_change_when_no_header_after_username():
    # Common AG/CG shape: username IS present but nothing recognizable as a
    # date/rating line follows it — must be left untouched, not truncated.
    text = "ReviewerName\nThis review never renders a separate date/rating line."
    body, date, rating = crs.split_review_header(text, "ReviewerName")
    assert body == text
    assert date is None
    assert rating is None


def test_split_review_header_returns_input_unchanged_for_empty_text():
    assert crs.split_review_header("", "SomeUser") == ("", None, None)
    assert crs.split_review_header(None, "SomeUser") == (None, None, None)


def test_strip_trailing_helpful_removes_vote_count_line():
    text = "Great casino, would recommend.\nHelpful (12)"
    assert crs.strip_trailing_helpful(text) == "Great casino, would recommend."


def test_strip_trailing_helpful_no_change_without_marker():
    text = "Great casino, would recommend."
    assert crs.strip_trailing_helpful(text) == text


# ─── split_review_header: CasinoGuru badge + relative-date shape ─────────────
# Confirmed live 2026-08-11 against a real CasinoGuru card (Ivar88 @ Rooster
# Bet Casino) via a direct fetch_cg_review() dry-run on EC2.

_CG_CARD_TEXT_BADGE_RELATIVE_DATE = (
    "X\n"
    "Ivar88\n"
    "Bronze\n"
    "1 month ago\n"
    "Amazing and easy website. Great assistance by support. Reliable "
    "transactions and nice theme!\n"
    "Great theme\n"
    "Reliable transactions\n"
    "2\n"
    "Rooster Bet Casino\n"
    "1 month ago\n"
    "Hi Ivar88,\n"
    "Thank you for your wonderful review!"
)


def test_split_review_header_strips_cg_badge_and_relative_date():
    body, date, rating = crs.split_review_header(_CG_CARD_TEXT_BADGE_RELATIVE_DATE, "Ivar88")
    assert body.startswith("Amazing and easy website")
    assert "Bronze" not in body
    assert not body.startswith("1 month ago")


def test_split_review_header_relative_date_never_returned_as_date():
    # A relative date is real header signal (safe to strip) but too
    # imprecise to write into a Date column parsed as an absolute date
    # elsewhere (grace-period day-math) -- must always come back as None.
    _, date, _ = crs.split_review_header(_CG_CARD_TEXT_BADGE_RELATIVE_DATE, "Ivar88")
    assert date is None


def test_split_review_header_relative_date_alone_without_badge():
    text = "PlayerZ\nyesterday\nFast withdrawals, would play again."
    body, date, rating = crs.split_review_header(text, "PlayerZ")
    assert body == "Fast withdrawals, would play again."
    assert date is None
    assert rating is None


def test_split_review_header_badge_alone_without_corroborating_date_is_noop():
    # A tier badge by itself isn't proof of a header -- must not strip
    # anything unless a date/rating line immediately corroborates it.
    text = "PlayerY\nBronze\nJust a regular review with no further header line."
    body, date, rating = crs.split_review_header(text, "PlayerY")
    assert body == text
    assert date is None
    assert rating is None
