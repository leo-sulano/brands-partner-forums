// scripts/audit-invalid-dates.mjs
//
// Read-only audit: finds every `entries` row across all tabs whose TP/AG/CG/WO
// Added or Removed/Not-Published date column holds something other than a
// real DD/MM/YYYY or YYYY-MM-DD date (or blank) — the same rule Add/Edit Entry
// now enforce going forward (see src/lib/dateUtils.ts's isValidDateText).
// Existing rows predate that guardrail, so bad values already in the table
// aren't touched by it; this script only reports them so a cleanup decision
// (clear vs. manually fix) can be made with real numbers, not "text got
// saved" assumptions confirmed row-by-row.
//
// Uses the anon key (reads are public on `entries`, see CLAUDE.md's Known
// Issues) — no service-role credential needed. Makes no writes.
//
// Usage: node scripts/audit-invalid-dates.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Same rule as src/lib/dateUtils.ts's isValidDateText/isRealCalendarDate —
// duplicated here since this is a standalone Node script outside the Vite/TS
// build. Keep in sync if that function's accepted formats ever change.
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

const BRAND_COLS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE', 'Account Name'];
function brandOf(data) {
  for (const c of BRAND_COLS) {
    if (data[c] && String(data[c]).trim()) return data[c];
  }
  return '';
}

const OPERATIONAL_TABS = [
  'TP Brand Injection', 'TP Affiliate', 'Rooster Partners', 'Revolution Casino',
  'Trybet', 'SilverPlay', 'SuprPlay Limited', 'HazEmirates UAE', 'Hanan',
  'Wizard of Odds', 'GRG - Gulf Recovery Group',
];

// A single unfiltered select across the whole (large) entries table hit
// Postgres's statement timeout — fetching per-tab with a smaller page size
// keeps each query's row/jsonb-decode cost well under that limit.
async function fetchAllEntries(supabase) {
  const PAGE_SIZE = 300;
  const rows = [];
  for (const tab of OPERATIONAL_TABS) {
    let offset = 0;
    for (;;) {
      // Explicit order is required for stable pagination — without one,
      // Postgrest doesn't guarantee page N+1 excludes rows already returned
      // in page N, which produced exact duplicate rows in an earlier run of
      // this script (same id appearing twice in the findings list).
      const { data, error } = await supabase
        .from('entries')
        .select('id, tab, data')
        .eq('tab', tab)
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`[${tab}] ${error.message ?? JSON.stringify(error)}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    console.log(`  ${tab}: ${rows.filter((r) => r.tab === tab).length} rows`);
  }
  return rows;
}

async function main() {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local or .env');
    process.exit(1);
  }
  const supabase = createClient(url, anonKey);

  console.log('Fetching all entries…');
  const entries = await fetchAllEntries(supabase);
  console.log(`Fetched ${entries.length} rows across all tabs.\n`);

  const findings = [];
  for (const entry of entries) {
    const data = entry.data ?? {};
    for (const header of DATE_ENTRY_HEADERS) {
      const raw = data[header];
      if (raw && !isValidDateText(String(raw))) {
        findings.push({ id: entry.id, tab: entry.tab, header, value: raw, brand: brandOf(data) });
      }
    }
  }

  if (findings.length === 0) {
    console.log('No invalid date values found. Nothing to clean up.');
    return;
  }

  const byTabHeader = new Map();
  for (const f of findings) {
    const key = `${f.tab} :: ${f.header}`;
    byTabHeader.set(key, (byTabHeader.get(key) ?? 0) + 1);
  }

  console.log(`Found ${findings.length} invalid date value(s):\n`);
  console.log('Summary by tab/column:');
  for (const [key, count] of [...byTabHeader.entries()].sort()) {
    console.log(`  ${count.toString().padStart(3)}  ${key}`);
  }

  const byValue = new Map();
  for (const f of findings) {
    const key = String(f.value).trim();
    byValue.set(key, (byValue.get(key) ?? 0) + 1);
  }
  console.log('\nSummary by distinct value (across all columns/tabs):');
  for (const [value, count] of [...byValue.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(4)}  ${JSON.stringify(value)}`);
  }

  const LIST_CAP = 60;
  console.log(`\nFull list (capped at ${LIST_CAP} of ${findings.length}):`);
  for (const f of findings.slice(0, LIST_CAP)) {
    console.log(`  [${f.tab}] ${f.header} = ${JSON.stringify(f.value)}  (brand: ${f.brand || '—'}, id: ${f.id})`);
  }
  if (findings.length > LIST_CAP) console.log(`  … and ${findings.length - LIST_CAP} more.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
