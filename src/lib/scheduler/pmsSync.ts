// Shared by two Deno consumers -- the browser-facing sync-schedule-pms Edge
// Function and the (not yet deployed) generate-weekly-schedule cron
// function -- plus nothing on the browser side directly, since the PMS API
// token never reaches the browser. Same "one src/lib module, multiple
// server-side consumers" shape schedulerService.ts itself already has.
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBrandKey, buildRemovedPlatformBrandSet, type Platform } from '../removedPlatformBrands.ts';
import { fetchSchedulePmsLinks, insertSchedulePmsLink, updateSchedulePmsLinkDate, updateSchedulePmsLinkStatus, deleteSchedulePmsLink, fetchRawEntriesByTab, fetchRemovedPlatformBrands, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, fetchActiveBrandPlatformPauses, fetchBrandSchedule, type SchedulePmsLink } from '../queries.ts';
import { buildDateStatusIndex, resolvePmsSyncStatus, type PmsSyncStatus } from './scheduleUtils.ts';
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
      await insertSchedulePmsLink(item.tab, item.brand, item.platform, item.date, task.id, client);
      // Reflect the just-created link back into this tab's in-memory `links`
      // array so a later item in the SAME batch that repeats this exact combo
      // (e.g. rapid re-cycling of one cell while a prior push is in flight)
      // sees it as already-linked via `alreadyLinked` above, instead of
      // attempting a second PMS task create that would then fail
      // insertSchedulePmsLink on the table's (tab, brand_key, platform, date)
      // unique constraint and leave an orphaned PMS task with no link at all.
      links.push({ id: '', tab: item.tab, brand: item.brand, brand_key: brandKey, platform: item.platform, date: item.date, pms_task_id: task.id, synced_status: 'active' });
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
// opening the dashboard. 'paused' (a scheduler auto-pause, a manual
// brand+platform override, or a single day cell manually cycled to Paused --
// resolvePmsSyncStatus's caller combines all three into one boolean) moves
// the task to the real "Project Paused" column instead, superseding the
// earlier design where a paused combo's task was simply left untouched.
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
  // tabLabel/date are the same values the task was created with (see
  // PmsSyncItem above) -- needed here so computeGroupedInsertPosition can
  // place the moved task among its actual due-date/brand-tab peers instead
  // of always landing at the top of the target column.
  tabLabel: string;
  date: string;
}

export interface PmsStatusSyncResult {
  synced: PmsStatusSyncItem[];
  failed: { item: PmsStatusSyncItem; error: string }[];
}

async function movePmsTask(taskId: string, columnId: string, position: number, credentials: PmsCredentials, fetchFn: typeof fetch): Promise<void> {
  const res = await fetchFn(`${PMS_BASE_URL}/tasks/${taskId}/move`, {
    method: 'PATCH',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ columnId, position }),
  });
  if (!res.ok) throw new Error(`PMS task move failed: ${res.status}`);
}

// A task's title is always "<tabLabel> | <brand>" (see createPmsTask above) --
// this pulls just the tabLabel back out so a card already sitting in a target
// column can be grouped against without needing its own PmsSyncItem.
function tabLabelFromTitle(title: string): string {
  const sep = title.indexOf(' | ');
  return sep === -1 ? title : title.slice(0, sep);
}

function dueDateSortKey(dueDate: string | null | undefined): string {
  return dueDate ? dueDate.slice(0, 10) : '';
}

// Confirmed live against the real "Forum Team" project (2026-08-27): each
// column holds a dense, zero-based `position` per task, and moving a task to
// position N there shifts every task at/after N down by one -- so computing
// "how many peers in the target column already sort at-or-before this item"
// and moving to that index reproduces a stable insertion sort, one move at a
// time. Grouping key is (due date, tab label) per an explicit user request:
// cards should read date-27 Hanan/Hanan/Hanan, date-27 BITP/BITP/BITP, not
// interleaved by whichever tab's status happened to change most recently.
// Ties (same date + tab) sort the new/moved item after its existing peers
// (`<=`), so it joins the tail of its own cluster instead of splitting it.
function computeGroupedInsertPosition(
  tasks: PmsTaskListed[],
  columnId: string,
  dueDate: string,
  tabLabel: string,
  excludeTaskId: string,
): number {
  const newKey = `${dueDateSortKey(dueDate)} ${tabLabel.toLowerCase()}`;
  return tasks.filter((t) => {
    if (t.columnId !== columnId || t.id === excludeTaskId) return false;
    const key = `${dueDateSortKey(t.dueDate)} ${tabLabelFromTitle(t.title).toLowerCase()}`;
    return key <= newKey;
  }).length;
}

