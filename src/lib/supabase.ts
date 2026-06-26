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
export const CHECK_STATUS_URL = import.meta.env.VITE_CHECK_STATUS_URL ?? '';
// VITE_CHECK_STATUS_URL must end in /check-status (e.g. http://localhost:5001/check-status)
export const CHECK_STATUS_BASE_URL = CHECK_STATUS_URL.replace(/\/check-status$/, '');
// Shared secret for the self-hosted status server (behind a Cloudflare Tunnel).
// Protected by the Vercel password gate; its job is to stop strangers who find
// the tunnel URL from triggering Selenium runs. Falls back to the anon key so
// local dev against an open server still works.
export const CHECK_STATUS_TOKEN = import.meta.env.VITE_CHECK_STATUS_TOKEN ?? '';

// AI assistant Edge Function URL (gpt-4o-mini proxy). Set in Vercel env once the
// `ai-assistant` function is deployed. Empty string disables the assistant.
export const AI_ASSISTANT_URL = import.meta.env.VITE_AI_ASSISTANT_URL ?? '';
