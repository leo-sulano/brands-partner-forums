#!/usr/bin/env python3
"""
status_server.py — Local HTTP bridge between the dashboard "Check Status"
button and the Selenium-based Trustpilot status checker.

Start this once before opening the dashboard:
    python scripts/status_server.py

The dashboard's VITE_CHECK_STATUS_URL must point to:
    http://localhost:5001/check-status
"""

import argparse
import logging
import os
import sys
import time
import threading

sys.path.insert(0, os.path.dirname(__file__))

# Suppress Flask/Werkzeug's per-request access log so the terminal window
# doesn't flash on every incoming HTTP request.
logging.getLogger('werkzeug').setLevel(logging.ERROR)

from flask import Flask, request, jsonify
from flask_cors import CORS

from check_review_status import (
    load_entries, build_driver, fetch_status,
    find_status_col, find_score_col, update_entry,
    BATCH_SIZE, DELAY_BETWEEN_BATCHES, CHROME_RESTART_EVERY,
    REVIEW_TEXT_KEYS,
)
from check_ag_status import check_ag_for_tab
from check_cg_status import check_cg_for_tab
from check_wo_status import check_wo_for_tab

app = Flask(__name__)
CORS(app, allow_headers=['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'])

# Shared secret. When set, every /check-status POST must present a matching
# `Authorization: Bearer <token>`. Required once the server is exposed publicly
# (e.g. via Cloudflare Tunnel) so strangers who find the URL can't trigger
# Selenium runs that write to the DB and Sheet. Loaded from scripts/.env
# (dotenv is already applied by the check_review_status import above).
CHECK_STATUS_TOKEN = os.environ.get('CHECK_STATUS_TOKEN', '').strip()

_tab_locks: dict[str, threading.Lock] = {}
_tab_locks_mutex = threading.Lock()
_active_tabs: set[str] = set()

# The EC2 host is a t2.small (2GB RAM) -- one Chrome+Selenium session already
# uses several hundred MB, and two running at once (e.g. a TP check on one
# tab overlapping an AG check on another) has been observed crashing Chrome
# under memory pressure, which then cascades into "errors" for every
# remaining entry in that run. The per-tab locks above only stop the *same*
# tab/platform from double-running, so a second, global lock serializes
# every platform's Selenium run across the whole box.
_global_run_lock = threading.Lock()
CONCURRENT_CHECK_ERROR = (
    'Another check is already running on the server (a different tab or platform) '
    '-- only one can run at a time. Wait for it to finish and retry.'
)


def _get_tab_lock(key: str) -> threading.Lock:
    with _tab_locks_mutex:
        if key not in _tab_locks:
            _tab_locks[key] = threading.Lock()
        return _tab_locks[key]


def _is_authorized() -> bool:
    if not CHECK_STATUS_TOKEN:
        return True  # no token configured -> local-only / open mode
    auth = request.headers.get('Authorization', '')
    presented = auth[7:].strip() if auth.startswith('Bearer ') else ''
    return presented == CHECK_STATUS_TOKEN


# Trustpilot and AskGamblers/CasinoGuru have opposite headless-Chrome tolerances
# on this host: Trustpilot's bot check ("Verifying Connection") trips on a real
# headful browser but passes headless, while Cloudflare's challenge on
# AskGamblers/CasinoGuru does the reverse (blocks headless, clears for headful)
# -- confirmed empirically 2026-07-09 (3/3 vs 3/3 trials each way). A single
# global --no-headless launch flag can't satisfy both, so each platform gets
# its own fixed setting instead of trusting app.config['HEADLESS']. WO showed
# no preference either way in testing, so it's grouped with AG/CG.
PLATFORM_HEADLESS = {'tp': True, 'ag': False, 'cg': False, 'wo': False}


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'ok': True})