// Moves each linked task's PMS column to match its resolved dashboard status
// (see resolvePmsSyncStatus in scheduleUtils.ts for how targetStatus is
// derived client-side) -- one-way, dashboard -> PMS only, never the reverse.
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
      const position = computeGroupedInsertPosition(tasks, columnId, item.date, item.tabLabel, item.pmsTaskId);
      await movePmsTask(item.pmsTaskId, columnId, position, credentials, fetchFn);
      await updateSchedulePmsLinkStatus(item.linkId, item.targetStatus, client);
      tasks = tasks.filter((t) => t.id !== item.pmsTaskId);
      tasks.push({ id: item.pmsTaskId, title: `${item.tabLabel} | `, columnId, position, dueDate: item.date, assignees: [] });
      synced.push(item);
    } catch (err) {
      failed.push({ item, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { synced, failed };
}

// The one place the full dashboard -> PMS status resolution rules are
// implemented (evidence precedence, pause exclusion, hidden/restricted/
// removed-platform exclusion) -- both the on-visit browser trigger and the
// 1-minute cron reach this same function over HTTP through
// sync-schedule-pms's syncAllStatuses action (see that Edge Function's
// index.ts), never a second independently-written copy of these rules.
// Mirrors what TabScheduleSection.tsx's status-sync effect used to compute
// inline before this extraction.
export async function resolveAndSyncTabStatuses(
  tab: string,
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsStatusSyncResult> {
  const links = await fetchSchedulePmsLinks(tab, client);
  if (links.length === 0) return { synced: [], failed: [] };

  const [entries, removedPlatformBrandRows, hiddenBrandRows, restrictedBrandRows, pauses] = await Promise.all([
    fetchRawEntriesByTab(tab, client),
    fetchRemovedPlatformBrands(client),
    fetchScheduleHiddenBrands(tab, client),
    fetchScheduleRestrictedBrands(tab, client),
    fetchActiveBrandPlatformPauses(tab, client),
  ]);
  const dateStatusIndex = buildDateStatusIndex(entries);
  const removedPlatformBrandSet = buildRemovedPlatformBrandSet(
    removedPlatformBrandRows as { tab: string; brand: string; platform: Platform }[],
  );
  const hiddenBrandSet = buildHiddenBrandSet(hiddenBrandRows);
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
  for (const link of links) {
    const allowedPlatforms = resolveBrandPlatforms(tab, link.brand, tabPlatforms, hiddenBrandSet, platformRestrictionMap, removedPlatformBrandSet);
    if (!allowedPlatforms.includes(link.platform)) continue;
    const loc = weekdayAndWeekStartFor(link.date);
    const autoPaused = pauses.some((p) => p.brand_key === link.brand_key && p.platform === link.platform && p.paused_week_start === loc?.weekStart);
    const manuallyPaused = loc != null && scheduleFor(manualPauseRows, tab, link.brand, loc.weekStart, link.platform)?.[loc.day] === 'paused';
    const isPaused = autoPaused || manuallyPaused;
    const targetStatus = resolvePmsSyncStatus(link.brand_key, link.platform, link.date, dateStatusIndex, isPaused);
    if (targetStatus !== link.synced_status) {
      items.push({ linkId: link.id, pmsTaskId: link.pms_task_id, targetStatus, tabLabel: tabDisplayName(tab), date: link.date });
    }
  }
  if (items.length === 0) return { synced: [], failed: [] };
  return syncScheduleStatusToPms(items, client, credentials, fetchFn);
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
