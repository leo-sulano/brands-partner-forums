// Shared by two Deno consumers -- the browser-facing sync-schedule-pms Edge
// Function and the (not yet deployed) generate-weekly-schedule cron
// function -- plus nothing on the browser side directly, since the PMS API
// token never reaches the browser. Same "one src/lib module, multiple
// server-side consumers" shape schedulerService.ts itself already has.
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBrandKey, buildRemovedPlatformBrandSet, type Platform } from '../removedPlatformBrands.ts';
import { fetchSchedulePmsLinks, insertSchedulePmsLink, updateSchedulePmsLinkDate, updateSchedulePmsLinkStatus, updateSchedulePmsLinkColumn, deleteSchedulePmsLink, fetchRawEntriesByTab, fetchRemovedPlatformBrands, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, fetchScheduleBrandPauses, fetchActiveBrandPlatformPauses, fetchBrandSchedule, fetchTabEntriesWatermark, fetchSyncWatermark, upsertSyncWatermark, type SchedulePmsLink } from '../queries.ts';
import { buildDateStatusIndex, resolvePmsSyncStatus, hasDateEvidence, type PmsSyncStatus, type EntryDetails } from './scheduleUtils.ts';
import { buildHiddenBrandSet, buildPlatformRestrictionMap, resolveBrandPlatforms } from '../scheduleBrandConfig.ts';
import { getTabPlatforms } from '../tab-configs.ts';
import { weekdayAndWeekStartFor, scheduleFor, type BrandScheduleRow } from '../scheduleBrands.ts';
import { tabDisplayName } from '../tabs.ts';

// Confirmed live against the real "Forum Team" PMS project while writing
// this spec (a throwaway test label/task was created via these exact
// endpoints, verified, then deleted). Hardcoded, not env-configurable --
// this integration is 1:1 with one specific PMS project.
const PMS_BASE_URL = 'https://pms-nu-eight.vercel.app/api';
const PMS_PROJECT_ID = 'cmsoh1uvs000004l4fbdvqmir';
const PMS_TODO_COLUMN_ID = 'cmsoh1uxz000204l46gf88k3f';
const PMS_DONE_COLUMN_ID = 'cmsoh1uxz000604l4j5loen7g';
const PMS_PAUSED_COLUMN_ID = 'cmt8eih3x000004lazna3tbmz';
const PMS_TEAM_ID = 'cmsd98mtx000204lgyb0abodx';
const PMS_CLIENT_LABEL_NAME = 'Client';
const PMS_PLATFORM_LABEL_NAMES: Record<Platform, string> = { tp: 'TP', ag: 'AG', cg: 'CG', wo: 'WO' };
// Every existing platform label (TP/AG/CG) already has its own color; WO is
// the one platform with no label yet in the live project, auto-created the
// first time a WO item needs tagging.
const WO_LABEL_COLOR = 'blue';

export interface PmsCredentials {
  apiToken: string;
}

export interface PmsSyncItem {
  tab: string;
  tabLabel: string;
  brand: string;
  platform: Platform;
  date: string;
  // The dashboard's Agent value for this brand (resolved via
  // resolveAgentForPlatform, which checks brand_agent_assignments before
  // falling back to buildAgentIndex -- caller-resolved, this module has no
  // reason to re-derive it from raw entries itself). Null/undefined means no
  // agent could be resolved (no entries, or a blank Agent column) -- the
  // created task is left unassigned, same as when the resolved name has no
  // PMS team match.
  agent?: string | null;
}

export interface PmsPushResult {
  created: PmsSyncItem[];
  skipped: PmsSyncItem[];
  failed: { item: PmsSyncItem; error: string }[];
}

interface PmsLabel {
  id: string;
  name: string;
}

interface PmsTaskCreated {
  id: string;
}

interface PmsTeamMember {
  id: string;
  name: string;
}

function pmsHeaders(credentials: PmsCredentials): Record<string, string> {
  return { Authorization: `Bearer ${credentials.apiToken}`, 'Content-Type': 'application/json' };
}

async function fetchPmsTeamMembers(credentials: PmsCredentials, fetchFn: typeof fetch): Promise<PmsTeamMember[]> {
  const res = await fetchFn(`${PMS_BASE_URL}/teams/${PMS_TEAM_ID}`, { headers: pmsHeaders(credentials) });
  if (!res.ok) throw new Error(`PMS team fetch failed: ${res.status}`);
  const team = (await res.json()) as { members: { user: { id: string; name: string } }[] };
  return team.members.map((m) => ({ id: m.user.id, name: m.user.name }));
}

// Case/whitespace-insensitive match against the real PMS team roster -- the
// dashboard's own Agent values are free text with real casing/whitespace
// variants in production data (e.g. "Jen"/"LAI"/"ANN"/"Ann "), same
// normalization spirit as normalizeBrandKey elsewhere in this codebase. No
// match (an agent not on the PMS team, or a placeholder value) returns null
// -- the caller leaves the task unassigned rather than guessing.
function resolveAssigneeId(agent: string | null | undefined, members: PmsTeamMember[]): string | null {
  if (!agent) return null;
  const key = agent.trim().toLowerCase();
  if (!key) return null;
  return members.find((m) => m.name.trim().toLowerCase() === key)?.id ?? null;
}

async function fetchPmsLabels(credentials: PmsCredentials, fetchFn: typeof fetch): Promise<PmsLabel[]> {
  const res = await fetchFn(`${PMS_BASE_URL}/projects/${PMS_PROJECT_ID}/labels`, { headers: pmsHeaders(credentials) });
  if (!res.ok) throw new Error(`PMS labels fetch failed: ${res.status}`);
  return (await res.json()) as PmsLabel[];
}

async function createPmsLabel(name: string, color: string, credentials: PmsCredentials, fetchFn: typeof fetch): Promise<PmsLabel> {
  const res = await fetchFn(`${PMS_BASE_URL}/projects/${PMS_PROJECT_ID}/labels`, {
    method: 'POST',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ name, color }),
  });
  if (!res.ok) throw new Error(`PMS label create failed: ${res.status}`);
  return (await res.json()) as PmsLabel;
}

