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
import os
import sys
import time
import threading

sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, request, jsonify
from flask_cors import CORS

from check_review_status import (
    load_entries, build_driver, fetch_status,
    find_status_col, update_entry,
    BATCH_SIZE, DELAY_BETWEEN_BATCHES,
)

app = Flask(__name__)
CORS(app)

_lock = threading.Lock()


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'ok': True})


@app.route('/check-status', methods=['POST', 'OPTIONS'])
def check_status():
    if request.method == 'OPTIONS':
        return '', 204

    if not _lock.acquire(blocking=False):
        return jsonify({'error': 'A check is already running — wait and retry'}), 409

    try:
        body = request.get_json(silent=True) or {}
        tab: str | None = body.get('tab')

        entries = load_entries(tab)
        total = len(entries)
        scope = f'tab: {tab}' if tab else 'all tabs'
        print(f'\n[server] Check started — {total} entries ({scope})')

        if not total:
            return jsonify({'checked': 0, 'updated': 0, 'errors': 0, 'total': 0})

        headless: bool = app.config.get('HEADLESS', False)
        driver = build_driver(headless=headless)
        checked = updated = errors = 0

        try:
            for i in range(0, total, BATCH_SIZE):
                batch = entries[i : i + BATCH_SIZE]
                for entry in batch:
                    checked += 1
                    data: dict = entry['data']
                    status_col = find_status_col(data)
                    current: str = data.get(status_col, '') or ''
                    url: str = data['Link to the profile']

                    print(f'  [{checked}/{total}] {url}')
                    new_status = fetch_status(driver, url)

                    if new_status is None:
                        print(f'    -> could not determine (skipped)')
                        errors += 1
                    elif new_status != current:
                        update_entry(entry['id'], data, status_col, new_status)
                        print(f'    -> {current!r} -> {new_status!r}')
                        updated += 1
                    else:
                        print(f'    -> {current!r} (no change)')

                remaining = total - (i + len(batch))
                if remaining > 0:
                    time.sleep(DELAY_BETWEEN_BATCHES)
        finally:
            driver.quit()

        print(f'[server] Done. checked={checked} updated={updated} errors={errors}')
        return jsonify({'checked': checked, 'updated': updated, 'errors': errors, 'total': total})

    finally:
        _lock.release()


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Local Selenium status-check server')
    ap.add_argument('--port', type=int, default=5001)
    ap.add_argument('--headless', action='store_true', help='Run Chrome headless')
    args = ap.parse_args()

    app.config['HEADLESS'] = args.headless
    print(f'[server] Listening on http://localhost:{args.port}')
    print(f'[server] VITE_CHECK_STATUS_URL=http://localhost:{args.port}/check-status')
    app.run(port=args.port, debug=False, threaded=True)
