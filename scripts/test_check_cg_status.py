import check_cg_status as cgs


def _row(status: str, cg_link: str = 'https://casino.guru/x', cg_user: str = 'User1', **extra) -> dict:
    return {
        'id': 'row-1',
        'tab': 'Rooster Partners',
        'sheet_row_id': 'sr-1',
        'data': {
            'CG Review Status': status,
            'CG Review Link': cg_link,
            'CG User': cg_user,
            **extra,
        },
    }


def test_load_cg_entries_default_excludes_published(monkeypatch):
    rows = [_row('Done'), _row('Pending'), _row('Refused'), _row('Published')]
    monkeypatch.setattr(cgs, '_fetch_all', lambda params: rows)

    result = cgs.load_cg_entries('Rooster Partners')

    statuses = {r['data']['CG Review Status'] for r in result}
    assert statuses == {'Done', 'Pending', 'Refused'}


def test_load_cg_entries_status_filter_live_scopes_to_published(monkeypatch):
    rows = [_row('Done'), _row('Pending'), _row('Refused'), _row('Published')]
    monkeypatch.setattr(cgs, '_fetch_all', lambda params: rows)

    result = cgs.load_cg_entries('Rooster Partners', status_filters=['live'])

    assert len(result) == 1
    assert result[0]['data']['CG Review Status'] == 'Published'


def test_load_cg_entries_status_filter_removed_scopes_to_refused_and_removed(monkeypatch):
    rows = [_row('Done'), _row('Refused'), _row('Removed'), _row('Published')]
    monkeypatch.setattr(cgs, '_fetch_all', lambda params: rows)

    result = cgs.load_cg_entries('Rooster Partners', status_filters=['removed'])

    statuses = {r['data']['CG Review Status'] for r in result}
    assert statuses == {'Refused', 'Removed'}


def test_load_cg_entries_status_filter_on_pause_matches_substring(monkeypatch):
    rows = [_row('Done'), _row('On Pause'), _row('Refused'), _row('Published')]
    monkeypatch.setattr(cgs, '_fetch_all', lambda params: rows)

    result = cgs.load_cg_entries('Rooster Partners', status_filters=['on-pause'])

    assert len(result) == 1
    assert result[0]['data']['CG Review Status'] == 'On Pause'


def test_load_cg_entries_scopes_by_brand_agent_proxy_country(monkeypatch):
    rows = [
        _row('Done', cg_user='Kauri80', Brands='Luckyvibe', Agent='Lai', **{'Proxy Used': 'Proxylite'}, Country='New Zealand'),
        _row('Done', cg_user='NiklasWeber', Brands='Rollero', Agent='Levi', **{'Proxy Used': 'Enigma'}, Country='Germany'),
    ]
    monkeypatch.setattr(cgs, '_fetch_all', lambda params: rows)

    result = cgs.load_cg_entries('Rooster Partners', brands=['Rollero'], agents=['Levi'], proxies=['Enigma'], countries=['Germany'])

    assert len(result) == 1
    assert result[0]['data']['CG User'] == 'NiklasWeber'


def test_load_cg_entries_scopes_by_multiple_countries(monkeypatch):
    rows = [
        _row('Done', cg_user='Kauri80', Country='Germany'),
        _row('Done', cg_user='NiklasWeber', Country='Norway'),
        _row('Done', cg_user='ThirdUser', Country='Sweden'),
    ]
    monkeypatch.setattr(cgs, '_fetch_all', lambda params: rows)

    result = cgs.load_cg_entries('Rooster Partners', countries=['Germany', 'Norway'])

    users = {r['data']['CG User'] for r in result}
    assert users == {'Kauri80', 'NiklasWeber'}
