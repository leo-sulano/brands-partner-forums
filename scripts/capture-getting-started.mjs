// scripts/capture-getting-started.mjs
//
// One-time, human-supervised capture of the Getting Started GIF shown on the
// How It Works page. Drives the real app with Playwright against a local dev
// server, screenshots each step, and encodes the frames into a looping GIF.
//
// Usage:
//   npm run dev                                            # in one terminal
//   CAPTURE_EMAIL=you@x.com CAPTURE_PASSWORD=... npm run capture:demo   # in another
//
// Re-run whenever the UI changes enough to make the GIF stale.

import { chromium } from 'playwright';
import { PNG } from 'pngjs';
// gifenc's published CJS bundle (dist/gifenc.js) assigns its named exports via
// an esbuild __export() helper loop rather than static `exports.foo = ...`
// statements, which Node's cjs-module-lexer can't detect — so named imports
// (`import { GIFEncoder } from 'gifenc'`) fail with "Named export not found"
// under Node's ESM loader. Import the default (the whole CJS exports object)
// and destructure instead, per Node's own suggested fix for this case.
import gifenc from 'gifenc';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_GIF = path.join(ROOT, 'public', 'getting-started.gif');

const BASE_URL = 'http://localhost:5173';
const DEMO_TAB = 'GRG - Gulf Recovery Group';
const DEMO_TAB_SLUG = 'gulf-recovery-group';
const DEMO_ACCOUNT = 'demo.getting-started@example.com';
const DEMO_ACCOUNT_NAME = 'Demo Entry — safe to delete';
const DEMO_ACCOUNT_NAME_EDITED = 'Demo Entry — safe to delete (edited)';

const EMAIL = process.env.CAPTURE_EMAIL;
const PASSWORD = process.env.CAPTURE_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Set CAPTURE_EMAIL and CAPTURE_PASSWORD env vars before running.');
  process.exit(1);
}

/** @type {{ buffer: Buffer, delay: number }[]} */
const frames = [];

async function shoot(page, delay = 1200) {
  const buffer = await page.screenshot();
  frames.push({ buffer, delay });
}

// The Add Review Account modal and the Edit Entry modal both render each
// field as a <label> immediately followed by its <input> inside a shared
// wrapper div, with no htmlFor/id link between them — so getByLabel() can't
// find these fields. Walk the DOM relationship directly instead.
function fieldInput(page, label) {
  return page.locator(`xpath=//label[normalize-space(text())="${label}"]/following-sibling::input`);
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Stub the Check Status backend so the loading/result states are captured
  // deterministically whether or not status_server.py happens to be running —
  // this walkthrough only needs to illustrate the flow, not run a real scrape.
  await page.route('**/check-status', async (route) => {
    await new Promise((r) => setTimeout(r, 1800));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ checked: 1, updated: 1, errors: 0 }),
    });
  });

  let demoEntryCreated = false;

  try {
    // 1. Login
    await page.goto(`${BASE_URL}/login`);
    await page.locator('input[type=email]').fill(EMAIL);
    await page.locator('input[type=password]').fill(PASSWORD);
    await shoot(page, 1500);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL(`${BASE_URL}/`);
    await page.locator('h1', { hasText: 'Overview' }).waitFor();
    await shoot(page, 1200);

    // 2. Navigate to the demo brand tab
    await page.goto(`${BASE_URL}/brands/${DEMO_TAB_SLUG}`);
    await page.locator('h1', { hasText: DEMO_TAB }).waitFor();
    await shoot(page, 1200);

    // 3. Add an entry
    await page.getByRole('button', { name: 'Add Review Account' }).click();
    await page.locator('h2', { hasText: 'Add Review Account' }).waitFor();
    await fieldInput(page, 'Account').fill(DEMO_ACCOUNT);
    await fieldInput(page, 'Account Name').fill(DEMO_ACCOUNT_NAME); // Add modal's own field labels, not COLUMN_LABELS
    await shoot(page, 1800);
    await page.getByRole('button', { name: 'Add Account' }).click();
    // Set immediately after the click — this is the point the DB insert
    // actually happens. If either of the following waits times out for an
    // unrelated reason (render delay, transient flake), cleanup must still
    // run so a real row is never silently orphaned in production.
    demoEntryCreated = true;
    await page.locator('h2', { hasText: 'Add Review Account' }).waitFor({ state: 'hidden' });
    await page.getByText(DEMO_ACCOUNT_NAME, { exact: true }).waitFor();
    await shoot(page, 1500);

    // 4. Edit the entry — Edit Entry modal labels route through
    // getColLabel()/COLUMN_LABELS, which renders "Account Name" as "Acc. Name".
    await page.getByText(DEMO_ACCOUNT_NAME, { exact: true }).click();
    await page.locator('h2', { hasText: DEMO_ACCOUNT_NAME }).waitFor();
    await fieldInput(page, 'Acc. Name').fill(DEMO_ACCOUNT_NAME_EDITED);
    await shoot(page, 1800);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.getByText(DEMO_ACCOUNT_NAME_EDITED, { exact: true }).waitFor();
    await shoot(page, 1500);

    // 5. Trigger Check Status — capture the loading state, then the result
    await page.getByRole('button', { name: 'Check Status', exact: true }).click();
    await page.getByText('Checking…').waitFor();
    await shoot(page, 1500);
    await page.getByText('review updated').waitFor({ timeout: 5000 });
    await shoot(page, 2200);
  } finally {
    if (demoEntryCreated) {
      try {
        const row = page.locator('tr').filter({ has: page.getByText(DEMO_ACCOUNT_NAME_EDITED, { exact: true }) });
        await row.getByRole('checkbox', { name: 'Select row' }).check();
        // Only one "Delete" button exists at this point (the row-selection
        // toolbar's) — the confirm modal's own "Delete" button doesn't exist
        // yet, so this click is unambiguous.
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.getByPlaceholder('delete').fill('delete');
        // Press Enter instead of clicking the modal's "Delete" button, which
        // would now be ambiguous alongside the toolbar's "Delete" button.
        await page.getByPlaceholder('delete').press('Enter');
        await page.getByText(DEMO_ACCOUNT_NAME_EDITED, { exact: true }).waitFor({ state: 'hidden', timeout: 5000 });
      } catch (cleanupErr) {
        console.error('Cleanup failed — delete the demo entry manually:', cleanupErr);
      }
    }
    await browser.close();
  }

  buildGif();
}

function buildGif() {
  const gif = GIFEncoder();
  for (const { buffer, delay } of frames) {
    const png = PNG.sync.read(buffer);
    const palette = quantize(png.data, 256);
    const index = applyPalette(png.data, palette);
    gif.writeFrame(index, png.width, png.height, { palette, delay });
  }
  gif.finish();
  mkdirSync(path.dirname(OUTPUT_GIF), { recursive: true });
  writeFileSync(OUTPUT_GIF, gif.bytes());
  console.log(`Wrote ${frames.length} frames to ${OUTPUT_GIF}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
