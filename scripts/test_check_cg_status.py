import check_cg_status as cgs


def _row(status: str, cg_link: str = 'https://casino.guru/x', cg_user: str = 'User1') -> dict:
    return {
        'id': 'row-1',
        'tab': 'Rooster Partners',
        'sheet_row_id': 'sr-1',
        'data': {
            'CG Review Status': status,
            'CG Review Link': cg_link,
            'CG User': cg_user,
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

    result = cgs.load_cg_entries('Rooster Partners', status_filter='live')

    assert len(result) == 1
    assert result[0]['data']['CG Review Status'] == 'Published'


def test_load_cg_entries_status_filter_removed_scopes_to_refused_and_removed(monkeypatch):
    rows = [_row('Done'), _row('Refused'), _row('Removed'), _row('Published')]
    monkeypatch.setattr(cgs, '_fetch_all', lambda params: rows)

    result = cgs.load_cg_entries('Rooster Partners', status_filter='removed')

    statuses = {r['data']['CG Review Status'] for r in result}
    assert statuses == {'Refused', 'Removed'}


def test_load_cg_entries_status_filter_unmapped_value_yields_no_entries(monkeypatch):
    rows = [_row('Done'), _row('Pending'), _row('Refused'), _row('Published')]
    monkeypatch.setattr(cgs, '_fetch_all', lambda params: rows)

    result = cgs.load_cg_entries('Rooster Partners', status_filter='on-pause')

    assert result == []
