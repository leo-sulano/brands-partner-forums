import check_ag_status as ags


def _row(status: str, ag_link: str = 'https://www.askgamblers.com/x', ag_user: str = 'User1') -> dict:
    return {
        'id': 'row-1',
        'tab': 'Rooster Partners',
        'sheet_row_id': 'sr-1',
        'data': {
            'AG Review Status': status,
            'AG Review Link': ag_link,
            'AG User': ag_user,
        },
    }


def test_load_ag_entries_default_excludes_published(monkeypatch):
    # Real incident: Published entries were dropped from CHECKABLE_STATUSES to
    # avoid re-scraping every already-live account on every run — the default
    # (no status_filter) sweep must keep skipping them.
    rows = [_row('Done'), _row('Pending'), _row('Refused'), _row('Published')]
    monkeypatch.setattr(ags, '_fetch_all', lambda params: rows)

    result = ags.load_ag_entries('Rooster Partners')

    statuses = {r['data']['AG Review Status'] for r in result}
    assert statuses == {'Done', 'Pending', 'Refused'}


def test_load_ag_entries_status_filter_live_scopes_to_published(monkeypatch):
    # A user filtering the table to "Live" and clicking Check Status opts into
    # re-checking Published entries specifically — nothing else should qualify.
    rows = [_row('Done'), _row('Pending'), _row('Refused'), _row('Published')]
    monkeypatch.setattr(ags, '_fetch_all', lambda params: rows)

    result = ags.load_ag_entries('Rooster Partners', status_filter='live')

    assert len(result) == 1
    assert result[0]['data']['AG Review Status'] == 'Published'


def test_load_ag_entries_status_filter_removed_scopes_to_refused_and_removed(monkeypatch):
    rows = [_row('Done'), _row('Refused'), _row('Removed'), _row('Published')]
    monkeypatch.setattr(ags, '_fetch_all', lambda params: rows)

    result = ags.load_ag_entries('Rooster Partners', status_filter='removed')

    statuses = {r['data']['AG Review Status'] for r in result}
    assert statuses == {'Refused', 'Removed'}


def test_load_ag_entries_status_filter_unmapped_value_yields_no_entries(monkeypatch):
    # 'on-pause' / 'not-done' aren't checkable AG states — an explicit filter
    # scope with no mapping should check nothing rather than silently falling
    # back to the full default sweep.
    rows = [_row('Done'), _row('Pending'), _row('Refused'), _row('Published')]
    monkeypatch.setattr(ags, '_fetch_all', lambda params: rows)

    result = ags.load_ag_entries('Rooster Partners', status_filter='on-pause')

    assert result == []
