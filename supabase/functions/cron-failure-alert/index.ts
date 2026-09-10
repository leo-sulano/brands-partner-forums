// supabase/functions/cron-failure-alert/index.ts
// Runs every 15 minutes via the 'cron-failure-alert-check' pg_cron job
// (supabase/migrations/20260910120000_add_cron_failure_alerting.sql).
//
// pg_cron already logs every job's success/failure to cron.job_run_details,
// but nothing surfaced a failure until now -- a silently-failing job (e.g.
// generate-weekly-schedule-monday) would only be noticed when someone
// spotted a missing schedule or a stale PMS card. This calls the
// claim_new_cron_failures() RPC (SECURITY DEFINER, since cron.job_run_details
// isn't otherwise readable), which atomically returns every new failure
// since the last check and advances the per-job watermark in the same
// transaction, so a job stuck failing every tick alerts once, not every 15
// minutes forever.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sendToApprovedProfiles, type GmailCredentials } from '../_shared/gmail.ts';

function getEnvVars() {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') || '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    GMAIL_CLIENT_ID: Deno.env.get('GMAIL_CLIENT_ID') || '',
    GMAIL_CLIENT_SECRET: Deno.env.get('GMAIL_CLIENT_SECRET') || '',
    GMAIL_REFRESH_TOKEN: Deno.env.get('GMAIL_REFRESH_TOKEN') || '',
    GMAIL_SENDER_EMAIL: Deno.env.get('GMAIL_SENDER_EMAIL') || '',
  };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export interface CronFailure {
  jobname: string;
  runid: number;
  start_time: string;
  return_message: string | null;
}

export function buildAlertEmail(failures: CronFailure[]): { subject: string; text: string } {
  const jobNames = [...new Set(failures.map((f) => f.jobname))];
  const subject =
    jobNames.length === 1 ? `Cron job failure: ${jobNames[0]}` : `${jobNames.length} cron jobs failed`;
  const text = [
    'Dear Team,',
    '',
    'This is an automated alert from the Forums Dashboard.',
    '',
    `The following scheduled job${failures.length === 1 ? ' has' : 's have'} failed:`,
    '',
    ...failures.map(
      (f) => `- ${f.jobname} (run ${f.runid}, ${f.start_time}): ${f.return_message || 'no error message'}`,
    ),
    '',
    'Check the Supabase project (cron.job_run_details) for full detail.',
    '',
    'Thank you,',
    'Forums Dashboard',
  ].join('\n');
  return { subject, text };
}

export async function runCronFailureAlertCheck(
  client: SupabaseClient,
  credentials: GmailCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<{ alerted: boolean; failures: number; sent?: number; failed?: number }> {
  const { data, error } = await client.rpc('claim_new_cron_failures');
  if (error) throw error;
  const failures = (data ?? []) as CronFailure[];
  if (failures.length === 0) return { alerted: false, failures: 0 };

  const { subject, text } = buildAlertEmail(failures);
  const result = await sendToApprovedProfiles(client, credentials, subject, text, fetchFn);
  return { alerted: true, failures: failures.length, ...result };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!req.headers.get('authorization')) return jsonResponse({ error: 'Unauthorized' }, 401);

  const env = getEnvVars();
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN || !env.GMAIL_SENDER_EMAIL) {
    return jsonResponse({ error: 'Notifications not configured' }, 500);
  }

  try {
    const client = createClient(env.SUPABASE_URL, env.SERVICE_ROLE);
    const result = await runCronFailureAlertCheck(client, {
      clientId: env.GMAIL_CLIENT_ID,
      clientSecret: env.GMAIL_CLIENT_SECRET,
      refreshToken: env.GMAIL_REFRESH_TOKEN,
      senderEmail: env.GMAIL_SENDER_EMAIL,
    });
    return jsonResponse(result);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Cron failure alert check failed' }, 500);
  }
});