@app.route('/check-status', methods=['POST', 'OPTIONS'])
def check_status():
    if request.method == 'OPTIONS':
        return '', 204

    if not _is_authorized():
        return jsonify({'error': 'Unauthorized — missing or invalid token'}), 401

    body = request.get_json(silent=True) or {}
    tab: str | None = body.get('tab')
    include_published: bool = bool(body.get('include_published', False))
    platform: str = (body.get('platform') or 'tp').lower()
    brands: list[str] | None = body.get('brands') or None
    status_filters: list[str] | None = body.get('status_filters') or None
    agents: list[str] | None = body.get('agents') or None
    proxies: list[str] | None = body.get('proxies') or None
    countries: list[str] | None = body.get('countries') or None

    # Platform-namespaced lock so TP/AG/CG/WO can run concurrently on the same tab.
    # TP keeps its legacy key format for backwards compat with any running checks.
    tab_key = tab or '__all__' if platform == 'tp' else f'{platform}__{tab or "__all__"}'

    lock = _get_tab_lock(tab_key)
    if not lock.acquire(blocking=False):
        return jsonify({'error': 'A check is already running for this brand — wait and retry'}), 409

    if not _global_run_lock.acquire(blocking=False):
        lock.release()
        return jsonify({'error': CONCURRENT_CHECK_ERROR}), 409

    _active_tabs.add(tab_key)
    scope = f'tab: {tab}' if tab else 'all tabs'
    try:
        # Dispatch non-TP platforms to their dedicated checkers.
        if platform == 'ag':
            print(f'\n[server] AG check started ({scope})')
            result = check_ag_for_tab(tab, include_published=include_published, headless=PLATFORM_HEADLESS['ag'],
                                       status_filters=status_filters, brands=brands, agents=agents,
                                       proxies=proxies, countries=countries)
            print(f'[server] AG done. {result}')
            return jsonify(result)

        if platform == 'cg':
            print(f'\n[server] CG check started ({scope})')
            result = check_cg_for_tab(tab, include_published=include_published, headless=PLATFORM_HEADLESS['cg'],
                                       status_filters=status_filters, brands=brands, agents=agents,
                                       proxies=proxies, countries=countries)
            print(f'[server] CG done. {result}')
            return jsonify(result)

        if platform == 'wo':
            print(f'\n[server] WO check started ({scope})')
            result = check_wo_for_tab(tab, include_published=include_published, headless=PLATFORM_HEADLESS['wo'],
                                       status_filters=status_filters, brands=brands, agents=agents,
                                       proxies=proxies, countries=countries)
            print(f'[server] WO done. {result}')
            return jsonify(result)

        # Default: TP Selenium check.
        entries = load_entries(tab, include_published=include_published, brands=brands,
                                status_filters=status_filters, agents=agents, proxies=proxies, countries=countries)
        # Rotation removed (2026-08-25); the unscoped-run cap that replaced it was
        # itself removed (2026-08-26) -- every brand is eligible every day, and a
        # filter-free click checks every eligible entry on the tab, however many
        # that is.
        skipped_group = 0
        total = len(entries)
        print(f'\n[server] TP check started — {total} entries ({scope})')

        if not total:
            return jsonify({'checked': 0, 'updated': 0, 'errors': 0, 'total': 0, 'skipped_group': skipped_group})

        driver = build_driver(headless=PLATFORM_HEADLESS['tp'])
        checked = updated = errors = sheet_errors = 0

        try:
            for i in range(0, total, BATCH_SIZE):
                batch = entries[i : i + BATCH_SIZE]
                for entry in batch:
                    checked += 1

                    # Restart Chrome every N entries -- same safeguard check_review_status.py's
                    # own CLI path (and the AG/CG checkers) already use; this loop was the one
                    # place missing it, which is why multi-hour "all tabs" runs would hang partway
                    # through once the long-lived renderer process degraded.
                    if checked > 1 and (checked - 1) % CHROME_RESTART_EVERY == 0:
                        print(f'  ... restarting Chrome at entry {checked}/{total}\n')
                        try:
                            driver.quit()
                        except Exception:
                            pass
                        driver = build_driver(headless=PLATFORM_HEADLESS['tp'])

                    data: dict = entry['data']
                    status_col = find_status_col(data)
                    score_col = find_score_col(data)
                    current: str = data.get(status_col, '') or ''
                    current_score: str = str(data.get(score_col, '') or '') if score_col else ''
                    url: str = data['Link to the profile']

                    print(f'  [{checked}/{total}] {url}')
                    new_status, new_rating, new_review_text = fetch_status(driver, url)

                    if new_status is None:
                        print(f'    -> could not determine (skipped)')
                        errors += 1
                        continue

                    updates: dict[str, str] = {}
                    if new_status != current:
                        updates[status_col] = new_status
                    new_score_str = str(new_rating) if new_rating is not None else None
                    is_boolean_col = current_score.strip().lower() in {"yes", "no", ""}
                    if score_col and new_score_str and new_score_str != current_score and not is_boolean_col:
                        updates[score_col] = new_score_str
                    current_review_text = data.get(REVIEW_TEXT_KEYS['tp']) or ''
                    if new_review_text and new_review_text != current_review_text:
                        updates[REVIEW_TEXT_KEYS['tp']] = new_review_text

                    if not updates:
                        print(f'    -> {current!r} *{current_score or "-"} (no change)')
                        continue

                    sheet_ok = update_entry(entry['id'], data, updates,
                                 tab=entry.get('tab'), sheet_row_id=entry.get('sheet_row_id'))
                    if not sheet_ok:
                        sheet_errors += 1
                    print(f'    -> {current!r} -> {new_status!r} *{new_rating or "-"} (sheet: {"ok" if sheet_ok else "FAILED"})')
                    updated += 1

                remaining = total - (i + len(batch))
                if remaining > 0:
                    time.sleep(DELAY_BETWEEN_BATCHES)
        finally:
            driver.quit()

        print(f'[server] Done. checked={checked} updated={updated} errors={errors} sheet_errors={sheet_errors}')
        return jsonify({'checked': checked, 'updated': updated, 'errors': errors, 'sheet_errors': sheet_errors, 'total': total, 'skipped_group': skipped_group})

    finally:
        _active_tabs.discard(tab_key)
        _global_run_lock.release()
        lock.release()


