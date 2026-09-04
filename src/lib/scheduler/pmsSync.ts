// Shared by two Deno consumers -- the browser-facing sync-schedule-pms Edge
// Function and the (not yet deployed) generate-weekly-schedule cron
// function -- plus nothing on the browser side directly, since the PMS API
// token never reaches the browser. Same "one src/lib module, multiple
// server-side consumers" shape schedulerService.ts itself already has.
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBrandKey, platformRemovedKey, buildRemovedPlatformBrandSet, type Platform } from '../removedPlatformBrands.ts';
import { fetchSchedulePmsLinks, insertSchedulePmsLink, updateSchedulePmsLinkDate, updateSchedulePmsLinkStatus, updateSchedulePmsLinkColumn, deleteSchedulePmsLink, fetchRawEntriesByTab, fetchRemovedPlatformBrands, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, fetchActiveBrandPlatformPauses, fetchBrandSchedule, fetchApprovedScheduleWeeks, type SchedulePmsLink } from '../queries.ts';
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
// Confirmed live against the real "Forum Team" project (2026-09-03): a
// dedicated "Page Removed" column already exists there (position 6, after
// Project Paused) for exactly this case -- moveRemovedPageCards below parks a
// flagged combo's card here instead of deleting it.
const PMS_PAGE_REMOVED_COLUMN_ID = 'cmtl7ao36000004kypos6pxkt';
const PMS_TEAM_ID = 'cmsd98mtx000204lgyb0abodx';
const PMS_CLIENT_LABEL_NAME = 'Client';
const PMS_PLATFORM_LABEL_NAMES: Record<Platform, string> = { tp: 'TP', ag: 'AG', cg: 'CG', wo: 'WO' };
// Every existing platform label (TP/AG/CG) already has its own color; WO is
// the one platform with no label yet in the live project, auto-created the
// first time a WO item needs tagging.
const WO_LABEL_COLOR = 'blue';

