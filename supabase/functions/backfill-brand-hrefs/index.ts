// One-time Edge Function: reads only the 'Brand / TP URL PAGE' hyperlink URLs
// from the Google Sheet and patches Brand / TP URL PAGE__href in Supabase entries.
// Does NOT run a full sync — all other entry data is left completely unchanged.
//
// Invoke once via:
//   supabase functions invoke backfill-brand-hrefs --no-verify-jwt

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (h: (r: Request) => Response | Promise<Response>) => void;
};

Deno.serve(async () => {
  const APPS_SCRIPT_URL = Deno.env.get('APPS_SCRIPT_URL')!;
  const SHARED_SECRET   = Deno.env.get('APPS_SCRIPT_SECRET')!;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. Ask Apps Script for brand hrefs only
  const asResp = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: SHARED_SECRET, op: 'brand_hrefs' }),
  });
  const asJson = await asResp.json();
  if (!asJson.ok) {
    return Response.json({ ok: false, error: asJson.error }, { status: 500 });
  }

  type HrefRow = { tab: string; sheet_row_id: string; href: string };
  const rows: HrefRow[] = asJson.rows ?? [];
  if (rows.length === 0) {
    return Response.json({ ok: true, message: 'No brand hrefs found in sheet', updated: 0 });
  }

  // 2. Group by tab so we can batch-fetch entries per tab
  const byTab = new Map<string, HrefRow[]>();
  for (const row of rows) {
    if (!byTab.has(row.tab)) byTab.set(row.tab, []);
    byTab.get(row.tab)!.push(row);
  }

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [tab, tabRows] of byTab) {
    const ids = tabRows.map((r) => r.sheet_row_id);
    const hrefMap = new Map(tabRows.map((r) => [r.sheet_row_id, r.href]));

    // Fetch only the entries we need for this tab
    const { data: entries, error: fetchErr } = await supabase
      .from('entries')
      .select('id, sheet_row_id, data')
      .eq('tab', tab)
      .in('sheet_row_id', ids);

    if (fetchErr) {
      errors.push(`fetch ${tab}: ${fetchErr.message}`);
      continue;
    }

    // Patch each entry — only Brand / TP URL PAGE__href is changed
    await Promise.all((entries ?? []).map(async (entry) => {
      const href = hrefMap.get(entry.sheet_row_id);
      if (!href) { skipped++; return; }

      const { error: updateErr } = await supabase
        .from('entries')
        .update({ data: { ...entry.data, 'Brand / TP URL PAGE__href': href } })
        .eq('id', entry.id);

      if (updateErr) errors.push(`update ${entry.id}: ${updateErr.message}`);
      else updated++;
    }));
  }

  return Response.json({
    ok: errors.length === 0,
    total_from_sheet: rows.length,
    updated,
    skipped,
    errors,
  });
});
