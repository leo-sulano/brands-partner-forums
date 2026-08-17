// Shared by two Deno consumers -- the browser-facing sync-schedule-pms Edge
// Function and the (not yet deployed) generate-weekly-schedule cron
// function -- plus nothing on the browser side directly, since the PMS API
// token never reaches the browser. Same "one src/lib module, multiple
// server-side consumers" shape schedulerService.ts itself already has.
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands.ts';
import { fetchSchedulePmsLinks, insertSchedulePmsLink, updateSchedulePmsLinkDate, deleteSchedulePmsLink, type SchedulePmsLink } from '../queries.ts';

// Confirmed live against the real "Forum Team" PMS project while writing
// this spec (a throwaway test label/task was created via these exact
// endpoints, verified, then deleted). Hardcoded, not env-configurable --
// this integration is 1:1 with one specific PMS project.
const PMS_BASE_URL = 'https://pms-nu-eight.vercel.app/api';
const PMS_PROJECT_ID = 'cmsoh1uvs000004l4fbdvqmir';
const PMS_TODO_COLUMN_ID = 'cmsoh1uxz000204l46gf88k3f';
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

function pmsHeaders(credentials: PmsCredentials): Record<string, string> {
  return { Authorization: `Bearer ${credentials.apiToken}`, 'Content-Type': 'application/json' };
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

async function setPmsTaskLabels(taskId: string, labelIds: string[], credentials: PmsCredentials, fetchFn: typeof fetch): Promise<void> {
  const res = await fetchFn(`${PMS_BASE_URL}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ labelIds }),
  });
  if (!res.ok) throw new Error(`PMS task label update failed: ${res.status}`);
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

      const task = await createPmsTask(`${item.tabLabel} | ${item.brand}`, item.date, credentials, fetchFn);
      await setPmsTaskLabels(task.id, [platformLabelId, clientLabelId], credentials, fetchFn);
      await insertSchedulePmsLink(item.tab, item.brand, item.platform, item.date, task.id, client);
      created.push(item);
    } catch (err) {
      failed.push({ item, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { created, skipped, failed };
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

export interface PmsPullResult {
  drifted: PmsDriftedItem[];
  deleted: PmsDeletedItem[];
}

interface PmsTaskListed {
  id: string;
  dueDate: string;
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

  const links = await fetchSchedulePmsLinks(tab, client);
  if (links.length === 0) return { drifted, deleted };

  const tasks = await fetchPmsProjectTasks(credentials, fetchFn);
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  for (const link of links) {
    const task = taskById.get(link.pms_task_id);
    if (!task) {
      await deleteSchedulePmsLink(link.id, client);
      deleted.push({ tab: link.tab, brand: link.brand, platform: link.platform, date: link.date });
      continue;
    }
    const liveDate = task.dueDate.slice(0, 10);
    if (liveDate !== link.date) {
      await updateSchedulePmsLinkDate(link.id, liveDate, client);
      drifted.push({ tab: link.tab, brand: link.brand, platform: link.platform, oldDate: link.date, newDate: liveDate });
    }
  }
  return { drifted, deleted };
}
