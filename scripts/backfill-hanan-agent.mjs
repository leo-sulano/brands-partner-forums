// scripts/backfill-hanan-agent.mjs
//
// One-time backfill: the Hanan Brand Tab is worked exclusively by the agent
// "ANN", and an "Agent" column was just added to its config + Add Review
// Account prefill. Entries created before that change have no Agent value at
// all, so buildAgentIndex (src/lib/scheduler/scheduleUtils.ts) can't resolve
// an agent for any Hanan brand — which is why Hanan's Schedule Planner -> PMS
// tasks are created with no assignee. This script writes data.Agent = "ANN"
// on every Hanan entry whose Agent is currently blank/missing, so the index
// (and everything downstream: PMS assignee resolution, agent success-rate
// surfaces) sees the real value.
//
// Only touches rows where Agent is empty — never overwrites an existing
// value (there shouldn't be any, but this stays safe if a stray one exists).
// Also treats a non-empty whitespace-variant key (e.g. "Agent ") as
// "already has a value" and skips.
//
// Signs in as CAPTURE_EMAIL/CAPTURE_PASSWORD (same approved account
// scripts/clear-invalid-dates.mjs uses) — RLS requires an approved
// authenticated user to write `entries`. Deliberately does NOT snapshot each
// row into edit_log first (unlike clear-invalid-dates.mjs): this is a bulk
// additive fill of a field that was never populated on any of these rows
// (confirmed by the dry-run below), not an edit with a meaningful prior
// value to restore — at ~1200 rows, per-row edit_log entries would flood the
// Activity Log and roughly double the write count for no real safety
// benefit. Reversal, if ever needed, is a single query: clear data.Agent
// where it equals "ANN" on tab='Hanan'. Bumps updated_at on touched rows
// (acceptable for a one-time run; fetchAllTabEntries is id-ordered and
// buildAgentIndex only cares that the most-recent entry carries "ANN", which
// after this run they all do).
//
// Usage: node scripts/backfill-hanan-agent.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');

const TAB = 'Hanan';
const AGENT_KEY = 'Agent';
const AGENT_VALUE = 'ANN';
const PAGE = 1000;

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

// True when the row already carries a real Agent value under the canonical
// key or any whitespace-variant of it.
function hasAgentValue(data) {
  for (const [k, val] of Object.entries(data ?? {})) {
    if (k.trim().toLowerCase() === 'agent' && typeof val === 'string' && val.trim() !== '') {
      return true;
    }
  }
  return false;
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
  if (!email || !password) {
    console.error('Missing CAPTURE_EMAIL / CAPTURE_PASSWORD — an approved account is required to write entries.');
    process.exit(1);
  }

  const supabase = createClient(url, anonKey);
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) {
    console.error('Sign-in failed:', authErr.message);
    process.exit(1);
  }
  const actor = { id: authData.user.id, email: authData.user.email ?? '' };
  console.log(`Signed in as ${actor.email}${DRY_RUN ? '  (dry run — no writes)' : ''}\n`);

  // Stable id-ordered pagination (see project note about updated_at-ordered
  // pages silently dropping a just-updated row).
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('entries')
      .select('id, tab, data, updated_at')
      .eq('tab', TAB)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('Select failed:', error.message);
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`Fetched ${rows.length} ${TAB} entries.`);

  const targets = rows.filter((r) => !hasAgentValue(r.data));
  console.log(`${targets.length} have no Agent value and will be set to "${AGENT_VALUE}".`);
  console.log(`${rows.length - targets.length} already have an Agent value and will be left untouched.\n`);

  if (targets.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let done = 0;
  let skipped = 0;
  for (const row of targets) {
    if (DRY_RUN) {
      done++;
      continue;
    }

    const mergedData = { ...row.data, [AGENT_KEY]: AGENT_VALUE };
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
      skipped++;
      continue;
    }

    done++;
    if (done % 50 === 0) console.log(`  …${done}/${targets.length}`);
  }

  console.log(`\n${DRY_RUN ? 'Would set' : 'Set'} Agent="${AGENT_VALUE}" on ${done} of ${targets.length}; skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
