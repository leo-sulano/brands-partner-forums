# EC2 Scraper Runbook

Maintenance, troubleshooting, and update guide for the `scraper-leo` EC2 instance running `check_review_status.py`.

---

## Instance Details

| Field | Value |
|---|---|
| Instance name | scraper-leo |
| Instance ID | i-053ee746559bb2cc4 |
| Public IP | 54.179.186.205 (auto-assigned — changes on stop/start) |
| Region | ap-southeast-1 (Singapore) |
| Type | t2.small |
| OS | Amazon Linux 2023 |
| Key file | `C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem` |

> **Note:** The public IP changes every time the instance is stopped and restarted. See [Elastic IP](#elastic-ip) if this becomes a problem.

---

## Co-tenant: LinkOps Worker (2026-08-14)

This box also runs the **Link-Ops-Outreach** project's lead-scraping worker, deployed under
PM2 as a separate process — entirely isolated from everything else in this runbook:

| Field | Value |
|---|---|
| Directory | `~/linkops-worker/` (own `node_modules`, own `.env.local` — never touches `~/.env`) |
| Process manager | PM2, process name `linkops-worker` (`pm2 logs linkops-worker`, `pm2 restart linkops-worker`) |
| Runtime | Node.js 20 (installed via NodeSource, additive — does not affect the Python/dnf toolchain above) |
| Source | `worker/` + `lib/leads/{sheets-service,enrichment}.ts` from the Link-Ops-Outreach repo |

**Co-tenancy guard:** this box has a documented history of Chrome crashing under concurrent
load (see [Weekly All-Platform Cron Job](#weekly-all-platform-cron-job-removed-2026-08-17), Task 128).
To avoid colliding with this project's Chrome-heavy cron jobs, the LinkOps worker's `.env.local`
sets `LINKOPS_AVOID_CRON_WINDOW` — it pauses claiming new jobs during that window and resumes
automatically after. This is a no-op everywhere else (unset by default), so it's safe in the
worker's own repo history.

**Widened 2026-08-17** from `00:55-01:35` to **`00:55-10:00`**: the original 40-minute window only
covered the weekly job's *start*, but that job (now removed, see above) had already been observed
running past 06:29 UTC on a single Monday — the LinkOps worker resumed claiming jobs at 01:35 while
the scraper was still deep into AG/CG, and got OOM-killed itself the same day (2026-08-17 02:03:38
UTC, confirmed via `journalctl -k`). Now that the weekly job is removed entirely, this window is
mostly a leftover safety margin against the daily `check_brand_page_removed.py` run (which is much
shorter) — narrow it back down if that's ever confirmed unnecessary.

**Full detail** (update workflow, housekeeping, PM2 log rotation, when to reconsider a dedicated
box) lives in the Link-Ops-Outreach repo's own `docs/ec2-worker-runbook.md`, not duplicated here.

If this box ever needs to be replaced (see [Full Fresh Setup](#full-fresh-setup-if-the-instance-is-ever-replaced)),
the LinkOps worker needs its own re-deploy — it is not part of that section's steps.

---

## Connecting

```bash
ssh -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" ec2-user@54.179.186.205
```

If the IP has changed, get the new one from the AWS Console → EC2 → Instances → scraper-leo.

---

## Routine Maintenance Checklist

The one-stop sequence for a periodic check-in on the box — pulls together the health signals and cleanup jobs that live in their own sections further down.

**1. Connect**
```bash
ssh -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" ec2-user@54.179.186.205
```

**2. Health check**
```bash
df -h /                                                # disk usage — investigate if over ~80%
sudo systemctl status status-server.service --no-pager  # is the API server up? active/crash-looping?
ps aux | grep -E 'status_server|check_review_status'   # anything stuck, or an orphan not managed by systemd?
crontab -l                                             # should show 3 jobs: daily brand-removal check, tmp sweep, weekly dnf clean (weekly all-platform scraper removed 2026-08-17)
tail -30 ~/scraper.log                                 # last scraper run — any errors?
sudo journalctl -u status-server.service -n 30 --no-pager  # status server logs — ~/server.log is stale (systemd's stdout goes to journald, not that file)
```

**3. Manual cache cleanup** (if disk looks high before the scheduled jobs would run — see [Maintenance / Cache Cleanup](#maintenance--cache-cleanup) for what these normally run on)
```bash
~/cleanup_tmp.sh                             # sweep stale /tmp Chrome profiles now
sudo dnf clean all                           # clear dnf metadata cache now
sudo logrotate -f /etc/logrotate.d/scraper   # force log rotation now instead of waiting for midnight
```

**4. Restart the status server** (if it's down, or serving stale code after a deploy — see [Status Server](#status-server-flask-api-for-dashboard-check-status-button))
```bash
sudo systemctl restart status-server.service
sudo systemctl is-active status-server.service   # should print "active"
curl -s http://127.0.0.1:5001/health              # should print {"ok":true}
```
Never `pkill -f status_server` + `nohup` — the service runs under systemd (`Restart=always`)
as of 2026-07-10, and a manual pkill/nohup races systemd for port 5001 instead of replacing
the process it manages, leaving an unmanaged orphan process serving traffic while systemd
crash-loops in the background trying to rebind the same port forever (confirmed live
2026-08-26 — a prior deploy's manual restart caused exactly this, ~9,400 failed systemd
restarts over 24h, undetected because the orphan kept `/health` answering fine the whole
time).

**5. If the instance was stopped and restarted**, the public IP changes (see [Elastic IP](#elastic-ip)):
- Update the `ssh`/`scp` commands throughout this doc with the new IP
- Re-point the Edge Function: `supabase secrets set EC2_STATUS_URL=http://<new-ip>:5001`

---

## Running the Script

### Dry run (no writes — always test first)
```bash
python3 ~/check_review_status.py --dry-run --headless
```

### Real run (writes to Supabase + syncs Sheet)
```bash
python3 ~/check_review_status.py --headless
```

### Restrict to one tab
```bash
python3 ~/check_review_status.py --headless --tab "Rooster Partners"
```

### Run in background (so SSH disconnect doesn't kill it)
```bash
nohup python3 ~/check_review_status.py --headless > ~/scraper.log 2>&1 &
echo "PID: $!"
```

### Tail the log while it runs in background
```bash
tail -f ~/scraper.log
```

### Check if it's still running
```bash
ps aux | grep check_review_status
```

### Kill a running job
```bash
kill <PID>
# or kill all at once:
pkill -f check_review_status
```

---

## Weekly All-Platform Cron Job (removed 2026-08-17)

**Status: removed from crontab.** After this job triggered a box-wide hang on 2026-08-17 (CG ran
2+ hours degraded with repeated Chrome renderer timeouts, WO then started into an already
memory-starved box and the whole instance stopped responding — SSH included — until a hard
reboot), the `0 1 * * 1 run_weekly_all_platforms.sh` crontab line was deleted by deliberate
decision, not as a side effect of the OOM/swap fixes below. TP/AG/CG/WO status now **only**
refreshes when someone clicks "Check Status" in the dashboard — there is no automated schedule
for any of the 4 platforms anymore. Only the daily TP brand-page-removal check
(`check_brand_page_removed.py`, see below) remains scheduled. The script (`~/run_weekly_all_platforms.sh`)
and its `.bak` crontab (`~/crontab.bak.20260817`) are still on the box if this ever needs
reinstating — see [Brand Schedule Groups](#brand-schedule-groups) for the group-rotation logic it
relied on, still intact and still usable by a manually-run `run_weekly_all_platforms.sh` or a future
replacement schedule.

Added 2026-08-10/11 alongside the review-text fetch/store feature. AG/CG/WO previously had no
schedule at all — they only ran when someone clicked "Check Status" in the dashboard. TP's original
job was a **daily** cron; it was deliberately merged into this same weekly job so all 4 platforms
share one cadence, rather than TP staying daily while the other three run weekly. Net effect:
TrustPilot review status/text now refreshes weekly, not daily — a real, intentional cadence change.

**Crontab entry (replaces the old daily TP job and the short-lived AG/CG/WO-only weekly job):**
```
0 1 * * 1 /home/ec2-user/run_weekly_all_platforms.sh >> /home/ec2-user/weekly_all_platforms.log 2>&1
```
Mondays at 01:00 UTC (09:00 Asia/Manila — same convention as the Schedule Planner's weekly
generation cron). Weekly rather than daily by design: AG/CG involve per-country residential proxies
and Cloudflare-clearing waits, so running all 4 platforms daily at full scale would mean
significantly more Selenium load and more bot-detection exposure than this team's existing ops
cadence (Review Success Rate, Brand Forum Weekly Monitoring — both Monday) needs.

**Script (`~/run_weekly_all_platforms.sh`):** runs TP → AG → CG → WO sequentially across all tabs
(no `--tab` filter) — sequential, not concurrent, since concurrent Chrome instances have crashed
this box before (Task 128). TP uses `--headless` (matches production); AG/CG use `--no-headless`
(matches production's Cloudflare-clearing Xvfb setup — their CLI default is headless, which would
silently produce blocked/garbage results); WO's CLI default already matches production
(non-headless) with no flag needed. Before starting, it waits for any other `check_*.py` process to
finish first (in case a manual Check Status click is still running). Logs: `~/scraper_tp_weekly.log`,
`~/scraper_ag_weekly.log`, `~/scraper_cg_weekly.log`, `~/scraper_wo_weekly.log`.

**Note:** "across all tabs" above is not the same as "across all brands" — since 2026-08-11 each
run only checks whichever brand group is active that week, per-brand, not per-tab. See
[Brand Schedule Groups](#brand-schedule-groups) below.

**Check last week's run:**
```bash
tail -40 ~/weekly_all_platforms.log
tail -40 ~/scraper_tp_weekly.log ~/scraper_ag_weekly.log ~/scraper_cg_weekly.log ~/scraper_wo_weekly.log
```

---

## Daily TrustPilot Brand-Page-Removal Check

`check_brand_page_removed.py` (added 2026-08-13) is a different kind of check
than everything above. The `check_*_status.py` scripts (including TP's own
weekly run in the job above) track the status of *individual reviews*
(published/pending/refused/removed) on a brand's TrustPilot page that is
still live. `check_brand_page_removed.py` instead detects the *whole page*
being delisted -- TrustPilot's real "This profile has been removed" state.
When it finds one, it does exactly what a human checking the Edit Entry
modal's "Removed" checkbox would: flags `removed_platform_brands` for
`platform='tp'` and fires the same brand-removed-notification email the
dashboard's manual checkbox triggers. It only ever *adds* `removed_platform_brands`
rows -- it never clears one, even if a later run finds the page live again --
and it skips (never re-checks, never re-notifies) any `(tab, brand)` already
flagged removed for `platform='tp'`.

**Crontab entry (add by hand -- not folded into `run_weekly_all_platforms.sh`,
since this check is daily while that job is weekly):**
```
0 1 * * * cd /path/to/scripts && python3 check_brand_page_removed.py >> brand_removal_check.log 2>&1
```
01:00 UTC daily (09:00 Asia/Manila) -- same time-of-day convention as the
Monday weekly job above, just every day instead of once a week, since a
fully-delisted brand page is worth catching same-day rather than waiting up
to a week. `/path/to/scripts` is wherever `check_brand_page_removed.py`
lives on the box, alongside its `.env` and `brand_urls.generated.json`
(`load_brand_urls()`'s default path resolves relative to the script's own
directory) -- normally `/home/ec2-user`, same as every other script in this
runbook.

**Env vars:** everything `check_review_status.py` already needs
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) plus one more, added to
`~/.env`:
```
NOTIFY_BRAND_REMOVED_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/notify-brand-removed
```
Same value as the frontend's `VITE_NOTIFY_BRAND_REMOVED_URL`, minus the
`VITE_` prefix -- this script isn't Vite-bundled, so it never sees a
`VITE_`-prefixed var and needs its own plain copy.

**Flags:**
```bash
python3 check_brand_page_removed.py --dry-run                              # print detections, write/notify nothing
python3 check_brand_page_removed.py --dry-run --tab "TP Brand Injection"   # restrict to one tab
python3 check_brand_page_removed.py                                        # real run: flags rows AND emails the team
```

**⚠️ Always `--dry-run` first, every time you touch this script or its
inputs.** Unlike `check_review_status.py`'s dry-run (which only guards
Supabase writes), this script's notification path is already live in
production -- a real (non-dry-run) invocation that misfires sends the
`notify-brand-removed` email to the whole team immediately, once per brand
it flags. There's no separate "notify-only" dry-run; `--dry-run` is the one
thing standing between a bug here and a mass false-positive email.

**Deploy note -- `brand_urls.generated.json` needs regenerating by hand:**
this script resolves each brand's TrustPilot URL from
`scripts/brand_urls.generated.json`, a static JSON export of the frontend's
`tab-configs.ts` URL maps (`npm run export:brand-urls`, i.e.
`node scripts/export-brand-urls.mjs`). The EC2 box has no Node toolchain, so
it cannot regenerate this file in place. Whenever `tab-configs.ts`'s URL
maps change, regenerate it locally -- from a machine with the repo checked
out and Node installed, not on the EC2 box -- and re-upload it the same way
other script files are re-uploaded (see
[Updating the Script](#updating-the-script)):
```bash
npm run export:brand-urls
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\brand_urls.generated.json" ec2-user@54.179.186.205:~/brand_urls.generated.json
```
Forgetting this doesn't throw an error -- brands with a stale or missing URL
just land silently in the `no_url` summary bucket, not `errors`, so nothing
in the log looks wrong.

**Before enabling the cron job -- smoke-check the notify function once:**
same spirit as the [Chrome version check](#chrome-version-mismatch) below --
a one-time manual verification before trusting the automated path. `--dry-run`
never calls the notify function (that path structurally can't execute during
a dry run), so the only way to confirm `NOTIFY_BRAND_REMOVED_URL` is reachable
and the key is valid is a direct request. Use a deliberately-invalid payload
so it fails validation instead of emailing the whole team:
```bash
curl -X POST "$NOTIFY_BRAND_REMOVED_URL" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Expect back `{"error":"Missing required field"}` (or similar) -- that
confirms the endpoint is reachable and auth succeeds. **Do not** post a real
`{"brand": ..., "tabLabel": ..., "platformShortLabel": ..., "removedAtLabel": ...}`
payload here -- that sends a real notification email to the whole team.

---

## Brand Schedule Groups

Added 2026-08-11 to spread the weekly all-platform run's load: every brand is deterministically
split into 3 groups (`scripts/schedule_groups.py`, `brand_group_index(tab, brand)` — a stable
hash of the tab + brand name, no database table involved), and each Monday's run only checks
whichever group is "active" that week (`active_group_index()`, computed purely from the
calendar date — no stored cursor). A brand not in this week's active group is skipped
entirely by all four platform checkers, and also by the manual dashboard "Check Status"
button — there is no override. Full rotation (every brand checked at least once) takes
3 weeks.

`filter_by_active_group()` in `check_review_status.py` is the one place this is enforced;
`check_ag_status.py`/`check_cg_status.py`/`check_wo_status.py`'s `check_*_for_tab()` functions
and `status_server.py`'s TP branch all call it right after loading entries, so both the cron
path and the manual-button path are covered by the same code.

**To check which group is active this week without SSH-ing in and reading logs**, run this
on the EC2 box (or anywhere with the repo checked out and no dependencies beyond the
standard library):

```bash
cd ~
python3 -c "import schedule_groups as sg; from datetime import date; print(sg.active_group_index(date.today()))"
```

**Known trade-off:** stacked on top of this same runbook's earlier TP daily->weekly cadence
change, a brand can now go up to 3 weeks between checks on any given platform. Accepted
deliberately when this was designed — revisit only if real-world staleness turns out to be a
problem in practice.

**Also note:** groups balance by brand *count* (roughly 1/3 of brands per group), not by
row/entry count — some brands have many more tracked review accounts than others, so actual
per-week scrape volume can still vary noticeably between groups even though the brand split
itself is roughly even.

**Deploy note:** this feature requires a new file, `schedule_groups.py`, that
`check_review_status.py` imports unconditionally (`from schedule_groups import
in_active_group`) — `check_ag_status.py`/`check_cg_status.py`/`check_wo_status.py`/
`status_server.py` all import from `check_review_status`, so they transitively need it too. A
deploy of this feature is **not** just re-uploading `check_review_status.py` per the
["Updating the Script"](#updating-the-script) section below — it must include all of the
following, uploaded together, or the server ends up with a `check_review_status.py` that
imports a module that was never uploaded (`ModuleNotFoundError`, breaking every platform's
weekly cron AND the manual "Check Status" button for all 4 platforms):

```bash
# New file — must land in the SAME directory as check_review_status.py (~/, not a subdirectory)
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\schedule_groups.py" ec2-user@54.179.186.205:~/schedule_groups.py

# Modified in this branch — re-upload all of these
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\check_review_status.py" ec2-user@54.179.186.205:~/check_review_status.py
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\check_ag_status.py" ec2-user@54.179.186.205:~/check_ag_status.py
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\check_cg_status.py" ec2-user@54.179.186.205:~/check_cg_status.py
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\check_wo_status.py" ec2-user@54.179.186.205:~/check_wo_status.py
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\status_server.py" ec2-user@54.179.186.205:~/status_server.py

# Then restart the status server so it picks up the new code — status_server.py
# runs under systemd (Restart=always) as of 2026-07-10; a manual pkill/nohup
# fights the unit's own auto-restart and races it for port 5001, leaving an
# orphan process that "works" while systemd crash-loops trying to rebind the
# same port forever in the background (confirmed live 2026-08-26 — a prior
# deploy's manual pkill/nohup left systemd restart-looping ~9,400 times over
# 24h while an unmanaged orphan silently served all real traffic). Always use
# systemctl, never pkill/nohup:
sudo systemctl restart status-server.service
sudo systemctl is-active status-server.service   # should print "active"
curl -s http://127.0.0.1:5001/health              # should print {"ok":true}
```

---

## One-Time Full Backfill (bypass the group rotation)

For a one-off job that needs every brand checked in one pass regardless of this week's active
group — e.g. backfilling `TP Review Text` for every brand's Live *and* Removed entries in one
sitting, rather than waiting up to 3 weeks for the rotation to cycle through everyone —
`schedule_groups.py`'s `in_active_group()` honors a `SCHEDULE_GROUP_BYPASS` env var: when set
(`1`/`true`/`yes`, case-insensitive), every brand is treated as in-scope, on every platform,
for both the cron path and the manual dashboard "Check Status" button. There is no auto-expiry —
it must be explicitly unset afterward or every future run (including the regular weekly cron)
keeps checking everyone every time, defeating the whole point of the rotation.

**1. Deploy the updated `schedule_groups.py`** (only this file changed — `check_review_status.py`/
`check_ag_status.py`/`check_cg_status.py`/`check_wo_status.py`/`status_server.py` did not, so they
don't need re-uploading):
```bash
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\schedule_groups.py" ec2-user@54.179.186.205:~/schedule_groups.py
```

**2. Turn the bypass on** (SSH in first):
```bash
echo "SCHEDULE_GROUP_BYPASS=1" >> ~/.env
sudo systemctl restart status-server.service
sudo systemctl is-active status-server.service   # should print "active"
```
The restart is required even though `status_server.py`'s own source didn't change — it's a
long-running process that already has the old `schedule_groups.py` imported in memory, and
Python won't pick up the new file (or the new env var) without a restart. A fresh
`python3 check_review_status.py` cron invocation would pick up both automatically since it
starts a new process, but the dashboard's "Check Status" button always goes through this
already-running server. Use `systemctl`, never `pkill`/`nohup` — the service runs under
systemd (`Restart=always`) as of 2026-07-10, and a manual pkill/nohup races it for port 5001
instead of replacing it cleanly (see the warning in the "Updating the Script" section above).

**3. Run the actual checks from the dashboard** — for each brand tab, filter Status to **Live**
and click **Check Status** (TP), then switch the filter to **Removed** and click **Check Status**
(TP) again. Repeat for all 11 tabs. Expect the Removed pass to leave many entries unchanged —
if a review's page no longer shows any text on TrustPilot's live site, there is nothing left to
fetch and `TP Review Text` simply stays whatever was last captured (or unset).

**4. Turn the bypass back off** as soon as the backfill is done — do not leave it set:
```bash
sed -i '/^SCHEDULE_GROUP_BYPASS=/d' ~/.env
sudo systemctl restart status-server.service
sudo systemctl is-active status-server.service   # should print "active"
```
Verify it's gone: `grep SCHEDULE_GROUP_BYPASS ~/.env` should print nothing.

---

## Updating the Script

Whenever `scripts/check_review_status.py` is changed locally, re-upload it:

```bash
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\check_review_status.py" ec2-user@54.179.186.205:~/check_review_status.py
```

---

## Updating the .env (Supabase credentials)

If credentials rotate, SSH in and overwrite the file:

```bash
cat > ~/.env << 'EOF'
SUPABASE_URL=https://krxnupmhfiduduvvlumc.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_new_key_here
EOF
```

Verify it saved:
```bash
cat ~/.env
```

---

## Geo Proxies (enigmaproxy) for AG/CG

AG/CG checks must exit from each brand's country (the `Country` column). They use
enigmaproxy residential proxies over HTTP. Add these to `~/.env`:

    ENIGMA_HOST=resi.enigmaproxy.net
    ENIGMA_PORT=12321
    ENIGMA_LOGIN=0048277fc210
    ENIGMA_PW_DE=<germany password>
    ENIGMA_PW_GB=<uk password>
    # ...one ENIGMA_PW_<CC> per country in use

**Where the passwords come from:** GoLogin app -> open the country's "TP Test"
profile -> Proxy tab -> reveal the Password. Login is shared (`0048277fc210`);
each country has its own password.

**Add a new country:** add its full name -> ISO-2 to `COUNTRY_CODE` in
`scripts/geo_proxy.py`, then add an `ENIGMA_PW_<CC>` line here.

**Verify a country works** (HTTP, from the EC2 box):

    curl -x "http://0048277fc210:<pw>@resi.enigmaproxy.net:12321" https://ipinfo.io/json

**How Chrome uses the proxy (local bridges):** Chrome 149 removed Manifest-V2
extension support, so the old in-browser proxy-auth extension no longer works —
Chrome would ignore an authenticated proxy and exit from the EC2 IP. Instead, the
scrapers run a local `pproxy` bridge per country (`geo_bridge.ensure_bridges()`,
called automatically at the start of each AG/CG run): each bridge listens on
`127.0.0.1:<port>` and forwards to the authenticated enigma proxy, and Chrome
connects to the local bridge with `--proxy-server` (no auth, no extension).

One-time dependency install on EC2:

    python3 -m pip install pproxy

Bridges auto-start on demand and persist; logs are at `~/pproxy_<cc>.log`. The
`[geo] exit country 'de' (target 'de')` line in a run confirms a country is
exiting correctly.

### Cloudflare — AG/CG run NON-headless under Xvfb

AskGamblers and CasinoGuru sit behind Cloudflare's "Just a moment…" challenge,
which **blocks headless Chrome** (you get a ~27K challenge page, no reviews) but
auto-clears for a real headful browser. So the AG/CG scrapers run Chrome
non-headless inside a virtual display (Xvfb). `ensure_display()` starts the
display automatically at the start of each run; if no display is available it
falls back to headless.

One-time install on EC2:

    sudo dnf install -y xorg-x11-server-Xvfb
    python3 -m pip install pyvirtualdisplay

Signs it's working: a run prints `[display] started virtual display :N`, the AG
page is ~700K (not 27K), and the page title is the casino name (not "Just a
moment…"). Heavy AG pages may log a harmless `get` timeout — the content still
loads and the scraper reads it.

---

## Updating Python Dependencies

### If a new package is added to `requirements.txt`:
```bash
pip3 install undetected-chromedriver python-dotenv requests
```

### Upgrade all packages:
```bash
pip3 install --upgrade undetected-chromedriver python-dotenv requests
```

---

## Chrome Version Mismatch

The script hardcodes `version_main=149` in `build_driver()`. If Chrome auto-updates and the version changes, `undetected-chromedriver` will fail.

**Check installed Chrome version:**
```bash
google-chrome --version
```

**Fix:** Update line 347 of `check_review_status.py` locally to match the new version number, then re-upload the script.

To prevent Chrome from auto-updating on the instance:
```bash
sudo dnf versionlock add google-chrome-stable
```
(Install `dnf-plugins-core` first if versionlock isn't available: `sudo dnf install -y python3-dnf-plugins-core`)

**Note (2026-08-10):** this repo's local `check_review_status.py` currently pins
`version_main=151` (bumped from 149 during the review-text feature's local
development, to match a local Chrome auto-update). This pin is EC2-machine-coupled,
not something that should be assumed in sync with local — before deploying this or
any future version of the script to EC2, explicitly confirm EC2's actual installed
Chrome major version (`google-chrome --version`) and set `version_main` to match.

---

## Troubleshooting

### "No module named X"
```bash
pip3 install undetected-chromedriver python-dotenv requests
```

### "KeyError: SUPABASE_URL" or "KeyError: SUPABASE_SERVICE_ROLE_KEY"
The `.env` file is missing or in the wrong location.
```bash
cat ~/.env   # should show both vars
```
The script loads from `os.path.dirname(__file__)` which for `~/check_review_status.py` resolves to `~/.env`. If you moved the script, move the `.env` too.

### Chrome crashes or hangs
```bash
# Kill any zombie Chrome processes
pkill -f chrome
pkill -f chromedriver
# Then retry
python3 ~/check_review_status.py --dry-run --headless
```

### "redirected off-site" messages
Trustpilot redirected away from the review URL — the script correctly marks those as `Removed`. Not an error.

### Script exits with 0 entries
All entries have statuses outside `CHECKABLE_STATUSES` (`done`, `pending`, `published`). Check the Supabase `entries` table for the current status distribution.

### Connection refused / SSH timeout
The instance may be stopped. Go to AWS Console → EC2 → Instances → select `scraper-leo` → Instance state → Start.

---

## Status Server (Flask API for dashboard "Check Status" button)

The dashboard's Check Status button can call `status_server.py` running on EC2 instead of a local/ngrok instance. Traffic flows: **Dashboard → Supabase Edge Function (`proxy-check-status`) → EC2 `status_server.py`**.

### First-time setup

```bash
# SSH in
ssh -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" ec2-user@54.179.186.205

# Install Flask dependencies (in addition to the scraper ones)
pip3 install flask flask-cors

# Upload status_server.py (from local terminal)
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\status_server.py" ec2-user@54.179.186.205:~/status_server.py

# Add CHECK_STATUS_TOKEN to ~/.env (use the same value set in Vercel VITE_CHECK_STATUS_TOKEN)
echo "CHECK_STATUS_TOKEN=your_token_here" >> ~/.env
```

Open port 5001 in the EC2 security group: **AWS Console → EC2 → Security Groups → scraper-leo-sg → Inbound rules → Add rule: TCP 5001, Source 0.0.0.0/0**.

**As of 2026-07-10 the server runs under a systemd unit (`status-server.service`,
`Restart=always`), not the bare `nohup` process this "First-time setup" describes — the
`nohup`/`pkill` commands below are the original pre-systemd bootstrap and must never be used
once the unit exists (confirmed live 2026-08-26: doing so races systemd for port 5001 and
leaves an unmanaged orphan silently serving traffic while systemd crash-loops trying to rebind
the same port). Use them only if `status-server.service` itself doesn't exist yet on a fresh
box; otherwise use the systemd commands in the sections below.**

### Start the server

```bash
sudo systemctl start status-server.service
sudo systemctl enable status-server.service   # survive reboots
```

### Check if it's running / view logs

```bash
sudo systemctl status status-server.service --no-pager
sudo journalctl -u status-server.service -f   # ~/server.log is stale; systemd's stdout goes to journald
```

### Stop the server

```bash
sudo systemctl stop status-server.service
```

### Update the server script

```bash
# From local terminal:
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\status_server.py" ec2-user@54.179.186.205:~/status_server.py

# Then SSH in and restart:
sudo systemctl restart status-server.service
sudo systemctl is-active status-server.service   # should print "active"
```

### Supabase Edge Function configuration

After deploying `proxy-check-status`, set its secret once:

```bash
supabase secrets set EC2_STATUS_URL=http://54.179.186.205:5001
```

Update this secret whenever the EC2 IP changes (or assign an Elastic IP to avoid this entirely).

Set Vercel env vars (baked at build time — redeploy after changing):
- `VITE_CHECK_STATUS_URL` = `https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/proxy-check-status`
- `VITE_CHECK_STATUS_TOKEN` = same token as `CHECK_STATUS_TOKEN` on EC2

---

## Scheduling (Cron)

To run the script automatically every day at a fixed time on the EC2 instance:

```bash
crontab -e
```

Add a line (example: 6 PM UTC daily):
```
0 18 * * * python3 /home/ec2-user/check_review_status.py --headless >> /home/ec2-user/scraper.log 2>&1
```

View the cron log:
```bash
tail -100 ~/scraper.log
```

Remove the cron job:
```bash
crontab -e  # delete the line and save
```

---

## Maintenance / Cache Cleanup

The 8GB root volume has no headroom to waste, so three automated jobs keep it from creeping up. Set up 2026-07-03.

**Log rotation** — `/etc/logrotate.d/scraper` rotates every `~/*.log` file daily, keeps 7 days compressed, uses `copytruncate` (so `status_server.py`'s long-running process doesn't need a restart to pick up the new file). Runs via the box's existing `logrotate.timer` (daily at midnight UTC) — no separate cron needed.

```bash
sudo logrotate -d /etc/logrotate.d/scraper   # dry run to verify the config
```

**Stale Chrome profile sweep** — `undetected-chromedriver` creates a temp profile dir under `/tmp` per run (`tempfile.mkdtemp()`) and only cleans it up on a graceful exit; crashes, timeouts, or `pkill -f chrome` leave it behind. `~/cleanup_tmp.sh` deletes `/tmp/tmp*` dirs and Chrome unpacker artifacts older than 24h. Cron: daily at 15:30 UTC (after the 14:00 scraper run).

**dnf cache** — `/var/cache/dnf` is almost entirely repo metadata (solv indexes), not cached packages, so `dnf clean packages` is a no-op here — use `dnf clean all`. Cron: weekly, Sunday 03:00 UTC.

**Swap** — added 2026-08-17 (`/swapfile`, 1GB, persistent via `/etc/fstab`) after this box's chronic
Chrome OOM-kills (`journalctl -k`, recurring Aug 14-17) culminated in a full box hang requiring a
hard reboot. This box previously ran with **zero swap**, so the kernel's only relief valve under
memory pressure was hard-killing a process outright (usually Chrome, sometimes the LinkOps worker)
— swap lets it page out and degrade instead. Costs ~1GB of the already-tight 8GB root volume
(57% -> 70% used at the time); keep an eye on `df -h /` if that climbs further.
```bash
swapon --show   # confirm it's active
free -h         # Swap: line should show 1.0Gi total
```

Current crontab:
```
0 14 * * * python3 /home/ec2-user/check_review_status.py --headless >> /home/ec2-user/scraper.log 2>&1
30 15 * * * /home/ec2-user/cleanup_tmp.sh
0 3 * * 0 sudo dnf clean all > /home/ec2-user/dnf_clean.log 2>&1
```

Check current disk usage:
```bash
df -h /
du -sh ~/* /tmp/* /var/cache/dnf 2>/dev/null | sort -rh | head -20
```

---

## Cost Management

- The instance runs ~**$0.023/hour** (t2.small, ap-southeast-1).
- **Stop it when not in use** to avoid charges: AWS Console → EC2 → Instance state → Stop.
- Storage is charged even when stopped (~$0.10/GB/month for the root volume).
- To stop from SSH: `sudo shutdown -h now`

---

## Elastic IP

The public IP (`54.179.186.205`) changes every time the instance stops and starts. To fix it permanently:

1. AWS Console → EC2 → Elastic IPs → Allocate Elastic IP
2. Associate it with `scraper-leo`
3. Cost: free while the instance is running; ~$0.005/hour if the IP is allocated but the instance is stopped.

---

## Full Fresh Setup (if the instance is ever replaced)

```bash
# 1. SSH in
ssh -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" ec2-user@<new-ip>

# 2. Install everything
sudo dnf update -y && sudo dnf install -y python3 python3-pip
sudo tee /etc/yum.repos.d/google-chrome.repo << 'EOF'
[google-chrome]
name=google-chrome
baseurl=http://dl.google.com/linux/chrome/rpm/stable/x86_64
enabled=1
gpgcheck=1
gpgkey=https://dl-ssl.google.com/linux/linux_signing_key.pub
EOF
sudo dnf install -y google-chrome-stable
pip3 install undetected-chromedriver python-dotenv requests

# 3. Upload script (from local terminal)
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\check_review_status.py" ec2-user@<new-ip>:~/check_review_status.py

# 4. Create .env
cat > ~/.env << 'EOF'
SUPABASE_URL=https://krxnupmhfiduduvvlumc.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<key>
EOF

# 5. Verify
python3 ~/check_review_status.py --dry-run --headless
```
