// scripts/clear-invalid-dates.mjs
//
// One-time cleanup: clears the "not date-like" values audit-invalid-dates.mjs
// found in the Removed/Not Published date column — placeholder dashes
// ("--"/"-"/"---") and a stray "Done" status word. Excludes the one row whose
// bad value ("29//04/2025", a double-slash typo) is still clearly an attempt
// at a real date rather than free text — left alone for a manual fix instead
// of being blanked out.
//
// Signs in as CAPTURE_EMAIL/CAPTURE_PASSWORD (the same approved demo account
// scripts/capture-getting-started.mjs already uses) since RLS requires an
// approved authenticated user to write `entries` — the anon key used for the
// read-only audit can't update. Goes through the same path the dashboard's
// own Edit Entry save does (queries.ts's updateEntryData): snapshots the row
// into edit_log first, so every clear is visible and restorable from the Log
// page, then updates just the one field via a read-merge-write cycle.
//
// Usage: CAPTURE_EMAIL=... CAPTURE_PASSWORD=... node scripts/clear-invalid-dates.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');

function loadEnv() {
  const out = {};
  for (const file of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', file);
    let text;
    try {
      text = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m || m[1] in out) continue;
      // Some lines in this repo's .env files have a stray space and/or literal
      // wrapping quotes after '=' (e.g. `CAPTURE_EMAIL= "x@y.com"`) — strip
      // both, or the quote characters end up part of the credential value.
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  }
  return out;
}

const REMOVED_HEADER = 'Removed / Not Published / stil published date';

// The exact 22 rows confirmed by audit-invalid-dates.mjs (2026-08-14, run
// with stable `.order('id')` pagination) — hardcoded rather than
// re-detected here so this script clears precisely what was reviewed, not
// whatever isValidDateText happens to flag on a future, possibly-different
// run.
const TARGETS = [
  { id: '9a3e81ae-5505-4db6-9e09-d1a512518eea', tab: 'TP Affiliate', header: REMOVED_HEADER, expect: '--' },
  { id: 'aef9a5ec-6738-4e08-94c7-791a736a132c', tab: 'TP Affiliate', header: REMOVED_HEADER, expect: '--' },
  { id: 'c83efde0-9255-4c0f-87a8-21771ac992a4', tab: 'TP Affiliate', header: REMOVED_HEADER, expect: '--' },
  { id: '0ad0eeb2-e04f-4e6e-9124-535f648909f7', tab: 'Rooster Partners', header: REMOVED_HEADER, expect: '---' },
  { id: 'ad027d6b-3d67-4ee4-9b63-dad437a1e66e', tab: 'Rooster Partners', header: REMOVED_HEADER, expect: '---' },
  { id: '28a4ce0e-7ae9-470f-9ef4-10cfaab193ee', tab: 'Trybet', header: REMOVED_HEADER, expect: '--' },
  { id: '9d1923f1-c0ba-4b87-afec-b5258ef9b311', tab: 'Trybet', header: REMOVED_HEADER, expect: '--' },
  { id: '1788d4c2-be7f-4314-8bb3-5bf1a15eb60b', tab: 'SilverPlay', header: REMOVED_HEADER, expect: '--' },
  { id: '31bd7a22-0c0f-4e14-b12c-1a88ad1ab68a', tab: 'SilverPlay', header: REMOVED_HEADER, expect: '--' },
  { id: '3a68269a-1209-4337-a7aa-8d9819c6aae7', tab: 'SilverPlay', header: REMOVED_HEADER, expect: '--' },
  { id: '660dd17a-b38c-4371-b2c9-697b3f1c6ae5', tab: 'SilverPlay', header: REMOVED_HEADER, expect: '--' },
  { id: '7209615e-79d9-48b6-9b49-17c559482f39', tab: 'SilverPlay', header: REMOVED_HEADER, expect: '--' },
  { id: 'a8b22e67-b746-40f9-a4ed-2b5858c2ce21', tab: 'SilverPlay', header: REMOVED_HEADER, expect: '--' },
  { id: '1d9b10d6-77ec-4913-ad4f-de016455755d', tab: 'SuprPlay Limited', header: REMOVED_HEADER, expect: '--' },
  { id: '44b36042-8ee9-4ad3-a635-1a9608cc9d54', tab: 'SuprPlay Limited', header: REMOVED_HEADER, expect: '--' },
  { id: '56324335-9475-4a60-b045-f1818799a58a', tab: 'SuprPlay Limited', header: REMOVED_HEADER, expect: '--' },
  { id: '77145efc-6a96-4654-bf61-f3e7a2572ed1', tab: 'SuprPlay Limited', header: REMOVED_HEADER, expect: '--' },
  { id: '83d61dd1-147d-4f3d-90ff-8b8f57190a8c', tab: 'SuprPlay Limited', header: REMOVED_HEADER, expect: '--' },
  { id: '8b4a8089-0e45-4bb3-9358-6dc0657fca7a', tab: 'SuprPlay Limited', header: REMOVED_HEADER, expect: '-' },
  { id: 'd14e668f-40f0-4c3c-9a69-d640b2f1906a', tab: 'SuprPlay Limited', header: REMOVED_HEADER, expect: '--' },
  { id: 'd23f75e6-e7a0-44a4-a022-ba443d8b66ac', tab: 'SuprPlay Limited', header: REMOVED_HEADER, expect: '-' },
  { id: 'c571bcde-02de-472c-b8c3-eec8a7a95a81', tab: 'Wizard of Odds', header: REMOVED_HEADER, expect: 'Done' },
];

