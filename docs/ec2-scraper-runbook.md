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

## Connecting

```bash
ssh -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" ec2-user@54.179.186.205
```

If the IP has changed, get the new one from the AWS Console → EC2 → Instances → scraper-leo.

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

### Start the server

```bash
nohup python3 ~/status_server.py --port 5001 > ~/server.log 2>&1 &
echo "PID: $!"
```

### Check if it's running / view logs

```bash
ps aux | grep status_server
tail -f ~/server.log
```

### Stop the server

```bash
pkill -f status_server
```

### Update the server script

```bash
# From local terminal:
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" "C:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\scripts\status_server.py" ec2-user@54.179.186.205:~/status_server.py

# Then SSH in and restart:
pkill -f status_server
nohup python3 ~/status_server.py --port 5001 > ~/server.log 2>&1 &
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
