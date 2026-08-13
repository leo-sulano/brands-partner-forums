// scripts/clear-nondates.mjs
//
// Reverses the 2026-08-14 "No Review"/"On Pause" sentinel exception per an
// explicit user decision: TP/AG/CG/WO Added and the Removed/Not-Published
// date column must hold a real date or nothing — no status text, no
// placeholders. Sweeps every entries row across all tabs, and for any row
// with at least one such column holding non-date text, nulls out just those
// columns (everything else on the row is untouched).
//
// Same audit trail as clear-invalid-dates.mjs / the dashboard's own
// updateEntryData: one edit_log row (before_data = full existing row) is
// written before each update, so every clear is attributable and restorable
// from the Log page. Signs in as CAPTURE_EMAIL/CAPTURE_PASSWORD (RLS
// requires an approved authenticated user to write; the anon key this
// script also uses for reads is read-only).
//
// Usage:
//   node scripts/clear-nondates.mjs --dry-run   # report only, no writes
//   node scripts/clear-nondates.mjs             # apply

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
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  }
  return out;
}

// Same rule as src/lib/dateUtils.ts's isValidDateText (post-reversal, dates
// only — no sentinel exception). Duplicated since this runs outside the
// Vite/TS build.
const DATE_ENTRY_HEADERS = [
  'Trust Pilot',
  'Ask Gambler review added',
  'Casino Guru review added',
  'Wizard of Odds',
  'Removed / Not Published / stil published date',
];

function isRealCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function isValidDateText(value) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return true;
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return isRealCalendarDate(+slash[3], +slash[2], +slash[1]);
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isRealCalendarDate(+iso[1], +iso[2], +iso[3]);
  return false;
}

const OPERATIONAL_TABS = [
  'TP Brand Injection', 'TP Affiliate', 'Rooster Partners', 'Revolution Casino',
  'Trybet', 'SilverPlay', 'SuprPlay Limited', 'HazEmirates UAE', 'Hanan',
  'Wizard of Odds', 'GRG - Gulf Recovery Group',
];

async function fetchTabRows(supabase, tab) {
  const PAGE_SIZE = 300;
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .eq('tab', tab)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`[${tab}] ${error.message ?? JSON.stringify(error)}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

// Runs `fn` over `items` with at most `limit` in flight at once.
async function runPool(items, limit, fn) {
  let i = 0;
  let active = 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    function next() {
      if (settled) return;
      if (i >= items.length && active === 0) {
        settled = true;
        resolve();
        return;
      }
      while (active < limit && i < items.length) {
        const item = items[i++];
        active++;
        fn(item)
          .catch((err) => {
            if (!settled) {
              settled = true;
              reject(err);
            }
          })
          .finally(() => {
            active--;
            next();
          });
      }
    }
    next();
  });
}

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

  const supabase = createClient(url, anonKey);
  let actor = { id: null, email: 'dashboard-cleanup-script' };
  if (!DRY_RUN) {
    if (!email || !password) {
      console.error('Missing CAPTURE_EMAIL / CAPTURE_PASSWORD — an approved account is required to write entries.');
      process.exit(1);
    }
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) {
      console.error('Sign-in failed:', authErr.message);
      process.exit(1);
    }
    actor = { id: authData.user.id, email: authData.user.email };
    console.log(`Signed in as ${actor.email}`);
  }
  console.log(DRY_RUN ? 'Dry run — no writes will be made.\n' : 'Live run — will write to entries + edit_log.\n');

  let totalRows = 0;
  let rowsToClear = 0;
  let fieldsToClear = 0;
  let cleared = 0;
  let failed = 0;
  const byValue = new Map();

  for (const tab of OPERATIONAL_TABS) {
    const rows = await fetchTabRows(supabase, tab);
    totalRows += rows.length;

    const targets = [];
    for (const row of rows) {
      const data = row.data ?? {};
      const badHeaders = DATE_ENTRY_HEADERS.filter((h) => data[h] && !isValidDateText(String(data[h])));
      if (badHeaders.length === 0) continue;
      for (const h of badHeaders) {
        const key = String(data[h]).trim();
        byValue.set(key, (byValue.get(key) ?? 0) + 1);
      }
      targets.push({ row, badHeaders });
    }
    rowsToClear += targets.length;
    fieldsToClear += targets.reduce((n, t) => n + t.badHeaders.length, 0);

    if (targets.length === 0) {
      console.log(`${tab}: ${rows.length} rows, nothing to clear`);
      continue;
    }
    console.log(`${tab}: ${rows.length} rows, ${targets.length} row(s) with non-date values in [${[...new Set(targets.flatMap((t) => t.badHeaders))].join(', ')}]`);

    if (DRY_RUN) continue;

    await runPool(targets, 8, async ({ row, badHeaders }) => {
      const { error: logErr } = await supabase.from('edit_log').insert({
        entity_type: 'entry',
        entity_id: row.id,
        tab: row.tab,
        before_data: row,
        actor_id: actor.id,
        actor_email: actor.email ?? '',
      });
      if (logErr) {
        console.error(`  [SKIP] ${row.id} — edit_log insert failed, not touching row: ${logErr.message}`);
        failed++;
        return;
      }

      const mergedData = { ...row.data };
      for (const h of badHeaders) mergedData[h] = null;
      const { error: upErr } = await supabase
        .from('entries')
        .update({
          data: mergedData,
          last_edited_by: 'dashboard',
          last_edited_email: actor.email,
          last_sync_tag: crypto.randomUUID(),
        })
        .eq('id', row.id);
      if (upErr) {
        console.error(`  [FAIL] ${row.id} — update failed: ${upErr.message}`);
        failed++;
        return;
      }
      cleared++;
    });
  }

  console.log(`\nTotals across ${totalRows} rows: ${rowsToClear} row(s) affected, ${fieldsToClear} field value(s) non-date.`);
  console.log('By value:');
  for (const [value, count] of [...byValue.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(4)}  ${JSON.stringify(value)}`);
  }
  if (!DRY_RUN) {
    console.log(`\nCleared ${cleared} row(s); failed ${failed}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
