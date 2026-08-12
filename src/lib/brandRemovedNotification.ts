import { supabase, SUPABASE_ANON_KEY, NOTIFY_BRAND_REMOVED_URL } from './supabase';

export interface NotifyBrandRemovedPayload {
  brand: string;
  tabLabel: string;
  platformShortLabel: string;
  removedAtLabel: string;
}

const NOTIFICATION_FAILURE_MESSAGE = 'Failed to send the brand-removed notification email.';

// Best-effort — the caller (BrandGroup.tsx) already succeeded in writing the
// removed_platform_brands flag before calling this; a failure here must never
// be mistaken for the flag write itself failing.
export async function notifyBrandRemoved(payload: NotifyBrandRemovedPayload): Promise<void> {
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* fall back to anon key */
  }

  try {
    const res = await fetch(NOTIFY_BRAND_REMOVED_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(NOTIFICATION_FAILURE_MESSAGE);
  } catch (err) {
    if (err instanceof Error && err.message === NOTIFICATION_FAILURE_MESSAGE) {
      throw err;
    }
    throw new Error(NOTIFICATION_FAILURE_MESSAGE);
  }
}
