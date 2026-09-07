// scripts/backfill-hanan-pms-assignees.mjs
//
// One-time backfill, mirroring the 2026-08-18 assignee backfill: the
// Schedule Planner -> PMS sync only sets a task's assignee at CREATE time,
// from the brand's Agent value. Every Hanan PMS task created before the Hanan
// tab had an Agent value (all of them, until now) is sitting on the board
// unassigned. This assigns each currently-unassigned Hanan task to the PMS
// team member "Ann" (Hanan is ANN's tab exclusively).
//
// Resolution mirrors resolveAssigneeId in src/lib/scheduler/pmsSync.ts
// exactly: case/whitespace-insensitive name match against the live "Forum
// Team" roster. Purely additive — a task that already has an assignee (any
// name) is left untouched and reported, never reassigned away from a human's
// own PMS action.
//
// Reads schedule_pms_links via Supabase (signs in as CAPTURE_EMAIL/
// CAPTURE_PASSWORD so the read works regardless of that table's RLS). Talks
// to the PMS API with PMS_API_TOKEN from .env — same token the server-side
// sync uses. PATCH body is { assigneeIds: [id] } only (no labelIds key),
// verified in 2026-08 to be a true partial update that leaves a task's
// existing labels intact.
//
// Usage: node scripts/backfill-hanan-pms-assignees.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');

const TAB = 'Hanan';
const AGENT_NAME = 'ANN';

// Hardcoded 1:1 with the one real PMS project, same as src/lib/scheduler/pmsSync.ts.
const PMS_BASE_URL = 'https://pms-nu-eight.vercel.app/api';
const PMS_PROJECT_ID = 'cmsoh1uvs000004l4fbdvqmir';
const PMS_TEAM_ID = 'cmsd98mtx000204lgyb0abodx';

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

const norm = (s) => (s ?? '').trim().toLowerCase();

async function pmsGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function main() {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  const email = process.env.CAPTURE_EMAIL || env.CAPTURE_EMAIL;
  const password = process.env.CAPTURE_PASSWORD || env.CAPTURE_PASSWORD;
  const pmsToken = process.env.PMS_API_TOKEN || env.PMS_API_TOKEN;
  if (!url || !anonKey) {
    console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local or .env');
    process.exit(1);
  }
  if (!email || !password) {
    console.error('Missing CAPTURE_EMAIL / CAPTURE_PASSWORD.');
    process.exit(1);
  }
  if (!pmsToken) {
    console.error('Missing PMS_API_TOKEN in .env.');
    process.exit(1);
  }

  const supabase = createClient(url, anonKey);
  const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) {
    console.error('Sign-in failed:', authErr.message);
    process.exit(1);
  }
  console.log(`Signed in as ${email}${DRY_RUN ? '  (dry run — no writes)' : ''}\n`);

  // 1. Hanan's linked PMS task ids.
  const { data: links, error: linkErr } = await supabase
    .from('schedule_pms_links')
    .select('id, tab, brand, platform, date, pms_task_id')
    .eq('tab', TAB);
  if (linkErr) {
    console.error('schedule_pms_links read failed:', linkErr.message);
    process.exit(1);
  }
  const taskIds = [...new Set(links.map((l) => l.pms_task_id).filter(Boolean))];
  console.log(`${TAB}: ${links.length} schedule_pms_links rows -> ${taskIds.length} distinct PMS task ids.`);
  if (taskIds.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // 2. Resolve "ANN" against the live roster (resolveAssigneeId's rule).
  const team = await pmsGet(`${PMS_BASE_URL}/teams/${PMS_TEAM_ID}`, pmsToken);
  const members = (team.members ?? []).map((m) => ({ id: m.user.id, name: m.user.name }));
  const annId = members.find((m) => norm(m.name) === norm(AGENT_NAME))?.id ?? null;
  if (!annId) {
    console.error(`No PMS team member matches "${AGENT_NAME}". Roster: ${members.map((m) => m.name).join(', ')}`);
    process.exit(1);
  }
  console.log(`Resolved "${AGENT_NAME}" -> PMS member id ${annId}.\n`);

  // 3. One project-wide task list; index by id for the current-assignee check.
  const allTasks = await pmsGet(`${PMS_BASE_URL}/projects/${PMS_PROJECT_ID}/tasks`, pmsToken);
  const byId = new Map(allTasks.map((t) => [t.id, t]));

  let toAssign = 0;
  let alreadyAnn = 0;
  let otherAssignee = 0;
  let missing = 0;
  let failed = 0;
  const queue = [];

  for (const id of taskIds) {
    const task = byId.get(id);
    if (!task) {
      missing++;
      console.warn(`  [MISSING] task ${id} not in project task list (deleted in PMS?) — skipping.`);
      continue;
    }
    const current = task.assignees?.[0]?.user?.name ?? null;
    if (current && norm(current) === norm(AGENT_NAME)) {
      alreadyAnn++;
      continue;
    }
    if (current) {
      otherAssignee++;
      console.warn(`  [KEEP] task ${id} already assigned to "${current}" — leaving untouched.`);
      continue;
    }
    toAssign++;
    queue.push(id);
  }

  console.log(`\nUnassigned Hanan tasks to set to "${AGENT_NAME}": ${toAssign}`);
  console.log(`Already "${AGENT_NAME}": ${alreadyAnn}   Other assignee (kept): ${otherAssignee}   Missing: ${missing}`);

  if (DRY_RUN || queue.length === 0) {
    console.log(DRY_RUN ? '\nDry run — no writes made.' : '\nNothing to assign.');
    return;
  }

  console.log('');
  let done = 0;
  for (const id of queue) {
    const res = await fetch(`${PMS_BASE_URL}/tasks/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${pmsToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigneeIds: [annId] }),
    });
    if (!res.ok) {
      failed++;
      console.error(`  [FAIL] task ${id} — PATCH ${res.status}`);
      continue;
    }
    done++;
    if (done % 25 === 0) console.log(`  …${done}/${queue.length}`);
  }

  console.log(`\nAssigned ${done} of ${queue.length}; failed ${failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
