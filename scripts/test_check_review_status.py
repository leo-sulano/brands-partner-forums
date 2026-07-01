import check_review_status as crs


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
