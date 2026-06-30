#!/usr/bin/env python3
"""
geo_bridge.py — launch local pproxy bridges that add enigma auth for Chrome.

Chrome 149 removed Manifest-V2 extension support, so build_driver's old
proxy-auth extension no longer works. Instead we run one local, auth-free
pproxy listener per configured country; each forwards to the authenticated
enigma residential proxy for that country. Chrome then uses
--proxy-server=127.0.0.1:<port> (no extension, no auth) via build_driver.

`ensure_bridges()` is idempotent: it starts a bridge only if its port isn't
already listening, so it's safe to call at the start of every scraper run.

Env vars (EC2 ~/.env):
    ENIGMA_HOST, ENIGMA_PORT, ENIGMA_LOGIN
    ENIGMA_PW_<CC>   one per country (the password also marks a country "configured")

Requires: pip install pproxy
"""

import os
import socket
import subprocess
import sys
import time

from geo_proxy import configured_ccs, bridge_port_for_cc


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


_display = None


def ensure_display() -> bool:
    """Start a virtual X display (Xvfb) so Chrome can run NON-headless. AskGamblers
    (and CasinoGuru) sit behind Cloudflare's 'Just a moment' challenge, which blocks
    headless Chrome outright but auto-clears for a real headful browser. Returns True
    if a display is available (so the caller should run Chrome non-headless).
    Idempotent; no-op if a display already exists or Xvfb/pyvirtualdisplay is absent
    (e.g. local Windows dev), in which case the caller stays headless."""
    global _display
    if _display is not None:
        return True
    if os.environ.get("DISPLAY"):
        return True  # a real/existing display is present
    try:
        from pyvirtualdisplay import Display
        _display = Display(visible=0, size=(1366, 900))
        _display.start()
        print(f"  [display] started virtual display {_display.new_display_var}")
        return True
    except Exception as e:
        print(f"  [display] no virtual display ({e}) — staying headless")
        return False


def ensure_bridges() -> dict:
    """Start a local pproxy bridge for each configured country that isn't already
    listening. Returns {cc: port} for all configured countries. Safe to call
    repeatedly — existing bridges are left alone."""
    host = os.environ.get("ENIGMA_HOST")
    eport = os.environ.get("ENIGMA_PORT")
    login = os.environ.get("ENIGMA_LOGIN")
    bridges: dict = {}
    if not (host and eport and login):
        print("  [bridge] ENIGMA_HOST/PORT/LOGIN not set — no bridges started")
        return bridges

    started = []
    for cc in configured_ccs():
        port = bridge_port_for_cc(cc)
        bridges[cc] = port
        if _port_open(port):
            continue
        pw = os.environ.get(f"ENIGMA_PW_{cc.upper()}")
        remote = f"http://{host}:{eport}#{login}:{pw}"
        cmd = [sys.executable, "-m", "pproxy",
               "-l", f"http://127.0.0.1:{port}", "-r", remote]
        log = open(os.path.expanduser(f"~/pproxy_{cc}.log"), "a")
        # start_new_session so the bridge survives the scraper process exiting
        subprocess.Popen(cmd, stdout=log, stderr=log, start_new_session=True)
        started.append((cc, port))

    if started:
        # give freshly launched listeners a moment to bind
        time.sleep(3)
        for cc, port in started:
            ok = "ok" if _port_open(port) else "FAILED to bind"
            print(f"  [bridge] started {cc} -> 127.0.0.1:{port} ({ok})")
    return bridges


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
    result = ensure_bridges()
    print(f"Bridges configured: {result or '(none)'}")
