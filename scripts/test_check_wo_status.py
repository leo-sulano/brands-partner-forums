import check_wo_status as wos


def _row(status: str, link: str = 'https://wizardofodds.com/x', user: str = 'User1', **extra) -> dict:
    return {
        'id': 'row-1',
        'tab': 'Wizard of Odds',
        'sheet_row_id': 'sr-1',
        'data': {
            'WoO Review Status': status,
            'Link to the profile': link,
            'WoO User': user,
            **extra,
        },
    }


def test_load_wo_entries_paginates_via_fetch_all(monkeypatch):
    # load_wo_entries previously issued a single unpaginated request, silently
    # truncating at Supabase's 1000-row cap for any tab with more entries — the
    # same class of bug fixed for TP/AG/CG. It must go through the shared,
    # deterministically-ordered paginating helper instead.
    rows = [_row('Done')]
    captured = {}

    def fake_fetch_all(params):
        captured['params'] = params
        return rows

    monkeypatch.setattr(wos, '_fetch_all', fake_fetch_all)

    result = wos.load_wo_entries('Wizard of Odds')

    assert captured['params']['tab'] == 'eq.Wizard of Odds'
    assert len(result) == 1


def test_load_wo_entries_default_excludes_refused_and_removed(monkeypatch):
    rows = [_row('Done'), _row('Pending'), _row('Published'), _row('Refused'), _row('Removed')]
    monkeypatch.setattr(wos, '_fetch_all', lambda params: rows)

    result = wos.load_wo_entries('Wizard of Odds')

    statuses = {r['data']['WoO Review Status'] for r in result}
    assert statuses == {'Done', 'Pending', 'Published'}


def test_load_wo_entries_status_filter_removed_scopes_to_refused_and_removed(monkeypatch):
    rows = [_row('Done'), _row('Refused'), _row('Removed'), _row('Published')]
    monkeypatch.setattr(wos, '_fetch_all', lambda params: rows)

    result = wos.load_wo_entries('Wizard of Odds', status_filters=['removed'])

    statuses = {r['data']['WoO Review Status'] for r in result}
    assert statuses == {'Refused', 'Removed'}


def test_load_wo_entries_status_filter_not_done_matches_substring(monkeypatch):
    rows = [_row('Done'), _row('Not done'), _row('Pending'), _row('Published')]
    monkeypatch.setattr(wos, '_fetch_all', lambda params: rows)

    result = wos.load_wo_entries('Wizard of Odds', status_filters=['not-done'])

    assert len(result) == 1
    assert result[0]['data']['WoO Review Status'] == 'Not done'


def test_load_wo_entries_scopes_by_brand_agent_proxy_country(monkeypatch):
    rows = [
        _row('Done', user='Kauri80', **{'Brand Name': 'Luckyvibe', 'Proxy Used': 'Proxylite'}, Agent='Lai', Country='New Zealand'),
        _row('Done', user='NiklasWeber', **{'Brand Name': 'Rollero', 'Proxy Used': 'Enigma'}, Agent='Levi', Country='Germany'),
    ]
    monkeypatch.setattr(wos, '_fetch_all', lambda params: rows)

    result = wos.load_wo_entries('Wizard of Odds', brands=['Rollero'], agents=['Levi'], proxies=['Enigma'], countries=['Germany'])

    assert len(result) == 1
    assert result[0]['data']['WoO User'] == 'NiklasWeber'


def test_load_wo_entries_scopes_by_no_proxy(monkeypatch):
    rows = [
        _row('Done', user='Kauri80', **{'Proxy Used': ''}),
        _row('Done', user='NiklasWeber', **{'Proxy Used': 'Enigma'}),
    ]
    monkeypatch.setattr(wos, '_fetch_all', lambda params: rows)

    result = wos.load_wo_entries('Wizard of Odds', proxies=['No Proxy'])

    assert len(result) == 1
    assert result[0]['data']['WoO User'] == 'Kauri80'


class _FakeDriver:
    current_url = 'https://wizardofodds.com/online-casinos/reviews/test-casino/'
    page_source = '<html>no match here</html>'

    def get(self, url):
        pass

    def find_elements(self, by, value):
        return []


def test_fetch_wo_review_does_not_crash_when_user_not_found(monkeypatch):
    # fetch_wo_review referenced an undefined MAX_LOAD_MORE constant, so every
    # real call raised NameError and was counted as an error — a 100% failure
    # rate for WO Check Status confirmed live in production 2026-07-10.
    monkeypatch.setattr(wos.time, 'sleep', lambda *_: None)

    status, rating, review_text, review_date = wos.fetch_wo_review(_FakeDriver(), 'https://wizardofodds.com/x', 'NoSuchUser')

    assert (status, rating, review_text, review_date) == (None, None, None, None)