async function main() {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  const email = process.env.CAPTURE_EMAIL || env.CAPTURE_EMAIL;
  const password = process.env.CAPTURE_PASSWORD || env.CAPTURE_PASSWORD;
  if (!url || !anonKey) {
    console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local or .env');
    process.exit(1);
  }
  if (!email || !password) {
    console.error('Missing CAPTURE_EMAIL / CAPTURE_PASSWORD (env var or .env.local) — an approved account is required to write entries.');
    process.exit(1);
  }

  const supabase = createClient(url, anonKey);
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) {
    console.error('Sign-in failed:', authErr.message);
    process.exit(1);
  }
  const actor = { id: authData.user.id, email: authData.user.email };
  console.log(`Signed in as ${actor.email}${DRY_RUN ? ' (dry run — no writes)' : ''}\n`);

  let cleared = 0;
  let skipped = 0;
  for (const t of TARGETS) {
    const { data: existing, error: selErr } = await supabase
      .from('entries')
      .select('*')
      .eq('id', t.id)
      .maybeSingle();
    if (selErr) {
      console.error(`  [SKIP] ${t.id} — select failed: ${selErr.message}`);
      skipped++;
      continue;
    }
    if (!existing) {
      console.error(`  [SKIP] ${t.id} — row not found (deleted since audit?)`);
      skipped++;
      continue;
    }
    const currentValue = existing.data?.[t.header];
    if (currentValue !== t.expect) {
      console.error(`  [SKIP] ${t.id} — value changed since audit (expected ${JSON.stringify(t.expect)}, found ${JSON.stringify(currentValue)}); leaving untouched`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY]  [${t.tab}] ${t.header}: ${JSON.stringify(t.expect)} -> null  (id: ${t.id})`);
      cleared++;
      continue;
    }

    const { error: logErr } = await supabase.from('edit_log').insert({
      entity_type: 'entry',
      entity_id: t.id,
      tab: existing.tab,
      before_data: existing,
      actor_id: actor.id,
      actor_email: actor.email ?? '',
    });
    if (logErr) {
      console.error(`  [SKIP] ${t.id} — edit_log insert failed, not touching row: ${logErr.message}`);
      skipped++;
      continue;
    }

    const mergedData = { ...existing.data, [t.header]: null };
    const { error: upErr } = await supabase
      .from('entries')
      .update({
        data: mergedData,
        last_edited_by: 'dashboard',
        last_edited_email: actor.email,
        last_sync_tag: crypto.randomUUID(),
      })
      .eq('id', t.id);
    if (upErr) {
      console.error(`  [FAIL] ${t.id} — update failed: ${upErr.message}`);
      skipped++;
      continue;
    }

    console.log(`  [OK]   [${t.tab}] ${t.header}: ${JSON.stringify(t.expect)} -> null  (id: ${t.id})`);
    cleared++;
  }

  console.log(`\n${DRY_RUN ? 'Would clear' : 'Cleared'} ${cleared} of ${TARGETS.length}; skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
