import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — check .env');
}

export const supabase = createClient(url ?? '', anonKey ?? '');

export const SUPABASE_ANON_KEY = anonKey ?? '';
export const PUSH_TO_SHEET_URL = import.meta.env.VITE_PUSH_TO_SHEET_URL ?? '';
export const IMPORT_TABS_URL = import.meta.env.VITE_IMPORT_TABS_URL ?? '';
// Alias used by queries.ts — points to the same import-tabs function URL
export const SYNC_FUNCTION_URL = IMPORT_TABS_URL;