async function resolveLabelId(
  name: string,
  color: string,
  labelCache: PmsLabel[],
  credentials: PmsCredentials,
  fetchFn: typeof fetch,
): Promise<string> {
  const existing = labelCache.find((l) => l.name === name);
  if (existing) return existing.id;
  const created = await createPmsLabel(name, color, credentials, fetchFn);
  labelCache.push(created);
  return created.id;
}

async function createPmsTask(title: string, dueDate: string, credentials: PmsCredentials, fetchFn: typeof fetch): Promise<PmsTaskCreated> {
  const res = await fetchFn(`${PMS_BASE_URL}/projects/${PMS_PROJECT_ID}/tasks`, {
    method: 'POST',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ title, columnId: PMS_TODO_COLUMN_ID, priority: 'MEDIUM', dueDate }),
  });
  if (!res.ok) throw new Error(`PMS task create failed: ${res.status}`);
  return (await res.json()) as PmsTaskCreated;
}

// One PATCH call covers both labels and assignee (confirmed live: the API
// accepts labelIds and assigneeIds together) -- assigneeId is omitted from
// the body entirely, not sent as an empty array, when no agent resolved to a
// real PMS team member, since the task should simply stay unassigned rather
// than the API being asked to clear an assignee that was never set.
async function setPmsTaskLabelsAndAssignee(
  taskId: string,
  labelIds: string[],
  assigneeId: string | null,
  credentials: PmsCredentials,
  fetchFn: typeof fetch,
): Promise<void> {
  const body: { labelIds: string[]; assigneeIds?: string[] } = { labelIds };
  if (assigneeId) body.assigneeIds = [assigneeId];
  const res = await fetchFn(`${PMS_BASE_URL}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: pmsHeaders(credentials),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PMS task label/assignee update failed: ${res.status}`);
}

