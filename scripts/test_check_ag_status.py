import check_ag_status as ags


def _row(status: str, ag_link: str = 'https://www.askgamblers.com/x', ag_user: str = 'User1', **extra) -> dict:
    return {
        'id': 'row-1',
        'tab': 'Rooster Partners',
        'sheet_row_id': 'sr-1',
        'data': {
            'AG Review Status': status,
            'AG Review Link': ag_link,
            'AG User': ag_user,
            **extra,
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

    result = ags.load_ag_entries('Rooster Partners', status_filters=['live'])

    assert len(result) == 1
    assert result[0]['data']['AG Review Status'] == 'Published'


def test_load_ag_entries_status_filter_removed_scopes_to_refused_and_removed(monkeypatch):
    rows = [_row('Done'), _row('Refused'), _row('Removed'), _row('Published')]
    monkeypatch.setattr(ags, '_fetch_all', lambda params: rows)

    result = ags.load_ag_entries('Rooster Partners', status_filters=['removed'])

    statuses = {r['data']['AG Review Status'] for r in result}
    assert statuses == {'Refused', 'Removed'}


def test_load_ag_entries_status_filter_on_pause_matches_substring(monkeypatch):
    # 'On Pause' isn't in AG's own CHECKABLE_STATUSES, so it's never picked up
    # by the default sweep — an explicit on-pause filter is the only way to
    # scope a check to these entries, matched by substring like the dashboard's
    # own isOnPause (`v.includes('pause')`).
    rows = [_row('Done'), _row('On Pause'), _row('Refused'), _row('Published')]
    monkeypatch.setattr(ags, '_fetch_all', lambda params: rows)

    result = ags.load_ag_entries('Rooster Partners', status_filters=['on-pause'])

    assert len(result) == 1
    assert result[0]['data']['AG Review Status'] == 'On Pause'


def test_load_ag_entries_scopes_by_brand_agent_proxy_country(monkeypatch):
    # Mirrors the dashboard's own Brand/Agent/Proxy/Country filter dropdowns —
    # a Check Status run can be scoped to exactly what's currently filtered.
    rows = [
        _row('Done', ag_user='Kauri80', Brands='Luckyvibe', Agent='Lai', **{'Proxy Used': 'Proxylite'}, Country='New Zealand'),
        _row('Done', ag_user='NiklasWeber', Brands='Rollero', Agent='Levi', **{'Proxy Used': 'Enigma'}, Country='Germany'),
    ]
    monkeypatch.setattr(ags, '_fetch_all', lambda params: rows)

    result = ags.load_ag_entries('Rooster Partners', brands=['Rollero'], agents=['Levi'], proxies=['Enigma'], countries=['Germany'])

    assert len(result) == 1
    assert result[0]['data']['AG User'] == 'NiklasWeber'


def test_load_ag_entries_scopes_by_multiple_agents(monkeypatch):
    rows = [
        _row('Done', ag_user='Kauri80', Agent='Lai'),
        _row('Done', ag_user='NiklasWeber', Agent='Levi'),
        _row('Done', ag_user='ThirdUser', Agent='Ann'),
    ]
    monkeypatch.setattr(ags, '_fetch_all', lambda params: rows)

    result = ags.load_ag_entries('Rooster Partners', agents=['Lai', 'Levi'])

    users = {r['data']['AG User'] for r in result}
    assert users == {'Kauri80', 'NiklasWeber'}
