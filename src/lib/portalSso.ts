import { supabase } from './supabase';

const ERROR_MESSAGES: Record<string, string> = {
  sso: 'Single sign-on failed — the login link may be invalid or expired. Try again from the portal.',
  provision: 'Single sign-on failed — we could not set up your account. Contact an admin.',
  access: 'Single sign-on failed — we could not approve your account. Contact an admin.',
  session: 'Single sign-on failed — we could not start your session. Try again from the portal.',
};

const DEFAULT_MESSAGE = ERROR_MESSAGES.sso;

export function mapSsoErrorCode(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code]) || DEFAULT_MESSAGE;
}

interface SsoCallbackResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

export type PortalLoginResult = { ok: true } | { ok: false; message: string };

export async function completePortalLogin(token: string): Promise<PortalLoginResult> {
  const { data, error } = await supabase.functions.invoke<SsoCallbackResponse>('sso-callback', {
    body: { token },
  });
  if (error) return { ok: false, message: mapSsoErrorCode(undefined) };
  if (data?.error) return { ok: false, message: mapSsoErrorCode(data.error) };
  if (!data?.access_token || !data?.refresh_token) {
    return { ok: false, message: mapSsoErrorCode(undefined) };
  }

  const { error: sessionErr } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionErr) return { ok: false, message: mapSsoErrorCode('session') };

  return { ok: true };
}