// One PMS task per exact (tab, brand, platform, date) -- idempotent via
// schedule_pms_links, so re-running this for a combo that's already linked
// is always safe (no duplicate task, no API calls beyond the links lookup).
// A per-item failure is caught and recorded rather than aborting the batch,
// since these calls come from batches (e.g. every combo ensureWeekGenerated
// just activated for a tab) where one bad item shouldn't block the rest.
export async function pushScheduleToPms(
  items: PmsSyncItem[],
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsPushResult> {
  const created: PmsSyncItem[] = [];
  const skipped: PmsSyncItem[] = [];
  const failed: { item: PmsSyncItem; error: string }[] = [];
  if (items.length === 0) return { created, skipped, failed };

  const linksByTab = new Map<string, SchedulePmsLink[]>();
  let labelCache: PmsLabel[] | null = null;
  let teamMembers: PmsTeamMember[] | null = null;

  for (const item of items) {
    try {
      const brandKey = normalizeBrandKey(item.brand);
      let links = linksByTab.get(item.tab);
      if (!links) {
        links = await fetchSchedulePmsLinks(item.tab, client);
        linksByTab.set(item.tab, links);
      }
      const alreadyLinked = links.some((l) => l.brand_key === brandKey && l.platform === item.platform && l.date === item.date);
      if (alreadyLinked) {
        skipped.push(item);
        continue;
      }

      if (!labelCache) labelCache = await fetchPmsLabels(credentials, fetchFn);
      const platformLabelId = await resolveLabelId(PMS_PLATFORM_LABEL_NAMES[item.platform], WO_LABEL_COLOR, labelCache, credentials, fetchFn);
      const clientLabelId = await resolveLabelId(PMS_CLIENT_LABEL_NAME, WO_LABEL_COLOR, labelCache, credentials, fetchFn);
      // Lazy: only fetched the first time an item actually carries an agent
      // to resolve, so a push with no agent info (or run before this field
      // existed) never makes this extra call at all.
      if (!teamMembers && item.agent) teamMembers = await fetchPmsTeamMembers(credentials, fetchFn);
      const assigneeId = resolveAssigneeId(item.agent, teamMembers ?? []);

      const task = await createPmsTask(`${item.tabLabel} | ${item.brand}`, item.date, credentials, fetchFn);
      await setPmsTaskLabelsAndAssignee(task.id, [platformLabelId, clientLabelId], assigneeId, credentials, fetchFn);
      await insertSchedulePmsLink(item.tab, item.brand, item.platform, item.date, task.id, PMS_TODO_COLUMN_ID, client);
      // Reflect the just-created link back into this tab's in-memory `links`
      // array so a later item in the SAME batch that repeats this exact combo
      // (e.g. rapid re-cycling of one cell while a prior push is in flight)
      // sees it as already-linked via `alreadyLinked` above, instead of
      // attempting a second PMS task create that would then fail
      // insertSchedulePmsLink on the table's (tab, brand_key, platform, date)
      // unique constraint and leave an orphaned PMS task with no link at all.
      links.push({ id: '', tab: item.tab, brand: item.brand, brand_key: brandKey, platform: item.platform, date: item.date, pms_task_id: task.id, synced_status: 'active', synced_column_id: PMS_TODO_COLUMN_ID });
      created.push(item);
    } catch (err) {
      failed.push({ item, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { created, skipped, failed };
}

// Only 'active' stays in To Do. Once a scheduled slot resolves to any real
// outcome -- Pending, Done, Published, or Removed -- its task moves straight
// to Done, so a human can see at a glance that the slot is settled without
// opening the dashboard. 'paused' (a scheduler auto-pause, or a single day
// cell manually cycled to Paused -- resolvePmsSyncStatus's caller combines
// both into one boolean) moves the task to the real "Project Paused" column
// instead, superseding the earlier design where a paused combo's task was
// simply left untouched. Only an explicit Cancel (a day written back to
// blank via the Cancel button, or the legacy blank-cycle leg) never reaches
// this mapping at all -- resolveAndSyncTabStatuses' cancellation branch above
// deletes that link/task outright before targetStatus is even computed,
// since a genuinely-cancelled day has nothing left to track.
const PMS_STATUS_COLUMN_IDS: Record<PmsSyncStatus, string> = {
  active: PMS_TODO_COLUMN_ID,
  pending: PMS_DONE_COLUMN_ID,
  done: PMS_DONE_COLUMN_ID,
  published: PMS_DONE_COLUMN_ID,
  removed: PMS_DONE_COLUMN_ID,
  paused: PMS_PAUSED_COLUMN_ID,
};

export interface PmsStatusSyncItem {
  linkId: string;
  pmsTaskId: string;
  targetStatus: PmsSyncStatus;
  // tabLabel/brand/date are the same values the task was created with (see
  // PmsSyncItem above) -- needed here so computeGroupedInsertPosition can
  // place the moved task among its actual due-date/tab/brand peers instead
  // of always landing at the top of the target column.
  tabLabel: string;
  brand: string;
  date: string;
  // Set only when targetStatus resolved from real evidence (done/pending/
  // published/removed) -- see buildTaskDescription below. Undefined for
  // active/paused, which stay title+due-date only, matching a plan-only slot
  // having nothing yet to report.
  description?: string;
}

export interface PmsStatusSyncResult {
  synced: PmsStatusSyncItem[];
  failed: { item: PmsStatusSyncItem; error: string }[];
}

// resolveAndSyncTabStatuses's own return type -- a superset of
// PmsStatusSyncResult (syncScheduleStatusToPms's plain result type, kept
// unchanged so its own tests/callers are untouched) adding the self-healing
// cancellation outcome. cancelled/cancelFailed mirror PmsCancelResult's own
// deleted/failed shape (see cancelScheduleInPms further below), just named
// to match this function's own synced/failed pair.
export interface PmsResolveResult extends PmsStatusSyncResult {
  cancelled: PmsCancelItem[];
  cancelFailed: { item: PmsCancelItem; error: string }[];
}

async function movePmsTask(taskId: string, columnId: string, position: number, credentials: PmsCredentials, fetchFn: typeof fetch): Promise<void> {
  const res = await fetchFn(`${PMS_BASE_URL}/tasks/${taskId}/move`, {
    method: 'PATCH',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ columnId, position }),
  });
  if (!res.ok) throw new Error(`PMS task move failed: ${res.status}`);
}

// Confirmed live against the real "Forum Team" project (2026-08-27): the
// general task PATCH endpoint (distinct from /tasks/:id/move above, which
// only accepts columnId/position) accepts a plain `description` field.
async function setPmsTaskDescription(taskId: string, description: string, credentials: PmsCredentials, fetchFn: typeof fetch): Promise<void> {
  const res = await fetchFn(`${PMS_BASE_URL}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ description }),
  });
  if (!res.ok) throw new Error(`PMS task description update failed: ${res.status}`);
}

// Renders the matched entry's Account/Country/Proxy Used as a fixed
// three-line details block, then -- only when review-text content exists --
// a blank line followed by the content itself. A blank Account/Country/Proxy
// still gets its own line with nothing after the label, so the block's shape
// never changes based on which fields happen to be filled in; a blank
// content is simply omitted rather than leaving a trailing blank line.
export function buildTaskDescription(details: EntryDetails): string {
  const lines = [`Account: ${details.account}`, `Country: ${details.country}`, `Proxy: ${details.proxy}`];
  if (details.content) lines.push('', details.content);
  return lines.join('\n');
}

// A task's title is always "<tabLabel> | <brand>" (see createPmsTask above) --
// this pulls just the tabLabel back out so a card already sitting in a target
// column can be grouped against without needing its own PmsSyncItem.
function tabLabelFromTitle(title: string): string {
  const sep = title.indexOf(' | ');
  return sep === -1 ? title : title.slice(0, sep);
}

// The other half of tabLabelFromTitle -- everything after " | ". Returns ''
// for a title with no separator (a manually-created, non-schedule card), so
// it sorts before every real brand name rather than throwing.
function brandFromTitle(title: string): string {
  const sep = title.indexOf(' | ');
  return sep === -1 ? '' : title.slice(sep + 3);
}

function dueDateSortKey(dueDate: string | null | undefined): string {
  return dueDate ? dueDate.slice(0, 10) : '';
}

// Shared grouping key -- (due date, tab label, brand) -- used both by
// computeGroupedInsertPosition (a single moved/created card) and
// computeColumnSortMoves (a full-column re-sort) below, so a card placed by
// one is never immediately re-shuffled by the other. Brand is the tie-breaker
// within a same-date-same-tab cluster, per an explicit user request: cards
// should read date-1 BITP/BrandA, date-1 BITP/BrandB in brand order, not left
// in whatever order they happened to already be in.
function taskSortKey(dueDate: string | null | undefined, title: string): string {
  return `${dueDateSortKey(dueDate)} ${tabLabelFromTitle(title).toLowerCase()} ${brandFromTitle(title).toLowerCase()}`;
}

// Confirmed live against the real "Forum Team" project (2026-08-27): each
// column holds a dense, zero-based `position` per task, and moving a task to
// position N there shifts every task at/after N down by one -- so computing
// "how many peers in the target column already sort at-or-before this item"
// and moving to that index reproduces a stable insertion sort, one move at a
// time. Grouping key is (due date, tab label, brand) per an explicit user
// request: cards should read date-27 Hanan/AaaBrand, date-27 Hanan/ZzzBrand,
// date-27 BITP/..., not interleaved by whichever tab's status happened to
// change most recently, nor left unsorted within a same-date-same-tab
// cluster. Ties (identical date + tab + brand) sort the new/moved item after
// its existing peers (`<=`), so it joins the tail of its own cluster instead
// of splitting it.
function computeGroupedInsertPosition(
  tasks: PmsTaskListed[],
  columnId: string,
  dueDate: string,
  tabLabel: string,
  brand: string,
  excludeTaskId: string,
): number {
  const newKey = `${dueDateSortKey(dueDate)} ${tabLabel.toLowerCase()} ${brand.toLowerCase()}`;
  return tasks.filter((t) => {
    if (t.columnId !== columnId || t.id === excludeTaskId) return false;
    return taskSortKey(t.dueDate, t.title) <= newKey;
  }).length;
}

export interface PmsSortMove {
  taskId: string;
  columnId: string;
  position: number;
}

// Full-board re-sort: within EVERY column found among `tasks` (not just the
// ones enforcePmsColumns' status-drift loop manages -- this is what actually
// covers a human-populated column like "In Progress"/"Blocked" that this
// codebase never writes into directly), reorders the schedule-linked cards
// (task id present in `linkedTaskIds`) into the same (due date, tab label)
// grouping computeGroupedInsertPosition already uses, while never issuing a
// move for a manually-created card (id absent from `linkedTaskIds`) -- per an
// explicit user request, a human's own task stays exactly where they put it;
// a linked card can still land on either side of it as the sort proceeds.
// Diff-based (an already-sorted column produces zero moves): walks the
// column's current (position-ordered) tasks left to right, and whenever the
// desired (sorted) card for a linked slot isn't already there, relocates it
// -- mirroring the single-item "stable insertion sort, one move at a time"
// approach above, just applied across every linked slot in the column
// instead of one caller-supplied card. A pinned slot is always skipped
// outright (never compared, never moved); the ascending left-to-right walk
// self-corrects the linked cards around it as it proceeds. `simulated` models
// the real API's own remove-then-reinsert shift semantics purely in memory,
// so each successive move's `position` argument is computed against the
// board state as it will actually be after every move emitted so far.
export function computeColumnSortMoves(tasks: PmsTaskListed[], linkedTaskIds: Set<string>): PmsSortMove[] {
  const moves: PmsSortMove[] = [];
  const columnIds = [...new Set(tasks.map((t) => t.columnId))];

  for (const columnId of columnIds) {
    const current = tasks.filter((t) => t.columnId === columnId).sort((a, b) => a.position - b.position);
    if (current.length < 2) continue;

    const sortedLinked = current
      .filter((t) => linkedTaskIds.has(t.id))
      .sort((a, b) => {
        const ka = taskSortKey(a.dueDate, a.title);
        const kb = taskSortKey(b.dueDate, b.title);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
    if (sortedLinked.length < 2) continue;

    let linkedIdx = 0;
    const target = current.map((t) => (linkedTaskIds.has(t.id) ? sortedLinked[linkedIdx++] : t));

    const simulated = [...current];
    for (let i = 0; i < target.length; i++) {
      if (!linkedTaskIds.has(target[i].id)) continue; // never move a manually-created card
      if (simulated[i].id === target[i].id) continue; // already correct
      const fromIdx = simulated.findIndex((t) => t.id === target[i].id);
      const [movedTask] = simulated.splice(fromIdx, 1);
      simulated.splice(i, 0, movedTask);
      moves.push({ taskId: target[i].id, columnId, position: i });
    }
  }
  return moves;
}

// Moves each linked task's PMS column to match its resolved dashboard status
// (see resolvePmsSyncStatus in scheduleUtils.ts for how targetStatus is
// derived -- resolution now happens entirely server-side, in
// resolveAndSyncTabStatuses below, which calls this function internally)
// -- one-way, dashboard -> PMS only, never the reverse.
// Per-item try/catch mirrors pushScheduleToPms's existing batch resilience:
// one failed move never blocks the rest. schedule_pms_links.synced_status is
// only updated on a successful move, so a failed item is naturally retried on
// the caller's next sync pass (its resolved status still won't match the
// stale synced_status).
export async function syncScheduleStatusToPms(
  items: PmsStatusSyncItem[],
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsStatusSyncResult> {
  const synced: PmsStatusSyncItem[] = [];
  const failed: { item: PmsStatusSyncItem; error: string }[] = [];
  if (items.length === 0) return { synced, failed };

  // Read once and kept in sync locally as items in this batch are moved (see
  // the tasks.filter/tasks.push pair below), so a later item's grouping
  // calculation sees an earlier item's new placement in this same batch
  // instead of stale pre-batch data -- same "reflect the write back into the
  // in-memory cache" shape pushScheduleToPms already uses for its links
  // cache. A failed fetch here degrades to ungrouped inserts (position 0,
  // this function's pre-existing behavior) rather than failing every item in
  // the batch -- a move must never be skipped just because the extra
  // grouping lookup didn't succeed.
  let tasks: PmsTaskListed[] = [];
  try {
    tasks = await fetchPmsProjectTasks(credentials, fetchFn);
  } catch {
    tasks = [];
  }

  for (const item of items) {
    try {
      const columnId = PMS_STATUS_COLUMN_IDS[item.targetStatus];
      const position = computeGroupedInsertPosition(tasks, columnId, item.date, item.tabLabel, item.brand, item.pmsTaskId);
      await movePmsTask(item.pmsTaskId, columnId, position, credentials, fetchFn);
      // A description-write failure here fails the whole item (same catch as
      // the move above) rather than being swallowed -- the move already
      // succeeded, but synced_status is deliberately not updated until
      // both writes land, so a description failure is naturally retried on
      // the next sync pass (the resolved status still won't match the stale
      // synced_status) instead of silently never getting a description.
      if (item.description != null) await setPmsTaskDescription(item.pmsTaskId, item.description, credentials, fetchFn);
      await updateSchedulePmsLinkStatus(item.linkId, item.targetStatus, columnId, client);
      tasks = tasks.filter((t) => t.id !== item.pmsTaskId);
      tasks.push({ id: item.pmsTaskId, title: `${item.tabLabel} | ${item.brand}`, columnId, position, dueDate: item.date, assignees: [] });
      synced.push(item);
    } catch (err) {
      failed.push({ item, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { synced, failed };
}

export interface PmsColumnEnforceResult {
  moved: { linkId: string; pmsTaskId: string; from: string; to: string }[];
  // Pure within-column reorders from the full-board sort pass below -- from
  // and to are always the same columnId, unlike `moved` above.
  resorted: { linkId: string; pmsTaskId: string; columnId: string; position: number }[];
  failed: { linkId: string; pmsTaskId: string; error: string }[];
}

// Column-drift reconcile: corrects a linked PMS task's column only when the
// system's OWN intended column for its synced_status has itself drifted --
// i.e. link.synced_column_id (what PMS_STATUS_COLUMN_IDS[synced_status]
// mapped to the last time this link was written) no longer matches what that
// same mapping computes now. That can only happen from a PMS_STATUS_COLUMN_IDS
// remap in this file's own code (e.g. Task 267 moving pending/done from In
// Progress to Done left every already-synced card stranded, since
// targetStatus still equalled synced_status so nothing was queued) -- never
// from ordinary use, since syncScheduleStatusToPms/pushScheduleToPms always
// keep synced_column_id in lockstep with wherever they actually place a card.
// A card sitting somewhere else because a human dragged it in the PMS UI
// (synced_column_id still matches the current mapping; only the real
// task.columnId differs) is deliberately left alone -- per an explicit user
// request, this is no longer "corrected" back. Runs across ALL links every
// tick, including schedule-paused/archived tabs, since a mapping change
// strands their cards too and those tabs are never resolved. One GET /tasks
// per call; a PATCH only for a link undergoing a genuine remap correction. A
// link whose task is gone from PMS is skipped (pullScheduleFromPms owns
// stale-link deletion). Same per-item try/catch and in-memory task-list
// bookkeeping as syncScheduleStatusToPms so grouped inserts stay correct
// across a batch.
export async function enforcePmsColumns(
  links: SchedulePmsLink[],
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsColumnEnforceResult> {
  const moved: PmsColumnEnforceResult['moved'] = [];
  const resorted: PmsColumnEnforceResult['resorted'] = [];
  const failed: PmsColumnEnforceResult['failed'] = [];
  if (links.length === 0) return { moved, resorted, failed };

  // No try/catch here: a failed task-list fetch means nothing can be
  // reconciled this tick, and the caller (handleReconcileColumns) turns the
  // throw into one visible 'error: ...' string rather than it being swallowed
  // into a silent no-op -- the exact failure mode this whole feature exists
  // to prevent (Task 279).
  let tasks = await fetchPmsProjectTasks(credentials, fetchFn);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  for (const link of links) {
    const task = byId.get(link.pms_task_id);
    if (!task) continue;
    const want = PMS_STATUS_COLUMN_IDS[link.synced_status as PmsSyncStatus];
    if (!want) continue;
    if (task.columnId === want) continue;
    if (link.synced_column_id === want) continue; // human moved it; respect it
    const tabLabel = tabDisplayName(link.tab);
    try {
      const position = computeGroupedInsertPosition(tasks, want, link.date, tabLabel, link.brand, link.pms_task_id);
      await movePmsTask(link.pms_task_id, want, position, credentials, fetchFn);
      await updateSchedulePmsLinkColumn(link.id, want, client);
      tasks = tasks.filter((t) => t.id !== link.pms_task_id);
      tasks.push({ id: link.pms_task_id, title: `${tabLabel} | ${link.brand}`, columnId: want, position, dueDate: link.date, assignees: [] });
      moved.push({ linkId: link.id, pmsTaskId: link.pms_task_id, from: task.columnId, to: want });
    } catch (err) {
      failed.push({ linkId: link.id, pmsTaskId: link.pms_task_id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Full-board sort pass -- this is what actually reaches a column like "In
  // Progress"/"Blocked" that the drift-correction loop above never targets
  // (no synced_status maps to it), since it reasons about every real columnId
  // found in the fetch, not just PMS_STATUS_COLUMN_IDS' values. `linkedTaskIds`
  // is every schedule-managed card on the whole board (all of `links`, not
  // just ones this tick's drift loop touched), so a card sitting in a
  // human-populated column is still recognized as "ours to sort" even though
  // its column itself is left alone. Deliberately re-fetches fresh rather than
  // reusing the drift loop's `tasks` variable when it moved anything: that
  // variable's own in-memory bookkeeping only ever appends a moved item's new
  // entry and never re-indexes the peers it actually shifted past (it only
  // ever needed to support computeGroupedInsertPosition's peer-counting, which
  // doesn't care about stale `.position` values) -- this pass is the first
  // consumer that sorts BY `.position`, so it needs the real, authoritative
  // per-task positions the API now reports, not that approximation.
  const tasksForSort = moved.length > 0 ? await fetchPmsProjectTasks(credentials, fetchFn) : tasks;
  const linkedTaskIds = new Set(links.map((l) => l.pms_task_id));
  const linkIdByTaskId = new Map(links.map((l) => [l.pms_task_id, l.id]));
  for (const move of computeColumnSortMoves(tasksForSort, linkedTaskIds)) {
    const linkId = linkIdByTaskId.get(move.taskId) ?? '';
    try {
      await movePmsTask(move.taskId, move.columnId, move.position, credentials, fetchFn);
      resorted.push({ linkId, pmsTaskId: move.taskId, columnId: move.columnId, position: move.position });
    } catch (err) {
      failed.push({ linkId, pmsTaskId: move.taskId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { moved, resorted, failed };
}

// The one place the full dashboard -> PMS status resolution rules are
// implemented (evidence precedence, pause exclusion, hidden/restricted/
// removed-platform exclusion) -- both the on-visit browser trigger and the
// 1-minute cron reach this same function over HTTP through
// sync-schedule-pms's syncAllStatuses action (see that Edge Function's
// index.ts), never a second independently-written copy of these rules.
// Mirrors what TabScheduleSection.tsx's status-sync effect used to compute
// inline before this extraction.
//
// Watermark short-circuit: the 1-minute cron calls this for every active tab
// every tick, whether or not anything actually changed -- without this
// check, that means a full fetchRawEntriesByTab pull (some tabs 1,700+ rows
// of heavy jsonb) every minute forever, even for a tab nobody has touched in
// weeks. fetchTabEntriesWatermark is a cheap, index-backed "what's the
// newest entries.updated_at for this tab right now" check; if it matches
// what was recorded the last time this tab fully resolved with no failures,
// nothing could have changed since, so the whole resolve is skipped. Scoped
// deliberately to entries.updated_at only, not the exclusion-config tables
// (removed_platform_brands, schedule_hidden_brands,
// schedule_platform_restrictions, brand_platform_pause, brand_schedule) --
// those change far less often, and a config-only change with no entries
// write is still caught by the next entries change on that tab, or by the
// on-visit trigger the next time someone opens it.
//
// force bypasses this short-circuit entirely (still records the watermark
// normally afterward) -- the escape hatch for the daily audit sweep
// (handleAuditAllStatuses/'auditAllStatuses' action below). The watermark
// approach trusts "the last resolve completed with zero exceptions" as proof
// every individual link was actually synced correctly; those aren't the same
// thing, and this project has repeatedly found new, different ways for that
// assumption to be wrong (Tasks 287, 288, 302 in docs/task-history.md), each
// leaving some link's synced_status silently stuck until a human noticed and
// a watermark was cleared by hand. force=true reproduces that manual
// remediation automatically, on a schedule, regardless of whether today's
// specific trigger is one already seen before.
export async function resolveAndSyncTabStatuses(
  tab: string,
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
  isTabPaused = false,
  force = false,
): Promise<PmsResolveResult> {
  const links = await fetchSchedulePmsLinks(tab, client);
  if (links.length === 0) return { synced: [], failed: [], cancelled: [], cancelFailed: [] };

  // Whole-Brand-Tab pause (paused_tabs, see pausedTabRegistry.ts) forces every
  // still-eligible link straight to 'paused', bypassing the entries watermark
  // (a tab pause isn't reflected in entries.updated_at, so the short-circuit
  // below would otherwise wrongly skip a just-paused tab) and the
  // cancellation-detection block (a paused tab's held slots are deliberately
  // parked, not stale). The hidden/restricted/removed-platform-brand
  // eligibility filter still applies -- an already-excluded combo is left
  // alone here too, so it isn't force-paused and then stuck unable to resolve
  // back out once the tab unpauses (that combo was already excluded from the
  // normal resolve path below, for the same reason). PMS-side only: this
  // never touches brand_schedule -- the calendar itself is unaffected by a
  // tab pause, per the feature's design.
  if (isTabPaused) {
    const [removedPlatformBrandRows, hiddenBrandRows, restrictedBrandRows, pausedBrandRows] = await Promise.all([
      fetchRemovedPlatformBrands(client),
      fetchScheduleHiddenBrands(tab, client),
      fetchScheduleRestrictedBrands(tab, client),
      fetchScheduleBrandPauses(tab, client),
    ]);
    const removedPlatformBrandSet = buildRemovedPlatformBrandSet(removedPlatformBrandRows);
    // Whole-brand pauses merge into the same hiddenSet a fully-hidden brand
    // uses -- see scheduleBrandConfig.ts's file header and the paused-brands
    // design spec.
    const hiddenBrandSet = buildHiddenBrandSet([...hiddenBrandRows, ...pausedBrandRows]);
    const platformRestrictionMap = buildPlatformRestrictionMap(restrictedBrandRows);
    const tabPlatforms = getTabPlatforms(tab);

    const items: PmsStatusSyncItem[] = [];
    for (const link of links) {
      if (link.synced_status === 'paused') continue;
      const allowedPlatforms = resolveBrandPlatforms(tab, link.brand, tabPlatforms, hiddenBrandSet, platformRestrictionMap, removedPlatformBrandSet);
      if (!allowedPlatforms.includes(link.platform)) continue;
      items.push({ linkId: link.id, pmsTaskId: link.pms_task_id, targetStatus: 'paused', tabLabel: tabDisplayName(link.tab), brand: link.brand, date: link.date });
    }
    // Unconditionally invalidates this tab's recorded watermark (an empty
    // string can never equal a real entries.updated_at timestamp, nor the
    // null a tab with no entries produces). While paused, synced_status is
    // being force-managed independent of entries -- without this, the normal
    // path's watermark short-circuit below would see an unchanged watermark
    // the next time this tab goes active again (nothing about unpausing
    // touches entries.updated_at) and skip resolving anything, leaving every
    // link stuck on 'paused' forever unless entries happen to change first.
    await upsertSyncWatermark(tab, '', client).catch(() => {});
    if (items.length === 0) return { synced: [], failed: [], cancelled: [], cancelFailed: [] };
    const result = await syncScheduleStatusToPms(items, client, credentials, fetchFn);
    return { ...result, cancelled: [], cancelFailed: [] };
  }

  const [currentWatermark, storedWatermark] = await Promise.all([
    fetchTabEntriesWatermark(tab, client),
    fetchSyncWatermark(tab, client),
  ]);
  if (!force && currentWatermark !== null && currentWatermark === storedWatermark) {
    return { synced: [], failed: [], cancelled: [], cancelFailed: [] };
  }

  const [entries, removedPlatformBrandRows, hiddenBrandRows, restrictedBrandRows, pausedBrandRows, pauses] = await Promise.all([
    fetchRawEntriesByTab(tab, client),
    fetchRemovedPlatformBrands(client),
    fetchScheduleHiddenBrands(tab, client),
    fetchScheduleRestrictedBrands(tab, client),
    fetchScheduleBrandPauses(tab, client),
    fetchActiveBrandPlatformPauses(tab, client),
  ]);
  const dateStatusIndex = buildDateStatusIndex(entries);
  const removedPlatformBrandSet = buildRemovedPlatformBrandSet(removedPlatformBrandRows);
  // Whole-brand pauses merge into the same hiddenSet a fully-hidden brand
  // uses -- see scheduleBrandConfig.ts's file header and the paused-brands
  // design spec.
  const hiddenBrandSet = buildHiddenBrandSet([...hiddenBrandRows, ...pausedBrandRows]);
  const platformRestrictionMap = buildPlatformRestrictionMap(restrictedBrandRows);
  const tabPlatforms = getTabPlatforms(tab);

  const distinctWeeks = [...new Set(
    links.map((l) => weekdayAndWeekStartFor(l.date)?.weekStart).filter((w): w is string => w != null),
  )];
  const rowsPerWeek = await Promise.all(
    distinctWeeks.map((w) => fetchBrandSchedule(tab, w, client).catch(() => [] as BrandScheduleRow[])),
  );
  const manualPauseRows = rowsPerWeek.flat();

  const items: PmsStatusSyncItem[] = [];
  const cancelled: PmsCancelItem[] = [];
  const cancelFailed: { item: PmsCancelItem; error: string }[] = [];
  for (const link of links) {
    const allowedPlatforms = resolveBrandPlatforms(tab, link.brand, tabPlatforms, hiddenBrandSet, platformRestrictionMap, removedPlatformBrandSet);
    if (!allowedPlatforms.includes(link.platform)) continue;
    const loc = weekdayAndWeekStartFor(link.date);
    const autoPaused = pauses.some((p) => p.brand_key === link.brand_key && p.platform === link.platform && p.paused_week_start === loc?.weekStart);
    const dayStatus = loc != null ? (scheduleFor(manualPauseRows, tab, link.brand, loc.weekStart, link.platform)?.[loc.day] ?? null) : null;
    const manuallyPaused = dayStatus === 'paused';
    const isPaused = autoPaused || manuallyPaused;

    // A link whose day is genuinely blank in brand_schedule (not active, not
    // paused), with no real evidence backing it either, has nothing left to
    // sync -- most likely a cancelled slot whose client-side cleanup never
    // ran (a stale browser tab still on an older bundle, a network blip, a
    // closed page mid-click). Clean it up here instead of falling into
    // resolvePmsSyncStatus's 'active' fallback, which can't otherwise tell
    // "never scheduled" apart from "scheduled, then cancelled" -- this is
    // what makes cancellation self-healing the same way status moves already
    // are via this same cron. A day explicitly cycled to Paused (manuallyPaused)
    // is deliberately NOT treated as a cancellation here -- Paused and
    // Cancelled are two distinct, separately-actioned outcomes (see the new
    // per-cell Pause/Resume/Cancel buttons and schedule_cancellations table):
    // Paused always moves its card to Project Paused, same as an algorithmic
    // scheduler auto-pause; only an explicit Cancel (which writes the day back
    // to blank) deletes the card, via cancelScheduleInPms below/client-side.
    // Requires a parseable date (loc != null); an unparseable link.date falls
    // through to the normal resolve path below, unchanged from before this
    // check existed.
    if (loc != null && dayStatus == null && !isPaused && !hasDateEvidence(dateStatusIndex, link.brand_key, link.platform, link.date)) {
      const cancelItem: PmsCancelItem = { tab: link.tab, brand: link.brand, platform: link.platform, date: link.date };
      try {
        await deletePmsTask(link.pms_task_id, credentials, fetchFn);
        await deleteSchedulePmsLink(link.id, client);
        cancelled.push(cancelItem);
      } catch (err) {
        cancelFailed.push({ item: cancelItem, error: err instanceof Error ? err.message : String(err) });
      }
      continue;
    }

    const targetStatus = resolvePmsSyncStatus(link.brand_key, link.platform, link.date, dateStatusIndex, isPaused);
    if (targetStatus !== link.synced_status) {
      const detailsKey = `${link.brand_key}::${link.platform}::${link.date}`;
      const details = dateStatusIndex.details.get(detailsKey);
      const description = details ? buildTaskDescription(details) : undefined;
      items.push({ linkId: link.id, pmsTaskId: link.pms_task_id, targetStatus, tabLabel: tabDisplayName(link.tab), brand: link.brand, date: link.date, description });
    }
  }
  // Deliberately NOT currentWatermark (the separate, uncached
  // fetchTabEntriesWatermark query above) -- that value can be fresher than
  // what `entries` actually reflects, since fetchRawEntriesByTab's
  // fetchAllTabEntries caches a tab's full row list for up to 60s
  // (src/lib/queries.ts). Recording the separately-fetched fresher value
  // regardless of what data was actually processed was a real, live bug: a
  // resolve could compute against a stale cached snapshot, find nothing to
  // change, then permanently mark the freshest real change as "already
  // seen" without ever having synced it -- confirmed live 2026-08-27 (a
  // SilverPlay/Silver Play/AskGamblers entry sat Done for ~5.7 hours while
  // its PMS task stayed stuck in To Do; a full-board sweep afterward found
  // 35 of 290 links similarly stuck). Deriving the recorded watermark from
  // `entries`' own max updated_at instead means it can only ever record what
  // was truly processed -- at worst falling one tick behind (self-corrects
  // next resolve), never falsely claiming to be caught up.
  const actualEntriesWatermark = entries.reduce<string | null>(
    (max, e) => (max === null || e.updated_at > max ? e.updated_at : max),
    null,
  );
  // A partial failure (a status move OR a cancellation) must NOT record it,
  // so the next tick's watermark check still sees a mismatch and retries the
  // still-failing item(s) instead of silently skipping them forever.
  const recordWatermark = async (): Promise<void> => {
    if (actualEntriesWatermark !== null) {
      await upsertSyncWatermark(tab, actualEntriesWatermark, client).catch(() => {});
    }
  };

  if (items.length === 0) {
    if (cancelFailed.length === 0) await recordWatermark();
    return { synced: [], failed: [], cancelled, cancelFailed };
  }
  const result = await syncScheduleStatusToPms(items, client, credentials, fetchFn);
  if (result.failed.length === 0 && cancelFailed.length === 0) await recordWatermark();
  return { ...result, cancelled, cancelFailed };
}

export interface PmsDriftedItem {
  tab: string;
  brand: string;
  platform: Platform;
  oldDate: string;
  newDate: string;
}

export interface PmsDeletedItem {
  tab: string;
  brand: string;
  platform: Platform;
  date: string;
}

// Read-only display info only -- never written back to any dashboard data.
// assigneeName is the PMS task's current first assignee (this integration
// only ever sets one), or null if the task is unassigned in PMS. Reported
// against the link's CURRENT date (the post-drift-reconciliation date, if
// this same pull cycle just moved it), so the frontend can key it directly
// to whichever calendar cell it's about to render/move to.
export interface PmsAssigneeInfo {
  tab: string;
  brand: string;
  platform: Platform;
  date: string;
  assigneeName: string | null;
}

export interface PmsPullResult {
  drifted: PmsDriftedItem[];
  deleted: PmsDeletedItem[];
  assignees: PmsAssigneeInfo[];
}

interface PmsTaskListed {
  id: string;
  // Present on every real API response. syncScheduleStatusToPms's in-memory
  // cache synthesizes a partial title ("<tabLabel> | ") for a just-moved
  // task, where the real brand segment isn't known/needed --
  // computeGroupedInsertPosition only ever reads the tabLabel prefix back out.
  title: string;
  columnId: string;
  position: number;
  // Typed nullable even though the PMS API's normal shape always includes a
  // due date -- a task whose due date was cleared via a one-click PMS UI
  // action comes back with dueDate null/undefined at runtime. See the
  // liveDate guard below.
  dueDate: string | null | undefined;
  assignees: { user: { name: string } }[];
}

async function fetchPmsProjectTasks(credentials: PmsCredentials, fetchFn: typeof fetch): Promise<PmsTaskListed[]> {
  const res = await fetchFn(`${PMS_BASE_URL}/projects/${PMS_PROJECT_ID}/tasks`, { headers: pmsHeaders(credentials) });
  if (!res.ok) throw new Error(`PMS tasks fetch failed: ${res.status}`);
  return (await res.json()) as PmsTaskListed[];
}

export interface PmsCancelItem {
  tab: string;
  brand: string;
  platform: Platform;
  date: string;
}

export interface PmsCancelResult {
  deleted: PmsCancelItem[];
  // No linked PMS task for this exact combo -- nothing to cancel. Covers a
  // cell that was never activated (or never pushed, e.g. a legacy week) and
  // a cell whose task was already deleted by an earlier cancel/pull.
  skipped: PmsCancelItem[];
  failed: { item: PmsCancelItem; error: string }[];
}

// Confirmed live against the real "Forum Team" project (2026-08-27): DELETE
// /api/tasks/:id returns 204 and the task is gone. A 404 is treated as
// success too -- the goal state (task doesn't exist) is already achieved,
// most likely because a human already deleted it directly in the PMS UI --
// so cancelling from the dashboard still proceeds to clean up the link
// rather than leaving it stuck failing forever.
async function deletePmsTask(taskId: string, credentials: PmsCredentials, fetchFn: typeof fetch): Promise<void> {
  const res = await fetchFn(`${PMS_BASE_URL}/tasks/${taskId}`, { method: 'DELETE', headers: pmsHeaders(credentials) });
  if (!res.ok && res.status !== 404) throw new Error(`PMS task delete failed: ${res.status}`);
}

// A day cell cycled back to blank (Schedule Planner's active -> paused ->
// blank cycle) cancels its plan entirely -- this deletes the linked PMS
// task (if one exists) and its schedule_pms_links row, unconditionally,
// regardless of whether real evidence already backs that date (an explicit
// choice: cancelling is a direct, deliberate user action). Per-item
// try/catch mirrors pushScheduleToPms's existing batch resilience. A link
// delete failure after a successful task delete isn't specially handled --
// the next pullScheduleFromPms run for this tab will find the task gone and
// clean up the stale link itself, the same self-healing path an externally
// (PMS-UI) deleted task already goes through.
export async function cancelScheduleInPms(
  items: PmsCancelItem[],
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsCancelResult> {
  const deleted: PmsCancelItem[] = [];
  const skipped: PmsCancelItem[] = [];
  const failed: { item: PmsCancelItem; error: string }[] = [];
  if (items.length === 0) return { deleted, skipped, failed };

  const linksByTab = new Map<string, SchedulePmsLink[]>();
  for (const item of items) {
    try {
      const brandKey = normalizeBrandKey(item.brand);
      let links = linksByTab.get(item.tab);
      if (!links) {
        links = await fetchSchedulePmsLinks(item.tab, client);
        linksByTab.set(item.tab, links);
      }
      const link = links.find((l) => l.brand_key === brandKey && l.platform === item.platform && l.date === item.date);
      if (!link) {
        skipped.push(item);
        continue;
      }
      await deletePmsTask(link.pms_task_id, credentials, fetchFn);
      await deleteSchedulePmsLink(link.id, client);
      linksByTab.set(item.tab, links.filter((l) => l.id !== link.id));
      deleted.push(item);
    } catch (err) {
      failed.push({ item, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { deleted, skipped, failed };
}

// schedule_pms_links writes here (not brand_schedule) -- this table is the
// only thing the service-role Edge Function is allowed to touch under RLS.
// The caller (TabScheduleSection.tsx) is responsible for applying the
// resulting drift/deletion to brand_schedule itself, since that write goes
// through the normal approved-user RLS path, not the service role.
export async function pullScheduleFromPms(
  tab: string,
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsPullResult> {
  const drifted: PmsDriftedItem[] = [];
  const deleted: PmsDeletedItem[] = [];
  const assignees: PmsAssigneeInfo[] = [];

  const links = await fetchSchedulePmsLinks(tab, client);
  if (links.length === 0) return { drifted, deleted, assignees };

  const tasks = await fetchPmsProjectTasks(credentials, fetchFn);
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  for (const link of links) {
    const task = taskById.get(link.pms_task_id);
    if (!task) {
      await deleteSchedulePmsLink(link.id, client);
      deleted.push({ tab: link.tab, brand: link.brand, platform: link.platform, date: link.date });
      continue;
    }
    const assigneeName = task.assignees[0]?.user.name ?? null;
    // A cleared due date (a one-click action in the PMS UI) makes task.dueDate
    // null/undefined at runtime despite the interface typing it as string --
    // treat that as "nothing to reconcile for this link right now", not as
    // deleted, since a cleared date is a genuinely different, ambiguous state
    // from a task that no longer exists and shouldn't silently un-schedule a
    // real brand_schedule day. The assignee is still reported against the
    // link's existing date in this case, since there's no new date to move it to.
    const liveDate = task.dueDate?.slice(0, 10);
    if (!liveDate) {
      assignees.push({ tab: link.tab, brand: link.brand, platform: link.platform, date: link.date, assigneeName });
      continue;
    }
    if (liveDate !== link.date) {
      await updateSchedulePmsLinkDate(link.id, liveDate, client);
      drifted.push({ tab: link.tab, brand: link.brand, platform: link.platform, oldDate: link.date, newDate: liveDate });
    }
    assignees.push({ tab: link.tab, brand: link.brand, platform: link.platform, date: liveDate, assigneeName });
  }
  return { drifted, deleted, assignees };
}
