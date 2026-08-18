import { supabase, SUPABASE_ANON_KEY, SYNC_SCHEDULE_PMS_URL } from './supabase';
import type { Platform } from './removedPlatformBrands';

// PmsSyncItem/PmsDriftedItem/PmsDeletedItem below are deliberately redeclared
// here rather than imported from src/lib/scheduler/pmsSync.ts -- that module
// is a server-side Deno file (imports @supabase/supabase-js server-side APIs
// and holds the PMS API token flow) never bundled for the browser. This file
// is the thin browser-side proxy that only calls the sync-schedule-pms Edge
// Function over HTTP and needs matching shapes for its own request/response
// typing, same "duplicate payload interface, kept in sync by hand" pattern
// notify-brand-removed's NotifyBrandRemovedPayload already uses for the same
// reason.
export interface PmsSyncItem {
  tab: string;
  tabLabel: string;
  brand: string;
  platform: Platform;
  date: string;
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

async function authHeaders(): Promise<Record<string, string>> {
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* fall back to anon key */
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY };
}

// Best-effort -- every caller has already written the real brand_schedule
// change before calling this; a PMS sync failure must never be mistaken for
// the schedule write itself failing. Callers catch and toast, never let a
// rejection here surface as if the click/generation itself failed.
export async function pushScheduleActivations(items: PmsSyncItem[]): Promise<void> {
  if (items.length === 0 || !SYNC_SCHEDULE_PMS_URL) return;
  const res = await fetch(SYNC_SCHEDULE_PMS_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'push', items }),
  });
  if (!res.ok) throw new Error('Failed to sync schedule to PMS.');
}

export async function pullScheduleDrift(tab: string): Promise<{ drifted: PmsDriftedItem[]; deleted: PmsDeletedItem[] }> {
  if (!SYNC_SCHEDULE_PMS_URL) return { drifted: [], deleted: [] };
  const res = await fetch(SYNC_SCHEDULE_PMS_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'pull', tab }),
  });
  if (!res.ok) throw new Error('Failed to pull PMS schedule updates.');
  return (await res.json()) as { drifted: PmsDriftedItem[]; deleted: PmsDeletedItem[] };
}
