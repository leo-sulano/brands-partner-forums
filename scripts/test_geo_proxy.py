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


def test_configured_country_returns_local_bridge(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": "Germany"}) == \
        f"127.0.0.1:{geo_proxy.bridge_port_for_cc('de')}"


def test_country_name_is_case_insensitive(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": "GERMANY"}) == \
        f"127.0.0.1:{geo_proxy.bridge_port_for_cc('de')}"


def test_iso_code_accepted(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.geo_proxy_for_entry({"Country": "de"}) == \
        f"127.0.0.1:{geo_proxy.bridge_port_for_cc('de')}"


def test_bridge_port_is_deterministic_and_unique(monkeypatch):
    _base_env(monkeypatch)
    assert geo_proxy.bridge_port_for_cc("de") == geo_proxy.bridge_port_for_cc("de")
    assert geo_proxy.bridge_port_for_cc("de") != geo_proxy.bridge_port_for_cc("gb")
    assert geo_proxy.bridge_port_for_cc("de") >= geo_proxy.BRIDGE_PORT_BASE


def test_configured_ccs_reflects_env(monkeypatch):
    _base_env(monkeypatch)  # only ENIGMA_PW_DE set
    assert geo_proxy.configured_ccs() == ["de"]
    monkeypatch.setenv("ENIGMA_PW_GB", "pw-gb")
    assert set(geo_proxy.configured_ccs()) == {"de", "gb"}


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


def test_parse_country_ipinfo():
    assert geo_proxy._parse_country('{"ip":"1.2.3.4","country":"DE"}') == "de"


def test_parse_country_ipapi():
    assert geo_proxy._parse_country('{"countryCode":"GB","query":"1.2.3.4"}') == "gb"


def test_parse_country_garbage_returns_none():
    assert geo_proxy._parse_country("not json and no country") is None
