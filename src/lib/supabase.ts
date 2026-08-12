import { createClient } from '@supabase/supabase-js';

const url = import.meta.env?.VITE_SUPABASE_URL;
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — check .env');
}

// createClient throws if either argument is falsy (see
// @supabase/supabase-js's helpers.ts/SupabaseClient.ts) — fall back to
// harmless placeholder values so importing this module never crashes, e.g.
// from a Deno Edge Function, which has no import.meta.env and always hits
// this branch. Every caller outside the browser passes its own client
// explicitly (see queries.ts's injectable `client` parameter), so this
// placeholder client is constructed but never actually used.
export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-anon-key');

export const SUPABASE_ANON_KEY = anonKey ?? '';
export const CHECK_STATUS_URL = import.meta.env?.VITE_CHECK_STATUS_URL ?? '';
// VITE_CHECK_STATUS_URL must end in /check-status (e.g. http://localhost:5001/check-status)
export const CHECK_STATUS_BASE_URL = CHECK_STATUS_URL.replace(/\/check-status$/, '');
// Shared secret for the self-hosted status server (behind a Cloudflare Tunnel).
// Protected by the Vercel password gate; its job is to stop strangers who find
// the tunnel URL from triggering Selenium runs. Falls back to the anon key so
// local dev against an open server still works.
export const CHECK_STATUS_TOKEN = import.meta.env?.VITE_CHECK_STATUS_TOKEN ?? '';

// Separate local-PC server for AG/CG/WO checks — EC2's Singapore IP is geo-blocked
// by AskGamblers, so these must run from a residential IP.
// Set VITE_CHECK_AG_STATUS_URL to your local ngrok URL + /check-status.
// Falls back to CHECK_STATUS_URL so a single server still works in dev.
export const CHECK_AG_STATUS_URL = import.meta.env?.VITE_CHECK_AG_STATUS_URL || CHECK_STATUS_URL;
export const CHECK_AG_STATUS_BASE_URL = CHECK_AG_STATUS_URL.replace(/\/check-status$/, '');

// AI assistant Edge Function URL (gpt-4o-mini proxy). Set in Vercel env once the
// `ai-assistant` function is deployed. Empty string disables the assistant.
export const AI_ASSISTANT_URL = import.meta.env?.VITE_AI_ASSISTANT_URL ?? '';

// Translate-review Edge Function URL (gpt-4o-mini proxy). Set in Vercel env once the
// `translate-review` function is deployed. Empty string means the Translate button's
// click always fails with the standard "unable to translate" message.
export const TRANSLATE_REVIEW_URL = import.meta.env?.VITE_TRANSLATE_REVIEW_URL ?? '';

// notify-brand-removed Edge Function URL. Set in Vercel env once the
// notify-brand-removed function is deployed (also needs GMAIL_CLIENT_ID/
// GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN/GMAIL_SENDER_EMAIL set via
// `supabase secrets set ...`). Empty string means a newly-flagged
// "page removed" checkbox saves fine but the notification silently no-ops.
export const NOTIFY_BRAND_REMOVED_URL = import.meta.env?.VITE_NOTIFY_BRAND_REMOVED_URL ?? '';