@app.route('/check-ag-status', methods=['POST', 'OPTIONS'])
def check_ag_status_route():
    if request.method == 'OPTIONS':
        return '', 204

    if not _is_authorized():
        return jsonify({'error': 'Unauthorized — missing or invalid token'}), 401

    body = request.get_json(silent=True) or {}
    tab: str | None = body.get('tab')
    include_published: bool = bool(body.get('include_published', False))
    status_filters: list[str] | None = body.get('status_filters') or None
    brands: list[str] | None = body.get('brands') or None
    agents: list[str] | None = body.get('agents') or None
    proxies: list[str] | None = body.get('proxies') or None
    countries: list[str] | None = body.get('countries') or None
    tab_key = f'ag__{tab or "__all__"}'

    lock = _get_tab_lock(tab_key)
    if not lock.acquire(blocking=False):
        return jsonify({'error': 'A check is already running for this brand — wait and retry'}), 409

    if not _global_run_lock.acquire(blocking=False):
        lock.release()
        return jsonify({'error': CONCURRENT_CHECK_ERROR}), 409

    _active_tabs.add(tab_key)
    try:
        scope = f'tab: {tab}' if tab else 'all tabs'
        print(f'\n[server] AG check started ({scope})')
        result = check_ag_for_tab(tab, include_published=include_published, headless=PLATFORM_HEADLESS['ag'],
                                   status_filters=status_filters, brands=brands, agents=agents,
                                   proxies=proxies, countries=countries)
        print(f'[server] AG done. {result}')
        return jsonify(result)
    finally:
        _active_tabs.discard(tab_key)
        _global_run_lock.release()
        lock.release()