// A brand+platform whose review page is flagged removed (removed_platform_brands)
// no longer exists on any Schedule Planner surface. A linked PMS card for it
// still sitting in one of these not-yet-settled columns (confirmed live
// against the real "Forum Team" project's own columns response) represents
// planned/in-flight work that will now never happen, and moveRemovedPageCards
// below parks it in the dedicated Page Removed column instead. Done, Project
// Paused, Page Removed itself, and any other column (including the unmanaged
// "BIT | BIF | FTP" column) are left alone -- a card there is either settled
// history, already parked, or a deliberate human placement.
const PMS_IN_PROGRESS_COLUMN_ID = 'cmsoh1uxz000304l4zynwy7vw';
const PMS_BLOCKED_COLUMN_ID = 'cmsoh1uxz000504l46ytlrxes';
const PMS_REMOVED_PAGE_MOVABLE_COLUMN_IDS = new Set<string>([
  PMS_TODO_COLUMN_ID,
  PMS_IN_PROGRESS_COLUMN_ID,
  PMS_BLOCKED_COLUMN_ID,
]);

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

  // Weekly approval gate: a slot's (tab, week_start) must be an approved week
  // before its task is allowed onto the PMS board. Un-approved items are
  // recorded as `skipped` here and never touch the PMS API. They get pushed
  // when an admin approves that week, which re-runs this same push over the
  // week's active slots -- idempotent via schedule_pms_links. See
  // docs/superpowers/specs/2026-09-03-weekly-schedule-approval-gate-design.md.
  const approvedWeekSet = await fetchApprovedScheduleWeeks(
    [...new Set(items.map((i) => i.tab))],
    client,
  );
  const gatedItems: PmsSyncItem[] = [];
  for (const item of items) {
    const weekStart = weekdayAndWeekStartFor(item.date)?.weekStart;
    if (weekStart && approvedWeekSet.has(`${item.tab}::${weekStart}`)) {
      gatedItems.push(item);
    } else {
      skipped.push(item);
    }
  }
  if (gatedItems.length === 0) return { created, skipped, failed };

  const linksByTab = new Map<string, SchedulePmsLink[]>();
  let labelCache: PmsLabel[] | null = null;
  let teamMembers: PmsTeamMember[] | null = null;

  for (const item of gatedItems) {
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
// unchanged so its own tests/callers are untouched) adding two distinct
// self-healing outcomes: cancelled/cancelFailed for a day cycled back to
// blank with no evidence (the linked PMS task+link are deleted outright, see
// the inline block inside resolveAndSyncTabStatuses below) -- mirroring
// PmsCancelResult's own deleted/failed shape (see cancelScheduleInPms further
// below) -- and pageRemoved/pageRemovedFailed for a combo whose review page
// is flagged removed (the card is moved to the Page Removed column, see
// moveRemovedPageCards; task and link are both kept). Deliberately not
// merged into one bucket: only the former actually deletes anything.
export interface PmsResolveResult extends PmsStatusSyncResult {
  cancelled: PmsCancelItem[];
  cancelFailed: { item: PmsCancelItem; error: string }[];
  pageRemoved: PmsCancelItem[];
  pageRemovedFailed: { item: PmsCancelItem; error: string }[];
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

// DESCENDING by due date -- the newest work sorts to the TOP of a column.
// The PMS UI renders only a capped slice of each column from the top (~200
// cards), so with the old ascending order every recently-completed slot sank
// past the cap and became invisible; newest-first keeps today's work on
// screen and lets the oldest history fall off the bottom instead. The date is
// inverted by nine's-complementing each digit of YYYY-MM-DD, so plain string
// comparison still orders it and a later date yields a smaller key; the
// dashes are left as-is. A card with no due date (a manually-created oddball)
// sorts last, not first.
function dueDateSortKey(dueDate: string | null | undefined): string {
  const d = dueDate ? dueDate.slice(0, 10) : '';
  if (!d) return '99999999';
  return d.replace(/\d/g, (c) => String(9 - Number(c)));
}

// Shared grouping key -- (due date DESC, tab label ASC, brand ASC) -- used
// both by computeGroupedInsertPosition (a single moved/created card) and
// computeColumnSortMoves (a full-column re-sort) below, so a card placed by
// one is never immediately re-shuffled by the other. Only the date direction
// is reversed (see dueDateSortKey); within one date a day's cluster still
// reads BITP/BrandA, BITP/BrandB in tab+brand order, per an explicit user
// request, not left in whatever order they happened to already be in.
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

// Moves linked PMS cards for any brand+platform whose review page is flagged
// removed (removed_platform_brands) into the dedicated Page Removed column --
// but only when the card is still sitting in a not-yet-settled column (To Do
// / In Progress / Blocked, see PMS_REMOVED_PAGE_MOVABLE_COLUMN_IDS above). A
// card already Done, Project Paused, already in Page Removed, or anywhere
// else is left untouched -- the combo is gone from every Schedule Planner
// surface either way, so a plan-only/in-flight card for it just needs to be
// parked somewhere visibly distinct from active work, while a settled card is
// history worth keeping exactly where it is.
//
// Per an explicit user request (2026-09-03), this supersedes the earlier
// delete-outright behavior: both the PMS task and its schedule_pms_links row
// are kept. Deleting either would leave a later un-flag (the page comes back)
// with nothing to reactivate, and would risk pushScheduleToPms creating a
// duplicate task for the same combo. Neither the link's synced_status nor
// synced_column_id is written here, deliberately -- resolveBrandPlatforms
// already excludes a flagged combo from the normal per-link resolve loop
// below regardless of this move, so those columns stay whatever they were
// before the flag was set, which is exactly what keeps enforcePmsColumns'
// "synced_column_id === want" drift check treating this as an
// already-intentional placement instead of fighting to move the card back.
//
// One GET /tasks for the whole tab (skipped entirely when nothing is
// flagged); a move only per card actually parked. A task-list fetch failure
// degrades to a no-op for this pass (retried on the next tick/visit, same
// spirit as syncScheduleStatusToPms's own ungrouped-position fallback); a
// per-card move failure is isolated into moveFailed, same batch resilience as
// the rest of this module. Returns the ids of links it moved so the caller
// can exclude them from its own resolve loop this same tick -- a just-parked
// combo has nothing left to resolve/pause for it this pass (it would be
// filtered out via resolveBrandPlatforms regardless, this is purely an
// optimization to skip the redundant per-link work below).
async function moveRemovedPageCards(
  links: SchedulePmsLink[],
  removedPlatformBrandSet: Set<string>,
  credentials: PmsCredentials,
  fetchFn: typeof fetch,
): Promise<{ movedLinkIds: Set<string>; moved: PmsCancelItem[]; moveFailed: { item: PmsCancelItem; error: string }[] }> {
  const movedLinkIds = new Set<string>();
  const moved: PmsCancelItem[] = [];
  const moveFailed: { item: PmsCancelItem; error: string }[] = [];

  const flagged = links.filter((l) => removedPlatformBrandSet.has(platformRemovedKey(l.tab, l.brand, l.platform)));
  if (flagged.length === 0) return { movedLinkIds, moved, moveFailed };

  let tasks: PmsTaskListed[];
  try {
    tasks = await fetchPmsProjectTasks(credentials, fetchFn);
  } catch {
    return { movedLinkIds, moved, moveFailed };
  }

  for (const link of flagged) {
    const task = tasks.find((t) => t.id === link.pms_task_id);
    if (!task || !PMS_REMOVED_PAGE_MOVABLE_COLUMN_IDS.has(task.columnId)) continue;
    const item: PmsCancelItem = { tab: link.tab, brand: link.brand, platform: link.platform, date: link.date };
    try {
      const tabLabel = tabDisplayName(link.tab);
      const position = computeGroupedInsertPosition(tasks, PMS_PAGE_REMOVED_COLUMN_ID, link.date, tabLabel, link.brand, link.pms_task_id);
      await movePmsTask(link.pms_task_id, PMS_PAGE_REMOVED_COLUMN_ID, position, credentials, fetchFn);
      tasks = tasks.filter((t) => t.id !== link.pms_task_id);
      tasks.push({ id: link.pms_task_id, title: `${tabLabel} | ${link.brand}`, columnId: PMS_PAGE_REMOVED_COLUMN_ID, position, dueDate: link.date, assignees: [] });
      movedLinkIds.add(link.id);
      moved.push(item);
    } catch (err) {
      moveFailed.push({ item, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { movedLinkIds, moved, moveFailed };
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
// No watermark short-circuit: an earlier version of this function skipped
// the whole resolve when a cached "entries.updated_at hasn't moved since the
// last successful sync" watermark matched, to avoid a full
// fetchRawEntriesByTab pull (some tabs 1,700+ rows of heavy jsonb) every
// single minute. That optimization was removed (see docs/task-history.md)
// after it repeatedly and unpredictably marked a tab "already caught up"
// when a link had, in fact, never been synced -- five distinct, independently
// root-caused mechanisms over several weeks (Tasks 287, 288, 302, and one
// more the same day the last of those shipped its own dedicated daily
// force-audit safety net), each leaving some link's synced_status silently
// stuck until a human noticed and manually cleared the watermark. Given how
// small every tracked tab actually is (well under the 1,000-row page size
// that would need pagination), the DB cost of a full resolve every tick is
// negligible next to the reliability cost of a caching layer that kept
// finding new ways to lie. Every tick now does a full, honest resolve.
export async function resolveAndSyncTabStatuses(
  tab: string,
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
  isTabPaused = false,
): Promise<PmsResolveResult> {
  const links = await fetchSchedulePmsLinks(tab, client);
  if (links.length === 0) return { synced: [], failed: [], cancelled: [], cancelFailed: [], pageRemoved: [], pageRemovedFailed: [] };

  // Fetched once here (rather than inside each branch below, as before) so
  // moveRemovedPageCards can run ahead of the paused/normal split and both
  // branches can reuse the same set with no second fetch.
  const removedPlatformBrandRows = await fetchRemovedPlatformBrands(client);
  const removedPlatformBrandSet = buildRemovedPlatformBrandSet(removedPlatformBrandRows);

  // Park any linked card for a now-removed-page combo before either branch
  // below ever considers it -- see moveRemovedPageCards for exactly which
  // cards that moves. A parked link is excluded from the rest of this
  // resolve entirely (nothing left to move/cancel/pause for it this tick);
  // the move outcome is folded into whichever branch's own
  // pageRemoved/pageRemovedFailed result below.
  const parked = await moveRemovedPageCards(links, removedPlatformBrandSet, credentials, fetchFn);
  const liveLinks = parked.movedLinkIds.size > 0 ? links.filter((l) => !parked.movedLinkIds.has(l.id)) : links;

  // Whole-Brand-Tab pause (paused_tabs, see pausedTabRegistry.ts) forces every
  // still-eligible link straight to 'paused', bypassing the
  // cancellation-detection block (a paused tab's held slots are deliberately
  // parked, not stale). The hidden/restricted/removed-platform-brand
  // eligibility filter still applies -- an already-excluded combo is left
  // alone here too, so it isn't force-paused and then stuck unable to resolve
  // back out once the tab unpauses (that combo was already excluded from the
  // normal resolve path below, for the same reason). PMS-side only: this
  // never touches brand_schedule -- the calendar itself is unaffected by a
  // tab pause, per the feature's design.
  if (isTabPaused) {
    const [hiddenBrandRows, restrictedBrandRows] = await Promise.all([
      fetchScheduleHiddenBrands(tab, client),
      fetchScheduleRestrictedBrands(tab, client),
    ]);
    const hiddenBrandSet = buildHiddenBrandSet(hiddenBrandRows);
    const platformRestrictionMap = buildPlatformRestrictionMap(restrictedBrandRows);
    const tabPlatforms = getTabPlatforms(tab);

    const items: PmsStatusSyncItem[] = [];
    for (const link of liveLinks) {
      if (link.synced_status === 'paused') continue;
      const allowedPlatforms = resolveBrandPlatforms(tab, link.brand, tabPlatforms, hiddenBrandSet, platformRestrictionMap, removedPlatformBrandSet);
      if (!allowedPlatforms.includes(link.platform)) continue;
      items.push({ linkId: link.id, pmsTaskId: link.pms_task_id, targetStatus: 'paused', tabLabel: tabDisplayName(link.tab), brand: link.brand, date: link.date });
    }
    if (items.length === 0) return { synced: [], failed: [], cancelled: [], cancelFailed: [], pageRemoved: parked.moved, pageRemovedFailed: parked.moveFailed };
    const result = await syncScheduleStatusToPms(items, client, credentials, fetchFn);
    return { ...result, cancelled: [], cancelFailed: [], pageRemoved: parked.moved, pageRemovedFailed: parked.moveFailed };
  }

  const [entries, hiddenBrandRows, restrictedBrandRows, pauses] = await Promise.all([
    fetchRawEntriesByTab(tab, client),
    fetchScheduleHiddenBrands(tab, client),
    fetchScheduleRestrictedBrands(tab, client),
    fetchActiveBrandPlatformPauses(tab, client),
  ]);
  const dateStatusIndex = buildDateStatusIndex(entries);
  const hiddenBrandSet = buildHiddenBrandSet(hiddenBrandRows);
  const platformRestrictionMap = buildPlatformRestrictionMap(restrictedBrandRows);
  const tabPlatforms = getTabPlatforms(tab);

  const distinctWeeks = [...new Set(
    liveLinks.map((l) => weekdayAndWeekStartFor(l.date)?.weekStart).filter((w): w is string => w != null),
  )];
  // Deliberately NOT `.catch(() => [])`'d: a transient brand_schedule fetch
  // failure must abort this tab's whole resolve for this tick (it retries on
  // the next 1-minute run) rather than be silently swallowed into an empty
  // week. An empty week here makes every non-evidenced, non-paused link in it
  // read as a blank day, and the cancellation branch below would then DELETE
  // its PMS card + schedule_pms_links row irreversibly -- one swallowed error
  // = mass card loss for that week, with nothing server-side to recreate it.
  // Same "fail loud, never a silent destructive no-op" rule as enforcePmsColumns
  // (Task 279).
  const rowsPerWeek: BrandScheduleRow[][] = await Promise.all(
    distinctWeeks.map((w) => fetchBrandSchedule(tab, w, client)),
  );
  // Weeks we actually got schedule rows back for. A week that came back
  // genuinely empty (rows not generated yet, or a mid-regeneration window) is
  // NOT treated as "every slot cancelled" -- the cancellation branch is
  // skipped for its links, which then resolve normally (an active plan slot
  // stays a To Do card, recoverable) instead of being torn down.
  const weeksWithScheduleRows = new Set(
    distinctWeeks.filter((_, i) => rowsPerWeek[i].length > 0),
  );
  const manualPauseRows = rowsPerWeek.flat();

  const items: PmsStatusSyncItem[] = [];
  const cancelled: PmsCancelItem[] = [];
  const cancelFailed: { item: PmsCancelItem; error: string }[] = [];
  for (const link of liveLinks) {
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
    // check existed. Also requires the link's week to have actually returned
    // brand_schedule rows (weeksWithScheduleRows) -- a blank day is only a
    // real cancellation signal when the rest of that week's schedule is
    // present to compare against; an entirely-empty week is a fetch/regen
    // artifact, not "every slot cancelled".
    if (loc != null && weeksWithScheduleRows.has(loc.weekStart) && dayStatus == null && !isPaused && !hasDateEvidence(dateStatusIndex, link.brand_key, link.platform, link.date)) {
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

  if (items.length === 0) {
    return { synced: [], failed: [], cancelled, cancelFailed, pageRemoved: parked.moved, pageRemovedFailed: parked.moveFailed };
  }
  const result = await syncScheduleStatusToPms(items, client, credentials, fetchFn);
  return { ...result, cancelled, cancelFailed, pageRemoved: parked.moved, pageRemovedFailed: parked.moveFailed };
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
