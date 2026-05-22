#!/usr/bin/env node
/**
 * setup-outlook-forwarding.js
 *
 * One-time script: logs into each Outlook account from the Google Sheet and
 * enables email forwarding (Settings → Forwarding) to the central Gmail inbox.
 * After running once, EmailParser.gs handles everything automatically.
 *
 * ── Setup ─────────────────────────────────────────────────────────────────────
 * 1. Copy scripts/.env.example to scripts/.env and fill in your values
 * 2. cd scripts && npm install
 * 3. npx playwright install chromium
 * 4. node setup-outlook-forwarding.js
 *
 * ── Notes ────────────────────────────────────────────────────────────────────
 * - Set HEADLESS=false in .env to watch the browser while it runs (recommended first run)
 * - Accounts with 2FA will pause and show the browser for manual completion
 * - Safe to re-run: forwarding already set up is detected and skipped
 * - Non-Outlook accounts are automatically skipped
 * - Results saved to scripts/forwarding-results.json
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL    = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;
const FORWARD_TO         = process.env.FORWARD_TO || 'leo@optinetsolutions.com';
const HEADLESS           = process.env.HEADLESS !== 'false';
const TARGET_TABS        = ['Rooster Partners', 'Hanan', 'Revolution Casino', 'SilverPlay'];
const OUTLOOK_DOMAINS    = new Set(['outlook.com', 'hotmail.com', 'live.com', 'msn.com']);
const DELAY_MS           = 2000;

// ── Fetch accounts from Apps Script dump ─────────────────────────────────────
async function fetchAccounts() {
  const url = `${APPS_SCRIPT_URL}?op=dump&secret=${encodeURIComponent(APPS_SCRIPT_SECRET)}`;
  const res = await fetch(url, { redirect: 'follow' });
  const payload = await res.json();
  if (!payload.ok) throw new Error('Apps Script dump failed: ' + JSON.stringify(payload));

  const accounts = [];
  for (const tab of payload.tabs) {
    if (!TARGET_TABS.includes(tab.name)) continue;
    const lh       = tab.headers.map(h => h.toLowerCase().trim());
    const emailIdx = lh.indexOf('email');
    const passIdx  = lh.indexOf('password');
    const nameIdx  = lh.indexOf('account name');
    if (emailIdx === -1 || passIdx === -1) {
      console.warn(`  [warn] Tab "${tab.name}" — missing Email or Password column, skipped`);
      continue;
    }
    for (const row of tab.rows) {
      const email    = (row[emailIdx] || '').trim();
      const password = (row[passIdx]  || '').trim();
      if (!email || !password || email === '—' || password === '—') continue;
      const domain = email.split('@')[1]?.toLowerCase() ?? '';
      if (!OUTLOOK_DOMAINS.has(domain)) continue;
      accounts.push({
        tab:  tab.name,
        name: nameIdx !== -1 ? (row[nameIdx] || email) : email,
        email,
        password,
      });
    }
  }
  return accounts;
}

// ── Log into Outlook and enable forwarding ────────────────────────────────────
async function setupForwarding(browser, email, password) {
  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    // ── Sign in ───────────────────────────────────────────────────────────────
    await page.goto('https://login.live.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Email step
    await page.fill('input[type="email"]', email);
    await page.click('input[type="submit"]');
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });

    // Password step
    await page.fill('input[type="password"]', password);
    await page.click('input[type="submit"]');

    // "Stay signed in?" — click No
    try {
      await page.waitForSelector('#idBtn_Back', { timeout: 6000 });
      await page.click('#idBtn_Back');
    } catch (_) { /* no stay-signed-in prompt */ }

    // Wait for redirect to outlook or account page
    await page.waitForURL(/outlook\.live\.com|account\.microsoft\.com|outlook\.com/, { timeout: 20000 });

    // Navigate to the forwarding settings page
    await page.goto(
      'https://outlook.live.com/mail/options/mail/forwarding',
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    // Wait for the settings page to load
    await page.waitForSelector('input[type="checkbox"], input[type="email"][placeholder]', {
      timeout: 15000,
    });

    // ── Check if forwarding is already enabled ────────────────────────────────
    const forwardInput = page.locator('input[type="email"][placeholder], input[type="text"][id*="forward" i]').first();
    const currentValue = await forwardInput.inputValue().catch(() => '');
    if (currentValue.toLowerCase() === FORWARD_TO.toLowerCase()) {
      await context.close();
      return 'already_exists';
    }

    // ── Enable forwarding ─────────────────────────────────────────────────────
    // Check the "Forward my email to" checkbox if present
    const checkbox = page.locator('input[type="checkbox"]').first();
    const isChecked = await checkbox.isChecked().catch(() => true);
    if (!isChecked) await checkbox.check();

    // Fill in the forwarding address
    await forwardInput.fill(FORWARD_TO);

    // Save
    const saveBtn = page.locator('button:has-text("Save"), input[type="submit"]').first();
    await saveBtn.click();
    await page.waitForTimeout(2000);

    await context.close();
    return 'created';
  } catch (err) {
    // If 2FA or unexpected page — take a screenshot for review
    const screenshotPath = `scripts/screenshots/${email.replace(/[@.]/g, '_')}.png`;
    fs.mkdirSync('scripts/screenshots', { recursive: true });
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    await context.close();
    throw new Error(err.message + ` (screenshot: ${screenshotPath})`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_SECRET) {
    console.error('ERROR: Missing required env vars. Copy scripts/.env.example to scripts/.env and fill it in.');
    process.exit(1);
  }

  console.log('Fetching accounts from Google Sheet...');
  const accounts = await fetchAccounts();
  console.log(`Found ${accounts.length} Outlook accounts across: ${TARGET_TABS.join(', ')}\n`);

  const browser = await chromium.launch({ headless: HEADLESS });
  const results = { created: [], already_exists: [], failed: [] };

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    process.stdout.write(`[${i + 1}/${accounts.length}] ${acc.email} (${acc.tab}) ... `);
    try {
      const outcome = await setupForwarding(browser, acc.email, acc.password);
      results[outcome].push(acc.email);
      console.log(outcome === 'created' ? '✓ forwarding enabled' : '→ already set up, skipped');
    } catch (err) {
      const reason = err.message.slice(0, 200);
      results.failed.push({ email: acc.email, tab: acc.tab, reason });
      console.log(`✗ FAILED — ${reason}`);
    }
    if (i < accounts.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  await browser.close();

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n─── Summary ─────────────────────────────────────────');
  console.log(`✓ Forwarding enabled:  ${results.created.length}`);
  console.log(`→ Already set up:      ${results.already_exists.length}`);
  console.log(`✗ Failed:              ${results.failed.length}`);
  if (results.failed.length > 0) {
    console.log('\nFailed accounts (need manual setup or have 2FA):');
    results.failed.forEach(f => console.log(`  ${f.email} [${f.tab}]`));
  }

  const outPath = 'scripts/forwarding-results.json';
  fs.writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    forwardTo: FORWARD_TO,
    ...results,
  }, null, 2));
  console.log(`\nFull results saved to ${outPath}`);
}

main().catch(err => { console.error('\nFatal error:', err.message); process.exit(1); });
