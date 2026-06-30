import importlib
import geo_proxy


def reload_with_env(monkeypatch, **env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    return importlib.reload(geo_proxy)


def _base_env(monkeypatch):
    monkeypatch.setenv("ENIGMA_HOST", "resi.enigmaproxy.net")
    monkeypatch.setenv("ENIGMA_PORT", "12321")
    monkeypatch.setenv("ENIGMA_LOGIN", "0048277fc210")
    monkeypatch.setenv("ENIGMA_PW_DE", "pw-de")


def test_configured_country_returns_proxy(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": "Germany"}) == \
        "resi.enigmaproxy.net:12321:0048277fc210:pw-de"


def test_country_name_is_case_insensitive(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": "GERMANY"}) == \
        "resi.enigmaproxy.net:12321:0048277fc210:pw-de"


def test_iso_code_accepted(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": "de"}) == \
        "resi.enigmaproxy.net:12321:0048277fc210:pw-de"


def test_blank_country_returns_empty(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": ""}) == ""
    assert geo_proxy.geo_proxy_for_entry({}) == ""


def test_unknown_country_returns_empty(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": "Atlantis"}) == ""


def test_missing_password_returns_empty(monkeypatch):
    _base_env(monkeypatch)
    # GB has no ENIGMA_PW_GB set
    assert geo_proxy.geo_proxy_for_entry({"Country": "United Kingdom"}) == ""


def test_country_code_for_entry(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.country_code_for_entry({"Country": "Germany"}) == "de"
    assert geo_proxy.country_code_for_entry({"Country": ""}) is None