@app.route('/check-cg-status', methods=['POST', 'OPTIONS'])
def check_cg_status_route():
    if request.method == 'OPTIONS':
        return '', 204

    if not _is_authorized():
        return jsonify({'error': 'Unauthorized — missing or invalid token'}), 401

    body = request.get_json(silent=True) or {}
    tab: str | None = body.get('tab')
    include_published: bool = bool(body.get('include_published', False))
    status_filters: list[str] | None = body.get('status_filters') or None
    brands: list[str] | None = body.get('brands') or None
    agents: list[str] | None = body.get('agents') or None
    proxies: list[str] | None = body.get('proxies') or None
    countries: list[str] | None = body.get('countries') or None
    tab_key = f'cg__{tab or "__all__"}'

    lock = _get_tab_lock(tab_key)
    if not lock.acquire(blocking=False):
        return jsonify({'error': 'A check is already running for this brand — wait and retry'}), 409

    if not _global_run_lock.acquire(blocking=False):
        lock.release()
        return jsonify({'error': CONCURRENT_CHECK_ERROR}), 409

    _active_tabs.add(tab_key)
    try:
        scope = f'tab: {tab}' if tab else 'all tabs'
        print(f'\n[server] CG check started ({scope})')
        result = check_cg_for_tab(tab, include_published=include_published, headless=PLATFORM_HEADLESS['cg'],
                                   status_filters=status_filters, brands=brands, agents=agents,
                                   proxies=proxies, countries=countries)
        print(f'[server] CG done. {result}')
        return jsonify(result)
    finally:
        _active_tabs.discard(tab_key)
        _global_run_lock.release()
        lock.release()


@app.route('/check-wo-status', methods=['POST', 'OPTIONS'])
def check_wo_status_route():
    if request.method == 'OPTIONS':
        return '', 204

    if not _is_authorized():
        return jsonify({'error': 'Unauthorized — missing or invalid token'}), 401

    body = request.get_json(silent=True) or {}
    tab: str | None = body.get('tab')
    include_published: bool = bool(body.get('include_published', False))
    status_filters: list[str] | None = body.get('status_filters') or None
    brands: list[str] | None = body.get('brands') or None
    agents: list[str] | None = body.get('agents') or None
    proxies: list[str] | None = body.get('proxies') or None
    countries: list[str] | None = body.get('countries') or None
    tab_key = f'wo__{tab or "__all__"}'

    lock = _get_tab_lock(tab_key)
    if not lock.acquire(blocking=False):
        return jsonify({'error': 'A check is already running for this brand — wait and retry'}), 409

    if not _global_run_lock.acquire(blocking=False):
        lock.release()
        return jsonify({'error': CONCURRENT_CHECK_ERROR}), 409

    _active_tabs.add(tab_key)
    try:
        scope = f'tab: {tab}' if tab else 'all tabs'
        print(f'\n[server] WO check started ({scope})')
        result = check_wo_for_tab(tab, include_published=include_published, headless=PLATFORM_HEADLESS['wo'],
                                   status_filters=status_filters, brands=brands, agents=agents,
                                   proxies=proxies, countries=countries)
        print(f'[server] WO done. {result}')
        return jsonify(result)
    finally:
        _active_tabs.discard(tab_key)
        _global_run_lock.release()
        lock.release()


@app.route('/active-checks', methods=['GET'])
def active_checks():
    if not _is_authorized():
        return jsonify({'error': 'Unauthorized'}), 401
    return jsonify({'active': list(_active_tabs)})


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Local Selenium status-check server')
    ap.add_argument('--port', type=int, default=5001)
    # Accepted for compatibility with existing launch scripts (start_status_server*,
    # watchdog.ps1) but no longer changes checker behavior -- see PLATFORM_HEADLESS.
    ap.add_argument('--no-headless', dest='headless', action='store_false',
                     help='(no-op; each platform now fixes its own Chrome mode)')
    ap.set_defaults(headless=True)
    args = ap.parse_args()

    print(f'[server] Listening on http://localhost:{args.port}')
    print(f'[server] VITE_CHECK_STATUS_URL=http://localhost:{args.port}/check-status')
    if CHECK_STATUS_TOKEN:
        print('[server] Token auth ENABLED (CHECK_STATUS_TOKEN is set)')
    else:
        print('[server] WARNING: no CHECK_STATUS_TOKEN set — endpoint is OPEN. '
              'Set one before exposing this server publicly (e.g. via a tunnel).')
    app.run(host='0.0.0.0', port=args.port, debug=False, threaded=True)
