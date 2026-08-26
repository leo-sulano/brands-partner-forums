// supabase/functions/ai-assistant/tools_test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  pick,
  parseScore,
  mapEntrySummary,
  entryMatches,
  matchesStatus,
  scoreSummary,
  performanceReport,
  redactSensitive,
  runTool,
  successRateByField,
  ratingLabel,
  normalizeBrandKey,
  platformRemovedKey,
  buildRemovedPlatformBrandSet,
  buildArchivedTabNameSet,
  buildPausedTabNameSet,
  isSensitiveField,
  collectFieldNames,
  matchesFieldFilters,
  groupByField,
  reviewTextsByStatus,
  resolveAgentLabels,
  parsePostDate,
  passesPlatformDateFilter,
  EntryRow,
} from './tools.ts';

Deno.test('pick falls through key variants and skips blanks', () => {
  assertEquals(pick({ 'Brand': '', 'Brands': 'Acme' }, ['Brand', 'Brands']), 'Acme');
  assertEquals(pick({}, ['Brand']), null);
});

Deno.test('pick treats a whitespace-only value as present, not blank (matches src/lib/scoreSummary.ts pick(), no trim)', () => {
  assertEquals(pick({ 'Brand': ' ', 'Brands': 'Acme' }, ['Brand', 'Brands']), ' ');
});

Deno.test('parseScore accepts 1-5 only', () => {
  assertEquals(parseScore('4'), 4);
  assertEquals(parseScore('0'), null);
  assertEquals(parseScore('x'), null);
});

Deno.test('entryMatches is case-insensitive across values', () => {
  const e = { id: '1', tab: 't', data: { note: 'Big WIN here' } };
  assertEquals(entryMatches(e, 'win'), true);
  assertEquals(entryMatches(e, 'loss'), false);
});

Deno.test('matchesStatus compares normalized status', () => {
  const e = { id: '1', tab: 't', data: { 'Review Status': 'Published' } };
  assertEquals(matchesStatus(e, 'published'), true);
  assertEquals(matchesStatus(e, 'removed'), false);
});

Deno.test('scoreSummary counts Published only', () => {
  const entries = [
    { id: '1', tab: 't', data: { Brand: 'A', 'Review Status': 'Published', 'Score added': '5' } },
    { id: '2', tab: 't', data: { Brand: 'A', 'Review Status': 'Removed', 'Score added': '1' } },
  ];
  const out = scoreSummary(entries).brands;
  assertEquals(out.length, 1);
  assertEquals(out[0].rated, 1);
  assertEquals(out[0].average, 5);
});

Deno.test('mapEntrySummary surfaces key fields', () => {
  const row = mapEntrySummary({
    id: 'x',
    tab: 'Rooster',
    data: { Brands: 'Acme', 'Account Name': 'acc1', 'Review Status': 'Published' },
  });
  assertEquals(row.brand, 'Acme');
  assertEquals(row.account, 'acc1');
  assertEquals(row.status, 'Published');
});

Deno.test('redactSensitive strips all 6 known credential keys, keeps everything else', () => {
  const input = {
    Account: '123',
    Password: 'hunter2',
    'AG Password': 'agpass',
    'CG Password': 'cgpass',
    'Casino Password': 'casinopass',
    'Backup Codes': 'codes',
    'Authenticator Backup': 'authbackup',
    'Proxy Used': 'Enigma',
    Country: '',
  };
  const out = redactSensitive(input);
  assertEquals(out.Account, '123');
  assertEquals(out['Proxy Used'], 'Enigma');
  assertEquals(out.Country, '');
  assertEquals('Password' in out, false);
  assertEquals('AG Password' in out, false);
  assertEquals('CG Password' in out, false);
  assertEquals('Casino Password' in out, false);
  assertEquals('Backup Codes' in out, false);
  assertEquals('Authenticator Backup' in out, false);
});

Deno.test('redactSensitive strips credential keys with different case or trailing whitespace', () => {
  const input = {
    Account: '123',
    'password ': 'hunter2', // trailing space
    PASSWORD: 'hunter3', // different case (would collide with above key in an object but test separately below)
  };
  const out = redactSensitive(input);
  assertEquals(out.Account, '123');
  assertEquals('password ' in out, false);
  assertEquals('PASSWORD' in out, false);

  const input2 = { 'AG Password ': 'agpass', 'cg password': 'cgpass', Account: 'x' };
  const out2 = redactSensitive(input2);
  assertEquals(out2.Account, 'x');
  assertEquals('AG Password ' in out2, false);
  assertEquals('cg password' in out2, false);
});

Deno.test('parsePostDate accepts YYYY-MM-DD', () => {
  const d = parsePostDate('2026-05-11');
  assertEquals(d?.getFullYear(), 2026);
  assertEquals(d?.getMonth(), 4);
  assertEquals(d?.getDate(), 11);
});

Deno.test('parsePostDate accepts DD/MM/YYYY (sheet format)', () => {
  const d = parsePostDate('11/05/2026');
  assertEquals(d?.getFullYear(), 2026);
  assertEquals(d?.getMonth(), 4);
  assertEquals(d?.getDate(), 11);
});

Deno.test('parsePostDate rejects an invalid or empty value', () => {
  assertEquals(parsePostDate('not a date'), null);
  assertEquals(parsePostDate(''), null);
  assertEquals(parsePostDate(null), null);
  assertEquals(parsePostDate(undefined), null);
});

Deno.test('passesPlatformDateFilter with no bounds is always true', () => {
  assertEquals(passesPlatformDateFilter({ 'Trust Pilot': '2026-05-11' }, 'tp'), true);
  assertEquals(passesPlatformDateFilter({}, 'tp'), true);
});

Deno.test('passesPlatformDateFilter includes a row with no date for the platform (undated bias, never excluded by a range)', () => {
  assertEquals(passesPlatformDateFilter({}, 'tp', '2026-05-01', '2026-05-31'), true);
  assertEquals(passesPlatformDateFilter({ 'Trust Pilot': 'garbage' }, 'tp', '2026-05-01', '2026-05-31'), true);
});

Deno.test('passesPlatformDateFilter includes a dated row inside the range, excludes one outside it', () => {
  const data = { 'Trust Pilot': '2026-05-15' };
  assertEquals(passesPlatformDateFilter(data, 'tp', '2026-05-01', '2026-05-31'), true);
  assertEquals(passesPlatformDateFilter(data, 'tp', '2026-06-01', '2026-06-30'), false);
});

Deno.test('passesPlatformDateFilter bounds are inclusive at day granularity', () => {
  assertEquals(passesPlatformDateFilter({ 'Trust Pilot': '2026-05-01' }, 'tp', '2026-05-01', '2026-05-31'), true);
  assertEquals(passesPlatformDateFilter({ 'Trust Pilot': '2026-05-31' }, 'tp', '2026-05-01', '2026-05-31'), true);
});

Deno.test('passesPlatformDateFilter checks the requested platform\'s own date column, not another platform\'s', () => {
  const data = { 'Ask Gambler review added': '2026-05-15' }; // no 'Trust Pilot' key at all
  assertEquals(passesPlatformDateFilter(data, 'tp', '2026-06-01', '2026-06-30'), true); // undated for tp -> always true
  assertEquals(passesPlatformDateFilter(data, 'ag', '2026-06-01', '2026-06-30'), false); // dated for ag, out of range
});

Deno.test('passesPlatformDateFilter supports an open-ended range (only from, or only to)', () => {
  const data = { 'Trust Pilot': '2026-05-15' };
  assertEquals(passesPlatformDateFilter(data, 'tp', '2026-05-01', undefined), true);
  assertEquals(passesPlatformDateFilter(data, 'tp', '2026-06-01', undefined), false);
  assertEquals(passesPlatformDateFilter(data, 'tp', undefined, '2026-05-31'), true);
  assertEquals(passesPlatformDateFilter(data, 'tp', undefined, '2026-04-30'), false);
});

// Single-table mock: `rows` back the `entries` table only. Any other table
// (e.g. `tab_archive_log`, queried by query_entries' archived-tab exclusion)
// returns empty — these tests aren't exercising archive/removal state.
function mockSupabase(rows: EntryRow[]) {
  return {
    from(table: string) {
      let filtered = table === 'entries' ? rows : [];
      const builder: any = {
        select(_cols: string) {
          return builder;
        },
        eq(key: string, value: string) {
          filtered = filtered.filter((r: any) =>
            key === 'tab' ? r.tab === value : r.id === value
          );
          return builder;
        },
        in(key: string, values: string[]) {
          filtered = filtered.filter((r: any) => values.includes(r[key]));
          return builder;
        },
        order(_col: string) {
          return builder;
        },
        limit(n: number) {
          filtered = filtered.slice(0, n);
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: filtered[0] ?? null, error: null });
        },
        then(resolve: any) {
          resolve({ data: filtered, error: null });
        },
      };
      return builder;
    },
  };
}

// Like mockSupabase, but supports multiple tables — needed once a tool queries
// both `entries` and `removed_platform_brands` in the same call.
function mockSupabaseTables(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let filtered = tables[table] ?? [];
      const builder: any = {
        select(_cols: string) {
          return builder;
        },
        eq(key: string, value: string) {
          filtered = filtered.filter((r: any) => r[key] === value);
          return builder;
        },
        in(key: string, values: string[]) {
          filtered = filtered.filter((r: any) => values.includes(r[key]));
          return builder;
        },
        order(_col: string) {
          return builder;
        },
        limit(n: number) {
          filtered = filtered.slice(0, n);
          return builder;
        },
        then(resolve: any) {
          resolve({ data: filtered, error: null });
        },
      };
      return builder;
    },
  };
}

Deno.test('get_entry never returns a credential key even when the row has one', async () => {
  const rows: EntryRow[] = [
    { id: 'e1', tab: 'TP Brand Injection', data: { Account: '1', Password: 'hunter2' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'get_entry', { id: 'e1' });
  const json = JSON.stringify(result);
  assertEquals(json.includes('hunter2'), false);
  assertEquals(json.includes('Password'), false);
  assertEquals(result.data.Account, '1');
});

Deno.test('query_entries never returns a credential key even when a row has one', async () => {
  const rows: EntryRow[] = [
    { id: 'e1', tab: 'TP Brand Injection', data: { Account: '1', 'Backup Codes': 'secretcodes' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {});
  const json = JSON.stringify(result);
  assertEquals(json.includes('secretcodes'), false);
  assertEquals(json.includes('Backup Codes'), false);
  assertEquals(result.rows[0].data.Account, '1');
});

Deno.test('successRateByField computes live/removed rate per proxy value', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
    { id: '2', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Live' } },
    { id: '3', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Removed' } },
    { id: '4', tab: 't', data: { 'Proxy Used': 'OtherProxy', 'Review Status': 'Refused' } },
  ];
  const out = successRateByField(entries, 'proxy');
  const enigma = out.find((r) => r.value === 'Enigma')!;
  assertEquals(enigma.live, 2);
  assertEquals(enigma.removed, 1);
  assertEquals(enigma.total, 3);
  assertEquals(Math.round(enigma.rate!), 67);
});

Deno.test('successRateByField excludes rows with an undecided status from live/removed counts', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'X', 'Review Status': 'Pending' } },
    { id: '2', tab: 't', data: { 'Proxy Used': 'X', 'Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'proxy');
  const x = out.find((r) => r.value === 'X')!;
  assertEquals(x.live, 1);
  assertEquals(x.removed, 0);
  assertEquals(x.total, 1);
});

Deno.test('successRateByField skips rows with no value for the requested field', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 'TabWithNoAgent', data: { 'Review Status': 'Published' } },
    { id: '2', tab: 't', data: { Agent: 'ANN', 'Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'agent');
  assertEquals(out.length, 1);
  assertEquals(out[0].value, 'ANN');
});

Deno.test('successRateByField buckets blank and redacted proxy values under "No Proxy"', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': '', 'Review Status': 'Published' } },
    { id: '2', tab: 't', data: { 'Proxy Used': '*****', 'Review Status': 'Removed' } },
    { id: '3', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'proxy');
  const noProxy = out.find((r) => r.value === 'No Proxy')!;
  assertEquals(noProxy.live, 1);
  assertEquals(noProxy.removed, 1);
  assertEquals(noProxy.total, 2);
  const enigma = out.find((r) => r.value === 'Enigma')!;
  assertEquals(enigma.live, 1);
  assertEquals(enigma.total, 1);
});

Deno.test('successRateByField merges case-variant proxy values into one bucket (case-insensitive, matching dashboard grouping)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
    { id: '2', tab: 't', data: { 'Proxy Used': 'enigma', 'Review Status': 'Live' } },
    { id: '3', tab: 't', data: { 'Proxy Used': 'ENIGMA', 'Review Status': 'Removed' } },
  ];
  const out = successRateByField(entries, 'proxy');
  assertEquals(out.length, 1);
  assertEquals(out[0].live, 2);
  assertEquals(out[0].removed, 1);
});

Deno.test('successRateByField sorts best rate first, zero-total last', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Country: 'A', 'Review Status': 'Removed' } },
    { id: '2', tab: 't', data: { Country: 'B', 'Review Status': 'Published' } },
    { id: '3', tab: 't', data: { Country: 'C', 'Review Status': 'Pending' } },
  ];
  const out = successRateByField(entries, 'country');
  assertEquals(out.map((r) => r.value), ['B', 'A', 'C']);
});

Deno.test('successRateByField picks up WoO Review Status (Wizard of Odds tabs)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 'Wizard of Odds', data: { Agent: 'ANN', 'WoO Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'agent', ['wo']);
  const ann = out.find((r) => r.value === 'ANN')!;
  assertEquals(ann.live, 1);
  assertEquals(ann.removed, 0);
  assertEquals(ann.total, 1);
});

Deno.test('successRateByField picks up AG Review Status and CG Review Status (multi-platform tabs), scoped per platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 'Rooster Partners', data: { Agent: 'ANN', 'AG Review Status': 'Published' } },
    { id: '2', tab: 'Rooster Partners', data: { Agent: 'BOB', 'CG Review Status': 'Removed' } },
  ];
  const agOut = successRateByField(entries, 'agent', ['ag']);
  const ann = agOut.find((r) => r.value === 'ANN');
  assertEquals(ann?.live, 1);
  assertEquals(ann?.total, 1);
  assertEquals(agOut.find((r) => r.value === 'BOB'), undefined);

  const cgOut = successRateByField(entries, 'agent', ['cg']);
  const bob = cgOut.find((r) => r.value === 'BOB');
  assertEquals(bob?.removed, 1);
  assertEquals(bob?.total, 1);
  assertEquals(cgOut.find((r) => r.value === 'ANN'), undefined);
});

Deno.test('resolveAgentLabels prefers brand_agent_assignments over the raw per-entry Agent column', () => {
  const entries = [
    { id: '1', tab: 'Hanan', data: { Brands: 'ZodiacBet.com' }, updated_at: '2026-08-01T00:00:00Z' },
  ];
  const assignmentRows = [{ tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp' as const, agent: 'ANN' }];
  const labels = resolveAgentLabels(entries, assignmentRows);
  assertEquals(labels.get('1'), 'ANN');
});

Deno.test('resolveAgentLabels resolves a brand with no per-entry Agent column at all (Hanan has none)', () => {
  // No 'Agent' key anywhere in data — exactly the real-world shape for the 5
  // tabs that motivated this table in the first place.
  const entries = [
    { id: '1', tab: 'Hanan', data: { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published' }, updated_at: '2026-08-01T00:00:00Z' },
  ];
  const assignmentRows = [{ tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp' as const, agent: 'ANN' }];
  const labels = resolveAgentLabels(entries, assignmentRows);
  assertEquals(labels.get('1'), 'ANN');
});

Deno.test('resolveAgentLabels falls back to the per-entry Agent column when no assignment row exists', () => {
  const entries = [
    { id: '1', tab: 'Rooster Partners', data: { Brands: 'Midasluck', Agent: 'BOB' }, updated_at: '2026-08-01T00:00:00Z' },
  ];
  const labels = resolveAgentLabels(entries, []);
  assertEquals(labels.get('1'), 'BOB');
});

Deno.test('resolveAgentLabels has no entry for a brand+platform the sheet explicitly marks unassigned (agent: null)', () => {
  const entries = [
    { id: '1', tab: 'SilverPlay', data: { Brands: 'Silver Play', 'TP Review Status': 'Published' }, updated_at: '2026-08-01T00:00:00Z' },
  ];
  const assignmentRows = [{ tab: 'SilverPlay', brand: 'Silver Play', platform: 'tp' as const, agent: null }];
  const labels = resolveAgentLabels(entries, assignmentRows);
  assertEquals(labels.has('1'), false);
});

Deno.test('resolveAgentLabels keeps two tabs\' assignment rows independent (Lucky7even: LAI on Rooster Partners, JEN on Wizard of Odds)', () => {
  const entries = [
    { id: '1', tab: 'Rooster Partners', data: { Brands: 'Lucky7even' }, updated_at: '2026-08-01T00:00:00Z' },
    { id: '2', tab: 'Wizard of Odds', data: { 'Brand Name': 'Lucky7even' }, updated_at: '2026-08-01T00:00:00Z' },
  ];
  const assignmentRows = [
    { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'tp' as const, agent: 'LAI' },
    { tab: 'Wizard of Odds', brand: 'Lucky7even', platform: 'wo' as const, agent: 'JEN' },
  ];
  const labels = resolveAgentLabels(entries, assignmentRows);
  assertEquals(labels.get('1'), 'LAI');
  assertEquals(labels.get('2'), 'JEN');
});

Deno.test('successRateByField uses resolvedAgentLabels when passed, ignoring the raw per-entry column', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 'Hanan', data: { 'TP Review Status': 'Published' } },
  ];
  const labels = new Map([['1', 'ANN']]);
  const out = successRateByField(entries, 'agent', ['tp'], new Set(), labels);
  assertEquals(out.length, 1);
  assertEquals(out[0].value, 'ANN');
  assertEquals(out[0].live, 1);
});

Deno.test('successRateByField without resolvedAgentLabels keeps the original raw per-entry behavior (backward compatible)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Agent: 'BOB', 'TP Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'agent', ['tp']);
  assertEquals(out[0].value, 'BOB');
});

Deno.test('groupByField uses resolvedAgentLabels for "Agent" when passed', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 'Hanan', data: {} },
    { id: '2', tab: 'Hanan', data: {} },
  ];
  const labels = new Map([['1', 'ANN'], ['2', 'ANN']]);
  assertEquals(groupByField(entries, 'Agent', labels), [{ value: 'ANN', count: 2 }]);
});

Deno.test('groupByField without resolvedAgentLabels keeps the original raw-column behavior for "Agent" (backward compatible)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Agent: 'BOB' } },
  ];
  assertEquals(groupByField(entries, 'Agent'), [{ value: 'BOB', count: 1 }]);
});

Deno.test('get_success_rate_by_field end-to-end resolves agent via brand_agent_assignments for a tab with no per-entry Agent column', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Hanan', data: { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published' }, updated_at: '2026-08-01T00:00:00Z' },
    ],
    removed_platform_brands: [],
    tab_archive_log: [],
    brand_agent_assignments: [
      { tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp', agent: 'ANN' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_success_rate_by_field', { field: 'agent', platform: 'tp' });
  assertEquals(result.results.length, 1);
  assertEquals(result.results[0].value, 'ANN');
  assertEquals(result.results[0].live, 1);
});

Deno.test('query_entries group_by "Agent" end-to-end resolves via brand_agent_assignments', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Hanan', data: { Brands: 'ZodiacBet.com' }, updated_at: '2026-08-01T00:00:00Z' },
    ],
    tab_archive_log: [],
    brand_agent_assignments: [
      { tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp', agent: 'ANN' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', { group_by: 'Agent' });
  assertEquals(result.groups, [{ value: 'ANN', count: 1 }]);
});

Deno.test('parseScore respects a custom maxScore and floors fractional values', () => {
  assertEquals(parseScore('8', 10), 8);
  assertEquals(parseScore('11', 10), null);
  assertEquals(parseScore('4.7'), 4);
  assertEquals(parseScore('0', 10), null);
});

Deno.test('ratingLabel maps average to a qualitative label, scaled by maxScore', () => {
  assertEquals(ratingLabel(4.5), 'Excellent');
  assertEquals(ratingLabel(4.0), 'Great');
  assertEquals(ratingLabel(3.0), 'Average');
  assertEquals(ratingLabel(2.0), 'Poor');
  assertEquals(ratingLabel(1.0), 'Bad');
  assertEquals(ratingLabel(null), null);
  assertEquals(ratingLabel(9.0, 10), 'Excellent');
  assertEquals(ratingLabel(8.0, 10), 'Great');
});

Deno.test('scoreSummary is platform-aware and supports AskGamblers 1-10 scores', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'A', 'AG Review Status': 'Published', 'AG Score added': '8' } },
    { id: '2', tab: 't', data: { Brand: 'A', 'AG Review Status': 'Removed' } },
    // A TP status key on the same tab/brand must NOT leak into an AG-scoped query.
    { id: '3', tab: 't', data: { Brand: 'A', 'Review Status': 'Published', 'Score added': '2' } },
  ];
  const out = scoreSummary(entries, ['ag']).brands;
  assertEquals(out.length, 1);
  assertEquals(out[0].rated, 1);
  assertEquals(out[0].average, 8);
  assertEquals(out[0].live, 1);
  assertEquals(out[0].removed, 1);
  assertEquals(out[0].successRate, 50);
});

Deno.test('scoreSummary creates a bucket for a brand with only Removed entries (no stars, but a real success rate)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'B', 'Review Status': 'Removed' } },
    { id: '2', tab: 't', data: { Brand: 'B', 'Review Status': 'Refused' } },
  ];
  const out = scoreSummary(entries).brands;
  assertEquals(out.length, 1);
  assertEquals(out[0].rated, 0);
  assertEquals(out[0].average, null);
  assertEquals(out[0].live, 0);
  assertEquals(out[0].removed, 2);
  assertEquals(out[0].successRate, 0);
});

Deno.test('scoreSummary floors successRate to a whole percent, matching the dashboard\'s successRatePct (not the raw unrounded rate)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'D', 'Review Status': 'Published', 'Score added': '3' } },
    { id: '2', tab: 't', data: { Brand: 'D', 'Review Status': 'Live' } },
    { id: '3', tab: 't', data: { Brand: 'D', 'Review Status': 'Removed' } },
  ];
  const out = scoreSummary(entries).brands;
  assertEquals(out[0].live, 2);
  assertEquals(out[0].removed, 1);
  // Raw rate is 2/3 * 100 = 66.666...; floored (not rounded) to 66.
  assertEquals(out[0].successRate, 66);
});

Deno.test('get_score_summary defaults to tp platform when given an invalid value', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'C', 'Review Status': 'Published', 'Score added': '3' } },
  ];
  const result: any = await runTool(
    mockSupabaseTables({ entries: rows, removed_platform_brands: [] }),
    'get_score_summary',
    { platform: 'not-a-real-platform' },
  );
  assertEquals(result.brands.length, 1);
  assertEquals(result.brands[0].average, 3);
});

Deno.test('scoreSummary works for cg and wo platforms, not just tp/ag', () => {
  const cgEntries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'D', 'CG Review Status': 'Published', 'CG Score added': '4' } },
  ];
  const cgOut = scoreSummary(cgEntries, ['cg']).brands;
  assertEquals(cgOut.length, 1);
  assertEquals(cgOut[0].rated, 1);
  assertEquals(cgOut[0].average, 4);

  const woEntries: EntryRow[] = [
    { id: '2', tab: 't', data: { Brand: 'E', 'WoO Review Status': 'Published', 'Wizard of OddsScore added': '5' } },
  ];
  const woOut = scoreSummary(woEntries, ['wo']).brands;
  assertEquals(woOut.length, 1);
  assertEquals(woOut[0].rated, 1);
  assertEquals(woOut[0].average, 5);
});

Deno.test('scoreSummary attaches a rating label matching the computed average', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'F', 'Review Status': 'Published', 'Score added': '5' } },
  ];
  const out = scoreSummary(entries).brands;
  assertEquals(out[0].average, 5);
  assertEquals(out[0].label, 'Excellent');
});

Deno.test('platformRemovedKey normalizes brand casing and whitespace', () => {
  assertEquals(
    platformRemovedKey('TP Brand Injection', ' Acme ', 'tp'),
    platformRemovedKey('TP Brand Injection', 'ACME', 'tp'),
  );
  assertEquals(normalizeBrandKey(' Acme '), 'acme');
});

Deno.test('buildRemovedPlatformBrandSet builds one key per row', () => {
  const set = buildRemovedPlatformBrandSet([
    { tab: 'TP Brand Injection', brand: 'Acme', platform: 'tp' },
    { tab: 'Rooster Partners', brand: 'Beta', platform: 'ag' },
  ]);
  assertEquals(set.size, 2);
  assertEquals(set.has(platformRemovedKey('TP Brand Injection', 'Acme', 'tp')), true);
  assertEquals(set.has(platformRemovedKey('Rooster Partners', 'Beta', 'ag')), true);
});

Deno.test('buildArchivedTabNameSet includes only rows with no restored_at', () => {
  const set = buildArchivedTabNameSet([
    { tab: 'Rooster Partners', restored_at: null },
    { tab: 'Hanan', restored_at: '2026-08-19T00:00:00Z' },
  ]);
  assertEquals(set.has('Rooster Partners'), true);
  assertEquals(set.has('Hanan'), false);
});

Deno.test('list_tabs excludes an archived tab via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: {} },
      { id: '2', tab: 'Hanan', data: {} },
    ],
    tab_archive_log: [{ tab: 'Hanan', restored_at: null }],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'list_tabs', {});
  assertEquals(result.tabs, ['Rooster Partners']);
});

Deno.test('query_entries excludes rows from an archived tab via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: { Brand: 'Acme' } },
      { id: '2', tab: 'Hanan', data: { Brand: 'Beta' } },
    ],
    tab_archive_log: [{ tab: 'Hanan', restored_at: null }],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {});
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].tab, 'Rooster Partners');
});

Deno.test('buildPausedTabNameSet includes every row (current-state-only table)', () => {
  const set = buildPausedTabNameSet([{ tab: 'Rooster Partners' }]);
  assertEquals(set.has('Rooster Partners'), true);
  assertEquals(set.has('Hanan'), false);
});

Deno.test('list_tabs excludes a paused tab via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: {} },
      { id: '2', tab: 'Hanan', data: {} },
    ],
    tab_archive_log: [],
    paused_tabs: [{ tab: 'Hanan' }],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'list_tabs', {});
  assertEquals(result.tabs, ['Rooster Partners']);
});

Deno.test('query_entries excludes rows from a paused tab via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: { Brand: 'Acme' } },
      { id: '2', tab: 'Hanan', data: { Brand: 'Beta' } },
    ],
    tab_archive_log: [],
    paused_tabs: [{ tab: 'Hanan' }],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {});
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].tab, 'Rooster Partners');
});

Deno.test('get_removed_platform_flags lists flagged rows, optionally filtered by tab', async () => {
  const tables = {
    removed_platform_brands: [
      { tab: 'TP Brand Injection', brand: 'Acme', platform: 'tp' },
      { tab: 'Rooster Partners', brand: 'Beta', platform: 'ag' },
    ],
  };
  const all: any = await runTool(mockSupabaseTables(tables), 'get_removed_platform_flags', {});
  assertEquals(all.flags.length, 2);

  const filtered: any = await runTool(mockSupabaseTables(tables), 'get_removed_platform_flags', { tab: 'Rooster Partners' });
  assertEquals(filtered.flags.length, 1);
  assertEquals(filtered.flags[0].brand, 'Beta');
});

Deno.test('scoreSummary excludes a brand flagged as removed for the queried platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Score added': '5' } },
  ];
  const removedSet = buildRemovedPlatformBrandSet([{ tab: 't', brand: 'Acme', platform: 'tp' }]);
  const out = scoreSummary(entries, ['tp'], removedSet).brands;
  assertEquals(out.length, 0);
});

Deno.test('scoreSummary does not exclude a brand flagged as removed on a different platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'AG Review Status': 'Published', 'AG Score added': '8' } },
  ];
  const removedSet = buildRemovedPlatformBrandSet([{ tab: 't', brand: 'Acme', platform: 'tp' }]);
  const out = scoreSummary(entries, ['ag'], removedSet).brands;
  assertEquals(out.length, 1);
});

Deno.test('get_score_summary end-to-end excludes a removed-flagged brand via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Score added': '5' } },
      { id: '2', tab: 't', data: { Brand: 'Zeta', 'Review Status': 'Published', 'Score added': '4' } },
    ],
    removed_platform_brands: [
      { tab: 't', brand: 'Acme', platform: 'tp' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', {});
  assertEquals(result.brands.length, 1);
  assertEquals(result.brands[0].brand, 'Zeta');
});

Deno.test('successRateByField excludes rows whose brand is flagged removed for the queried platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
  ];
  const removedSet = buildRemovedPlatformBrandSet([{ tab: 't', brand: 'Acme', platform: 'tp' }]);
  const out = successRateByField(entries, 'proxy', ['tp'], removedSet);
  assertEquals(out.length, 0);
});

Deno.test('successRateByField works normally when a row has no brand field at all', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'proxy', ['tp'], new Set());
  assertEquals(out.length, 1);
  assertEquals(out[0].value, 'Enigma');
});

Deno.test('get_success_rate_by_field end-to-end excludes a removed-flagged brand via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
      { id: '2', tab: 't', data: { Brand: 'Zeta', 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
    ],
    removed_platform_brands: [
      { tab: 't', brand: 'Acme', platform: 'tp' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_success_rate_by_field', { field: 'proxy' });
  const enigma = result.results.find((r: any) => r.value === 'Enigma');
  assertEquals(enigma.live, 1);
});

Deno.test('successRateByField does not exclude a brand flagged as removed on a different platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'AG Review Status': 'Published', Agent: 'ANN' } },
  ];
  const removedSet = buildRemovedPlatformBrandSet([{ tab: 't', brand: 'Acme', platform: 'tp' }]);
  const out = successRateByField(entries, 'agent', ['ag'], removedSet);
  assertEquals(out.length, 1);
  assertEquals(out[0].value, 'ANN');
});

Deno.test('get_success_rate_by_field defaults to tp platform when given an invalid value', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'C', 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
    ],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_success_rate_by_field', { field: 'proxy', platform: 'not-a-real-platform' });
  assertEquals(result.results.length, 1);
  assertEquals(result.results[0].value, 'Enigma');
  assertEquals(result.results[0].live, 1);
});

Deno.test('get_score_summary with 2 platforms combines their live/removed counts, hides star detail', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'TP Review Status': 'Removed', 'CG Review Status': 'Published', 'CG Score added': '4' } },
    ],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', { platform: ['tp', 'cg'] });
  assertEquals(result.brands.length, 1);
  // TP Removed + CG Published/live on the same brand: live wins (matches
  // computeTabKpisFromEntries' and computeScoreSummary's live-checked-before-removed
  // tie-break), and star counts are zeroed since 2 platforms are selected.
  assertEquals(result.brands[0].live, 1);
  assertEquals(result.brands[0].removed, 0);
  assertEquals(result.brands[0].rated, 0);
});

Deno.test('get_score_summary with platform as a bare string behaves identically to a one-item array (final-review fix: model can omit the array wrapper)', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'AG Review Status': 'Published', 'AG Score added': '8' } },
    ],
    removed_platform_brands: [],
  };
  const bareString: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', { platform: 'ag' });
  const arrayForm: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', { platform: ['ag'] });
  assertEquals(bareString, arrayForm);
  assertEquals(bareString.brands[0].average, 8);
});

Deno.test('get_score_summary with an all-invalid platform array falls back to tp-only, not all-4-combined (final-review fix)', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'TP Review Status': 'Published', 'Score added': '3' } },
      { id: '2', tab: 't', data: { Brand: 'Acme', 'AG Review Status': 'Removed' } },
    ],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', { platform: ['xyz'] });
  assertEquals(result.brands.length, 1);
  // If this fell back to all-4-combined (the pre-fix empty-array behavior),
  // the AG Removed row would also count, making removed 1 instead of 0.
  assertEquals(result.brands[0].live, 1);
  assertEquals(result.brands[0].removed, 0);
  assertEquals(result.brands[0].average, 3);
});

Deno.test('successRateByField with 2 platforms combines a value\'s live/removed across both', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'Proxy Used': 'Enigma', 'TP Review Status': 'Removed', 'AG Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'proxy', ['tp', 'ag']);
  const enigma = out.find((r) => r.value === 'Enigma')!;
  assertEquals(enigma.live, 1);
  assertEquals(enigma.removed, 0);
});

Deno.test('get_score_summary/get_success_rate_by_field with platform omitted still default to tp only (regression lock)', async () => {
  const tables = {
    entries: [{ id: '1', tab: 't', data: { Brand: 'C', 'TP Review Status': 'Published', 'Score added': '3' } }],
    removed_platform_brands: [],
  };
  const withArray: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', { platform: ['tp'] });
  const omitted: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', {});
  assertEquals(omitted, withArray);
});

Deno.test('scoreSummary with an empty platforms array falls back to all 4 combined', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'AG Review Status': 'Published', 'AG Score added': '9' } },
    { id: '2', tab: 't', data: { Brand: 'Acme', 'CG Review Status': 'Removed' } },
  ];
  const out = scoreSummary(entries, []).brands;
  assertEquals(out.length, 1);
  // Neither row has a TP status, so ['tp'] (the omitted-platform default)
  // would find nothing for this brand — [] must resolve to all 4 platforms
  // combined, not fall back to the tp-only default.
  assertEquals(out[0].live, 1);
  assertEquals(out[0].removed, 1);
});

Deno.test('successRateByField with an empty platforms array falls back to all 4 combined', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'Enigma', 'AG Review Status': 'Published' } },
    { id: '2', tab: 't', data: { 'Proxy Used': 'Enigma', 'CG Review Status': 'Removed' } },
  ];
  const out = successRateByField(entries, 'proxy', []);
  const enigma = out.find((r) => r.value === 'Enigma')!;
  assertEquals(enigma.live, 1);
  assertEquals(enigma.removed, 1);
  assertEquals(enigma.total, 2);
});

Deno.test('get_schedule returns the weekly grid for a tab and week, using brand not brand_key', async () => {
  const tables = {
    brand_schedule: [
      {
        tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'tp', week_start: '2026-08-03',
        monday: 'active', tuesday: null, wednesday: null, thursday: 'active', friday: null,
      },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Rooster Partners', week_start: '2026-08-03' });
  assertEquals(result.schedule.length, 1);
  assertEquals(result.schedule[0].brand, 'Lucky7even');
  assertEquals(result.schedule[0].monday, 'active');
  assertEquals(result.schedule[0].tuesday, null);
});

Deno.test('get_schedule filters by both tab and week_start', async () => {
  const tables = {
    brand_schedule: [
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'tp', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'tp', week_start: '2026-07-27', monday: 'paused', tuesday: null, wednesday: null, thursday: null, friday: null },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Rooster Partners', week_start: '2026-08-03' });
  assertEquals(result.schedule.length, 1);
  assertEquals(result.schedule[0].monday, 'active');
});

Deno.test('get_schedule returns an empty array, not an error, when nothing matches', async () => {
  const tables = { brand_schedule: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Rooster Partners', week_start: '2099-01-05' });
  assertEquals(result.schedule.length, 0);
});

Deno.test("get_schedule excludes a hidden brand's row", async () => {
  const tables = {
    brand_schedule: [
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'tp', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      { tab: 'Rooster Partners', brand: 'HiddenBrand', platform: 'tp', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ],
    schedule_hidden_brands: [
      { tab: 'Rooster Partners', brand: 'HiddenBrand' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Rooster Partners', week_start: '2026-08-03' });
  assertEquals(result.schedule.length, 1);
  assertEquals(result.schedule[0].brand, 'Lucky7even');
});

Deno.test("get_schedule excludes a platform-restricted brand's non-allowed-platform row, keeps the allowed one", async () => {
  const tables = {
    brand_schedule: [
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'ag', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ],
    schedule_platform_restrictions: [
      { tab: 'Hanan', brand: 'Pribet.com', allowed_platform: 'tp' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Hanan', week_start: '2026-08-03' });
  assertEquals(result.schedule.length, 1);
  assertEquals(result.schedule[0].platform, 'tp');
});

Deno.test('get_schedule keeps a legacy (platform: null) row for a platform-restricted brand', async () => {
  const tables = {
    brand_schedule: [
      { tab: 'Hanan', brand: 'Pribet.com', platform: null, week_start: '2026-01-05', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ],
    schedule_platform_restrictions: [
      { tab: 'Hanan', brand: 'Pribet.com', allowed_platform: 'tp' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Hanan', week_start: '2026-01-05' });
  assertEquals(result.schedule.length, 1);
  assertEquals(result.schedule[0].platform, null);
});

Deno.test("get_schedule excludes a brand whose platform page is flagged removed", async () => {
  const tables = {
    brand_schedule: [
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'ag', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ],
    removed_platform_brands: [
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Hanan', week_start: '2026-08-03' });
  assertEquals(result.schedule.length, 1);
  assertEquals(result.schedule[0].platform, 'ag');
});

Deno.test("get_paused_combos excludes a brand whose platform page is flagged removed", async () => {
  const tables = {
    brand_platform_pause: [
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'ag', paused_week_start: '2026-07-27', reason: 'x' },
    ],
    removed_platform_brands: [
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'ag' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_paused_combos', {});
  assertEquals(result.paused.length, 0);
});

Deno.test('get_paused_combos lists paused combos with reason, optionally filtered by tab', async () => {
  const tables = {
    brand_platform_pause: [
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'ag', paused_week_start: '2026-07-27', reason: '2 consecutive removed' },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp', paused_week_start: '2026-08-03', reason: 'success rate below threshold' },
    ],
  };
  const all: any = await runTool(mockSupabaseTables(tables), 'get_paused_combos', {});
  assertEquals(all.paused.length, 2);

  const filtered: any = await runTool(mockSupabaseTables(tables), 'get_paused_combos', { tab: 'Hanan' });
  assertEquals(filtered.paused.length, 1);
  assertEquals(filtered.paused[0].brand, 'Pribet.com');
  assertEquals(filtered.paused[0].reason, 'success rate below threshold');
});

Deno.test("get_paused_combos excludes a hidden brand's paused combo", async () => {
  const tables = {
    brand_platform_pause: [
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'ag', paused_week_start: '2026-07-27', reason: 'x' },
      { tab: 'Rooster Partners', brand: 'HiddenBrand', platform: 'ag', paused_week_start: '2026-07-27', reason: 'x' },
    ],
    schedule_hidden_brands: [
      { tab: 'Rooster Partners', brand: 'HiddenBrand' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_paused_combos', {});
  assertEquals(result.paused.length, 1);
  assertEquals(result.paused[0].brand, 'Lucky7even');
});

Deno.test('isSensitiveField matches all known sensitive keys, case/whitespace-insensitive', () => {
  assertEquals(isSensitiveField('Password'), true);
  assertEquals(isSensitiveField('password'), true);
  assertEquals(isSensitiveField(' Password '), true);
  assertEquals(isSensitiveField('AG Password'), true);
  assertEquals(isSensitiveField('CG Password'), true);
  assertEquals(isSensitiveField('Casino Password'), true);
  assertEquals(isSensitiveField('Backup Codes'), true);
  assertEquals(isSensitiveField('Authenticator Backup'), true);
});

Deno.test('isSensitiveField returns false for an ordinary field', () => {
  assertEquals(isSensitiveField('Agent'), false);
  assertEquals(isSensitiveField('Email Provider'), false);
  assertEquals(isSensitiveField('Brands'), false);
});

Deno.test('collectFieldNames unions field names across rows and dedupes', () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'A', Agent: 'ANN' } },
    { id: '2', tab: 't', data: { Brands: 'B', Country: 'PH' } },
  ];
  assertEquals(collectFieldNames(rows), ['Agent', 'Brands', 'Country']);
});

Deno.test('collectFieldNames excludes sensitive keys, including case/whitespace variants', () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'A', Password: 'x', ' backup codes ': 'y' } },
  ];
  assertEquals(collectFieldNames(rows), ['Brands']);
});

Deno.test('list_fields returns field names for one tab via runTool', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 'Trybet', data: { Brands: 'Acme', 'Email Provider': 'Gmail' } },
    { id: '2', tab: 'Hanan', data: { Brands: 'Zeta', Agent: 'ANN' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'list_fields', { tab: 'Trybet' });
  assertEquals(result.fields, ['Brands', 'Email Provider']);
});

Deno.test('list_fields unions field names across all tabs when tab is omitted', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 'Trybet', data: { Brands: 'Acme' } },
    { id: '2', tab: 'Hanan', data: { Agent: 'ANN' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'list_fields', {});
  assertEquals(result.fields, ['Agent', 'Brands']);
});

Deno.test('matchesFieldFilters requires all filters to match (AND)', () => {
  const e: EntryRow = { id: '1', tab: 't', data: { Agent: 'ANN', Country: 'PH' } };
  assertEquals(matchesFieldFilters(e, { Agent: 'ANN' }), true);
  assertEquals(matchesFieldFilters(e, { Agent: 'ANN', Country: 'PH' }), true);
  assertEquals(matchesFieldFilters(e, { Agent: 'ANN', Country: 'US' }), false);
  assertEquals(matchesFieldFilters(e, { Agent: 'BOB' }), false);
});

Deno.test('matchesFieldFilters is case-insensitive and trims on the value comparison', () => {
  const e: EntryRow = { id: '1', tab: 't', data: { Agent: ' ann ' } };
  assertEquals(matchesFieldFilters(e, { Agent: 'ANN' }), true);
});

Deno.test('matchesFieldFilters returns false when the field is missing entirely', () => {
  const e: EntryRow = { id: '1', tab: 't', data: { Country: 'PH' } };
  assertEquals(matchesFieldFilters(e, { Agent: 'ANN' }), false);
});

Deno.test('groupByField counts and sorts most-common-first', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'Trybet' } },
    { id: '2', tab: 't', data: { Brands: 'Trybet' } },
    { id: '3', tab: 't', data: { Brands: '7Bit' } },
  ];
  assertEquals(groupByField(entries, 'Brands'), [
    { value: 'Trybet', count: 2 },
    { value: '7Bit', count: 1 },
  ]);
});

Deno.test('groupByField excludes rows with a blank or missing value for the field', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'Trybet' } },
    { id: '2', tab: 't', data: { Brands: '' } },
    { id: '3', tab: 't', data: {} },
  ];
  assertEquals(groupByField(entries, 'Brands'), [{ value: 'Trybet', count: 1 }]);
});

Deno.test('groupByField merges case-variant "Proxy Used" values into one group (case-insensitive, matching dashboard grouping); other fields stay case-sensitive', () => {
  const proxyEntries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'Enigma' } },
    { id: '2', tab: 't', data: { 'Proxy Used': 'enigma' } },
    { id: '3', tab: 't', data: { 'Proxy Used': 'ENIGMA' } },
  ];
  assertEquals(groupByField(proxyEntries, 'Proxy Used'), [{ value: 'Enigma', count: 3 }]);

  const brandEntries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'Trybet' } },
    { id: '2', tab: 't', data: { Brands: 'trybet' } },
  ];
  assertEquals(groupByField(brandEntries, 'Brands'), [
    { value: 'Trybet', count: 1 },
    { value: 'trybet', count: 1 },
  ]);
});

Deno.test('query_entries with field_filters narrows rows before returning them', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Agent: 'ANN', Brands: 'Trybet' } },
    { id: '2', tab: 't', data: { Agent: 'BOB', Brands: '7Bit' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', { field_filters: { Agent: 'ANN' } });
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].data.Brands, 'Trybet');
});

Deno.test('query_entries with group_by returns grouped counts instead of rows', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Agent: 'ANN', Brands: 'Trybet' } },
    { id: '2', tab: 't', data: { Agent: 'ANN', Brands: 'Trybet' } },
    { id: '3', tab: 't', data: { Agent: 'ANN', Brands: '7Bit' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {
    field_filters: { Agent: 'ANN' },
    group_by: 'Brands',
  });
  assertEquals(result.total, 3);
  assertEquals(result.groups, [
    { value: 'Trybet', count: 2 },
    { value: '7Bit', count: 1 },
  ]);
  assertEquals('rows' in result, false);
});

Deno.test('query_entries combines group_by/field_filters with existing status/month/contains filters', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Agent: 'ANN', Brands: 'Trybet', 'Review Status': 'Published' } },
    { id: '2', tab: 't', data: { Agent: 'ANN', Brands: 'Trybet', 'Review Status': 'Removed' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {
    field_filters: { Agent: 'ANN' },
    status: 'Published',
    group_by: 'Brands',
  });
  assertEquals(result.total, 1);
  assertEquals(result.groups, [{ value: 'Trybet', count: 1 }]);
});

Deno.test('query_entries rejects group_by on a sensitive field without touching the database', async () => {
  const rows: EntryRow[] = [{ id: '1', tab: 't', data: { Password: 'hunter2' } }];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', { group_by: 'Password' });
  assertEquals(typeof result.error, 'string');
  assertEquals('groups' in result, false);
  assertEquals('rows' in result, false);
});

Deno.test('query_entries rejects field_filters on a sensitive field without touching the database', async () => {
  const rows: EntryRow[] = [{ id: '1', tab: 't', data: { 'Backup Codes': 'x', Brands: 'Trybet' } }];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {
    field_filters: { 'Backup Codes': 'x' },
  });
  assertEquals(typeof result.error, 'string');
  assertEquals('rows' in result, false);
});

Deno.test('query_entries with no field_filters/group_by behaves exactly as before (regression lock)', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'Trybet', 'Review Status': 'Published' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {});
  assertEquals(result.total, 1);
  assertEquals(result.rows.length, 1);
  assertEquals(result.rows[0].data.Brands, 'Trybet');
});

// --- Final whole-branch review fixes (2026-08-05) ---

Deno.test('query_entries group_by caps the groups array at 50 and reports the true distinct-value count', async () => {
  const rows: EntryRow[] = [];
  for (let i = 0; i < 60; i++) {
    rows.push({ id: String(i), tab: 't', data: { Brands: `Brand${i}` } });
  }
  const result: any = await runTool(mockSupabase(rows), 'query_entries', { group_by: 'Brands' });
  assertEquals(result.total, 60);
  assertEquals(result.groups.length, 25); // default limit, same ceiling as rows path
  assertEquals(result.distinctValues, 60);
});

Deno.test('query_entries group_by honors a caller-supplied limit up to the 50 ceiling', async () => {
  const rows: EntryRow[] = [];
  for (let i = 0; i < 60; i++) {
    rows.push({ id: String(i), tab: 't', data: { Brands: `Brand${i}` } });
  }
  const result: any = await runTool(mockSupabase(rows), 'query_entries', { group_by: 'Brands', limit: 100 });
  assertEquals(result.groups.length, 50); // capped even though caller asked for 100
  assertEquals(result.distinctValues, 60);
});

Deno.test('query_entries group_by reports ungrouped rows (blank/missing field value) separately from total', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'Trybet' } },
    { id: '2', tab: 't', data: { Brands: 'Trybet' } },
    { id: '3', tab: 't', data: { Brands: '' } },
    { id: '4', tab: 't', data: {} },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', { group_by: 'Brands' });
  assertEquals(result.total, 4);
  assertEquals(result.groups, [{ value: 'Trybet', count: 2 }]);
  assertEquals(result.ungrouped, 2);
  const summedGroups = result.groups.reduce((sum: number, g: any) => sum + g.count, 0);
  assertEquals(result.total, result.ungrouped + summedGroups);
});

Deno.test('query_entries rejects field_filters passed as a JSON string with an explicit error, not a silent empty result', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Agent: 'ANN', Brands: 'Trybet' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {
    field_filters: '{"Agent":"ANN"}' as any,
  });
  assertEquals(typeof result.error, 'string');
  assertEquals('rows' in result, false);
  assertEquals('groups' in result, false);
});

Deno.test('query_entries field_filters with a numeric value matches instead of throwing', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Score: '4', Brands: 'Trybet' } },
    { id: '2', tab: 't', data: { Score: '5', Brands: '7Bit' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {
    field_filters: { Score: 4 } as any,
  });
  assertEquals(result.error, undefined);
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].data.Brands, 'Trybet');
});

Deno.test('query_entries rejects a non-string group_by with an explicit error, not a thrown exception', async () => {
  const rows: EntryRow[] = [{ id: '1', tab: 't', data: { Brands: 'Trybet' } }];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {
    group_by: ['Brands'] as any,
  });
  assertEquals(typeof result.error, 'string');
  assertEquals('groups' in result, false);
});

Deno.test('matchesFieldFilters coerces a numeric filter value instead of throwing', () => {
  const e: EntryRow = { id: '1', tab: 't', data: { Score: '4' } };
  assertEquals(matchesFieldFilters(e, { Score: 4 as any }), true);
  assertEquals(matchesFieldFilters(e, { Score: 5 as any }), false);
});

Deno.test('isSensitiveField does not throw on a non-string input', () => {
  assertEquals(isSensitiveField(['Brands'] as any), false);
  assertEquals(isSensitiveField(123 as any), false);
});

Deno.test('list_fields caps the underlying entries scan instead of pulling every row', async () => {
  // Each row has its own uniquely-named field, so the cap is directly observable:
  // an uncapped scan would find all 600 distinct field names.
  const rows: EntryRow[] = [];
  for (let i = 0; i < 600; i++) {
    rows.push({ id: String(i), tab: 't', data: { [`Field${i}`]: 'x' } });
  }
  const result: any = await runTool(mockSupabase(rows), 'list_fields', {});
  assertEquals(result.fields.length, 500);
});

Deno.test('reviewTextsByStatus returns matching platform+status rows with brand and text', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'A', 'TP Review Status': 'Published', 'TP Review Text': 'Great service, fast payout.' } },
    { id: '2', tab: 't', data: { Brand: 'B', 'TP Review Status': 'Removed', 'TP Review Text': 'Terrible, avoid.' } },
    { id: '3', tab: 't', data: { Brand: 'C', 'AG Review Status': 'Published', 'AG Review Text': 'Different platform, should not match.' } },
  ];
  const out = reviewTextsByStatus(entries, 'tp', 'Published');
  assertEquals(out.total, 1);
  assertEquals(out.reviews, [{ brand: 'A', text: 'Great service, fast payout.' }]);
});

Deno.test('reviewTextsByStatus skips a row with no recorded text for the platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'A', 'TP Review Status': 'Published' } },
  ];
  const out = reviewTextsByStatus(entries, 'tp', 'Published');
  assertEquals(out.reviews.length, 0);
  assertEquals(out.total, 0);
});

Deno.test('reviewTextsByStatus excludes a brand flagged removed on that platform, not on a different platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'A', 'TP Review Status': 'Published', 'TP Review Text': 'Text A' } },
    { id: '2', tab: 't', data: { Brand: 'A', 'AG Review Status': 'Published', 'AG Review Text': 'Text A on AG' } },
  ];
  const removedSet = buildRemovedPlatformBrandSet([{ tab: 't', brand: 'A', platform: 'tp' }]);
  const tpOut = reviewTextsByStatus(entries, 'tp', 'Published', removedSet);
  assertEquals(tpOut.reviews.length, 0);
  const agOut = reviewTextsByStatus(entries, 'ag', 'Published', removedSet);
  assertEquals(agOut.reviews.length, 1);
});

Deno.test('reviewTextsByStatus truncates text over 2000 characters and flags it, leaves shorter text untouched', () => {
  const longText = 'x'.repeat(2500);
  const shortText = 'a normal review';
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'A', 'TP Review Status': 'Published', 'TP Review Text': longText } },
    { id: '2', tab: 't', data: { Brand: 'B', 'TP Review Status': 'Published', 'TP Review Text': shortText } },
  ];
  const out = reviewTextsByStatus(entries, 'tp', 'Published');
  const truncated = out.reviews.find((r) => r.brand === 'A')!;
  assertEquals(truncated.text.length, 2000 + ' […truncated]'.length);
  assertEquals(truncated.text.endsWith(' […truncated]'), true);
  const untouched = out.reviews.find((r) => r.brand === 'B')!;
  assertEquals(untouched.text, shortText);
});

Deno.test('get_review_texts returns brand+text rows for a matching tab/platform/status', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: { Brands: 'Lucky7even', 'TP Review Status': 'Published', 'TP Review Text': 'Solid platform.' } },
      { id: '2', tab: 'Hanan', data: { Brands: 'Pribet.com', 'TP Review Status': 'Published', 'TP Review Text': 'Should not appear (different tab).' } },
    ],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { tab: 'Rooster Partners', platform: 'tp', status: 'Published' });
  assertEquals(result.reviews, [{ brand: 'Lucky7even', text: 'Solid platform.' }]);
  assertEquals(result.total, 1);
});

Deno.test('get_review_texts requires platform and status', async () => {
  const tables = { entries: [] };
  const missingPlatform: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { status: 'Published' });
  assertEquals(typeof missingPlatform.error, 'string');
  const missingStatus: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { platform: 'tp' });
  assertEquals(typeof missingStatus.error, 'string');
});

Deno.test('get_review_texts rejects an invalid platform value', async () => {
  const tables = { entries: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { platform: 'xyz', status: 'Published' });
  assertEquals(typeof result.error, 'string');
});

Deno.test('get_review_texts total reflects the real match count even when limit caps the returned reviews', async () => {
  const entries: EntryRow[] = [];
  for (let i = 0; i < 5; i++) {
    entries.push({ id: String(i), tab: 't', data: { Brands: `Brand${i}`, 'TP Review Status': 'Published', 'TP Review Text': `Review ${i}` } });
  }
  const tables = { entries, removed_platform_brands: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { platform: 'tp', status: 'Published', limit: 2 });
  assertEquals(result.reviews.length, 2);
  assertEquals(result.total, 5);
});

Deno.test('get_review_texts returns an empty array, not an error, when nothing matches', async () => {
  const tables = { entries: [], removed_platform_brands: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { platform: 'tp', status: 'Removed' });
  assertEquals(result.reviews, []);
  assertEquals(result.total, 0);
});

// --- Final whole-branch review fixes (2026-08-14) ---

Deno.test('reviewTextsByStatus stops adding reviews once the character budget is used up, but total keeps counting every match', () => {
  const bigText = 'x'.repeat(20000);
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'A', 'TP Review Status': 'Published', 'TP Review Text': bigText } },
    { id: '2', tab: 't', data: { Brand: 'B', 'TP Review Status': 'Published', 'TP Review Text': bigText } },
    { id: '3', tab: 't', data: { Brand: 'C', 'TP Review Status': 'Published', 'TP Review Text': 'short one' } },
  ];
  const out = reviewTextsByStatus(entries, 'tp', 'Published');
  assertEquals(out.total, 3);
  assertEquals(out.reviews.length, 2);
});

Deno.test('get_review_texts rejects a whitespace-only status', async () => {
  const tables = { entries: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { platform: 'tp', status: '   ' });
  assertEquals(typeof result.error, 'string');
});

// --- get_review_analyses (Task 7) ---

Deno.test('get_review_analyses returns raw rows with resolved brand and agent', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'likely_removal_risk', risk_score: 80, confidence: 'high', root_cause: { label: 'proxy pattern' } }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', {});
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].brand, 'Acme');
  assertEquals(result.rows[0].agent, 'Lai');
  assertEquals(result.rows[0].overall_result, 'likely_removal_risk');
  assertEquals(result.rows[0].root_cause, 'proxy pattern');
});

Deno.test('get_review_analyses group_by="agent" produces exact counts including likely_removal_risk_count', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'likely_removal_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
      { entry_id: 'e2', tab: 'Rooster Partners', platform: 'ag', analysis: { overall_result: 'no_clear_removal_reason' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
      { id: 'e2', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', { group_by: 'agent' });
  assertEquals(result.total, 2);
  assertEquals(result.groups[0].value, 'Lai');
  assertEquals(result.groups[0].count, 2);
  assertEquals(result.groups[0].likely_removal_risk_count, 1);
});

Deno.test('get_review_analyses excludes a brand flagged removed on the queried platform', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'likely_removal_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [],
    removed_platform_brands: [{ tab: 'Rooster Partners', brand: 'Acme', platform: 'tp' }],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', {});
  assertEquals(result.total, 0);
});

Deno.test('get_review_analyses rejects an invalid group_by value', async () => {
  const tables = { entry_review_analyses: [], entries: [], tab_archive_log: [], paused_tabs: [], removed_platform_brands: [], brand_agent_assignments: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', { group_by: 'nonsense' });
  assertEquals(typeof result.error, 'string');
});

Deno.test('get_review_analyses group_by="brand" trims a leading/trailing-space brand variant into the same bucket', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'likely_removal_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
      { entry_id: 'e2', tab: 'Rooster Partners', platform: 'ag', analysis: { overall_result: 'no_clear_removal_reason' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
      { id: 'e2', tab: 'Rooster Partners', data: { Brands: ' Acme ', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', { group_by: 'brand' });
  assertEquals(result.total, 2);
  assertEquals(result.groups.length, 1);
  assertEquals(result.groups[0].value, 'Acme');
  assertEquals(result.groups[0].count, 2);
});

Deno.test('get_review_analyses excludes rows from an archived tab', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'likely_removal_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [{ tab: 'Rooster Partners', restored_at: null }],
    paused_tabs: [],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', {});
  assertEquals(result.total, 0);
});

Deno.test('get_review_analyses excludes rows from a paused tab', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'likely_removal_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [{ tab: 'Rooster Partners' }],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', {});
  assertEquals(result.total, 0);
});

Deno.test('get_review_analyses rejects an invalid platform value', async () => {
  const tables = { entry_review_analyses: [], entries: [], tab_archive_log: [], paused_tabs: [], removed_platform_brands: [], brand_agent_assignments: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', { platform: 'nonsense' });
  assertEquals(typeof result.error, 'string');
});

Deno.test('query_entries date_from/date_to filters by the tab\'s own active platform(s) when tab is given', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'TP Brand Injection', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-05-15' } },
      { id: '2', tab: 'TP Brand Injection', data: { Brand: 'Zeta', 'Review Status': 'Published', 'Trust Pilot': '2026-04-01' } },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {
    tab: 'TP Brand Injection', date_from: '2026-05-01', date_to: '2026-05-31',
  });
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].data.Brand, 'Acme');
});

Deno.test('query_entries date_from/date_to with no tab given ORs across all 4 platforms, checking only platforms the row has a status for', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'AG Review Status': 'Published', 'Ask Gambler review added': '2026-05-15' } }, // in range on ag
      { id: '2', tab: 't', data: { Brand: 'Zeta', 'CG Review Status': 'Published', 'Casino Guru review added': '2026-04-01' } }, // out of range on cg, no other platform status
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {
    date_from: '2026-05-01', date_to: '2026-05-31',
  });
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].data.Brand, 'Acme');
});

Deno.test('query_entries date_from/date_to includes a row with a status but no date at all (undated bias matches passesPlatformDateFilter)', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'TP Brand Injection', data: { Brand: 'Acme', 'Review Status': 'Published' } }, // status present, no date field at all
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {
    tab: 'TP Brand Injection', date_from: '2026-05-01', date_to: '2026-05-31',
  });
  assertEquals(result.total, 1);
});

Deno.test('query_entries combines date_from/date_to with month (both must pass)', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'TP Brand Injection', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-05-15' } }, // passes both
      { id: '2', tab: 'TP Brand Injection', data: { Brand: 'Zeta', 'Review Status': 'Published', 'Trust Pilot': '2026-06-01' } }, // fails date_to (and month)
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {
    tab: 'TP Brand Injection', month: 'may 2026', date_from: '2026-05-01', date_to: '2026-05-31',
  });
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].data.Brand, 'Acme');
});

Deno.test('scoreSummary\'s live/removed counts still include an undated row when a range is active (lenient gate)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'H', 'Review Status': 'Removed' } }, // no date at all
  ];
  const out = scoreSummary(entries, ['tp'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.brands[0].removed, 1);
  assertEquals(out.excludedRows, 0); // excludedRows only ever reflects the star-breakdown gate
});

Deno.test('scoreSummary excludes an undated Published row from the star breakdown when a range is active, and counts it in excludedRows', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'G', 'Review Status': 'Published', 'Score added': '5', 'Trust Pilot': '2026-05-15' } },
    { id: '2', tab: 't', data: { Brand: 'G', 'Review Status': 'Published', 'Score added': '4' } }, // no date
  ];
  const noRange = scoreSummary(entries, ['tp'], new Set(), {});
  assertEquals(noRange.excludedRows, 0);
  assertEquals(noRange.brands[0].rated, 2);

  const withRange = scoreSummary(entries, ['tp'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(withRange.excludedRows, 1);
  assertEquals(withRange.brands[0].rated, 1);
  assertEquals(withRange.brands[0].average, 5);
});

Deno.test('scoreSummary excludes a dated Published row outside the range from the star breakdown, without inflating excludedRows', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'I', 'Review Status': 'Published', 'Score added': '3', 'Trust Pilot': '2026-05-10' } }, // in range
    { id: '2', tab: 't', data: { Brand: 'I', 'Review Status': 'Published', 'Score added': '2', 'Trust Pilot': '2026-04-01' } }, // out of range
  ];
  // Note: a row whose only checked platform's date is out of range never
  // passes the live/removed gate either (passesPlatformDateFilter is also
  // what determines matchedAny) — so it contributes to neither live/removed
  // nor the star breakdown, and never inflates excludedRows (that only
  // tracks rows with NO parseable date, not out-of-range ones). The in-range
  // row above exists so the brand still has a bucket to assert against.
  const out = scoreSummary(entries, ['tp'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.brands[0].rated, 1);
  assertEquals(out.brands[0].average, 3);
  assertEquals(out.excludedRows, 0);
});

Deno.test('scoreSummary with 2+ platforms never populates excludedRows (star breakdown only ever runs for exactly one platform)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'J', 'TP Review Status': 'Published' } }, // undated
  ];
  const out = scoreSummary(entries, ['tp', 'ag'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.excludedRows, 0);
});

Deno.test('get_score_summary end-to-end applies date_from/date_to and echoes the range', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Score added': '5', 'Trust Pilot': '2026-05-15' } },
      { id: '2', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Score added': '2', 'Trust Pilot': '2026-04-01' } },
    ],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', { date_from: '2026-05-01', date_to: '2026-05-31' });
  assertEquals(result.dateRange, { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(result.brands[0].rated, 1);
  assertEquals(result.brands[0].average, 5);
});

Deno.test('get_score_summary reports dateRange as null when no date filter is passed', async () => {
  const tables = {
    entries: [{ id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Score added': '5' } }],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', {});
  assertEquals(result.dateRange, null);
  assertEquals(result.excludedRows, 0);
});

Deno.test('successRateByField applies a date range with the same lenient (undated-always-counts) gate as scoreSummary', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Published', 'Trust Pilot': '2026-05-15' } }, // in range
    { id: '2', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Removed', 'Trust Pilot': '2026-04-01' } }, // out of range, excluded
    { id: '3', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Removed' } }, // undated, always counts
  ];
  const out = successRateByField(entries, 'proxy', ['tp'], new Set(), undefined, { from: '2026-05-01', to: '2026-05-31' });
  const enigma = out.find((r) => r.value === 'Enigma')!;
  assertEquals(enigma.live, 1);
  assertEquals(enigma.removed, 1);
  assertEquals(enigma.total, 2);
});

Deno.test('successRateByField with no range behaves exactly as before (regression lock)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Published', 'Trust Pilot': '2026-05-15' } },
    { id: '2', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Removed', 'Trust Pilot': '2026-04-01' } },
  ];
  const out = successRateByField(entries, 'proxy');
  const enigma = out.find((r) => r.value === 'Enigma')!;
  assertEquals(enigma.live, 1);
  assertEquals(enigma.removed, 1);
});

Deno.test('get_success_rate_by_field end-to-end applies date_from/date_to', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'A', 'Proxy Used': 'Enigma', 'Review Status': 'Published', 'Trust Pilot': '2026-05-15' } },
      { id: '2', tab: 't', data: { Brand: 'A', 'Proxy Used': 'Enigma', 'Review Status': 'Removed', 'Trust Pilot': '2026-04-01' } },
    ],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_success_rate_by_field', {
    field: 'proxy', date_from: '2026-05-01', date_to: '2026-05-31',
  });
  const enigma = result.results.find((r: any) => r.value === 'Enigma');
  assertEquals(enigma.live, 1);
  assertEquals(enigma.removed, 0);
});

Deno.test('performanceReport computes period totals and a per-brand breakdown sorted by volume descending', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-05-05' } },
    { id: '2', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Removed', 'Trust Pilot': '2026-05-06' } },
    { id: '3', tab: 't', data: { Brand: 'Zeta', 'Review Status': 'Published', 'Trust Pilot': '2026-05-10' } },
    { id: '4', tab: 't', data: { Brand: 'Zeta', 'Review Status': 'Published' } }, // undated, still counts (lenient gate)
    { id: '5', tab: 't', data: { Brand: 'Zeta', 'Review Status': 'Removed', 'Trust Pilot': '2026-05-12' } },
    { id: '6', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-04-01' } }, // out of range, excluded
  ];
  const out = performanceReport(entries, ['tp'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.totals.live, 3);
  assertEquals(out.totals.removed, 2);
  assertEquals(out.totals.entries, 5);
  assertEquals(out.brands.map((b) => b.brand), ['Zeta', 'Acme']);
  assertEquals(out.brands[0].live, 2);
  assertEquals(out.brands[0].removed, 1);
  assertEquals(out.brands[1].live, 1);
  assertEquals(out.brands[1].removed, 1);
});

Deno.test('performanceReport excludes a brand flagged removed for the queried platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-05-05' } },
  ];
  const removedSet = buildRemovedPlatformBrandSet([{ tab: 't', brand: 'Acme', platform: 'tp' }]);
  const out = performanceReport(entries, ['tp'], removedSet, { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.brands.length, 0);
  assertEquals(out.totals.entries, 0);
});

Deno.test('performanceReport combines multiple platforms with OR semantics (live wins over removed on the same row)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: {
      Brand: 'Acme',
      'TP Review Status': 'Removed', 'Trust Pilot': '2026-05-05',
      'CG Review Status': 'Published', 'Casino Guru review added': '2026-05-05',
    } },
  ];
  const out = performanceReport(entries, ['tp', 'cg'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.brands[0].live, 1);
  assertEquals(out.brands[0].removed, 0);
});

Deno.test('performanceReport with no matching rows returns empty totals/brands, not an error', () => {
  const out = performanceReport([], ['tp'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.totals, { live: 0, removed: 0, successRate: null, entries: 0 });
  assertEquals(out.brands, []);
});

Deno.test('get_performance_report requires date_from and date_to', async () => {
  const result: any = await runTool(mockSupabaseTables({ entries: [] }), 'get_performance_report', { date_from: '2026-05-01' });
  assertEquals(result.error, 'Both date_from and date_to (YYYY-MM-DD) are required.');
});

Deno.test('get_performance_report end-to-end: tab-scoped, echoes period, excludes a paused tab and a removed-flagged brand', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-05-05' } },
      { id: '2', tab: 'Rooster Partners', data: { Brand: 'Beta', 'Review Status': 'Removed', 'Trust Pilot': '2026-05-06' } },
      { id: '3', tab: 'Hanan', data: { Brand: 'Gamma', 'Review Status': 'Published', 'Trust Pilot': '2026-05-05' } },
    ],
    tab_archive_log: [],
    paused_tabs: [{ tab: 'Hanan' }],
    removed_platform_brands: [{ tab: 'Rooster Partners', brand: 'Beta', platform: 'tp' }],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_performance_report', {
    tab: 'Rooster Partners', date_from: '2026-05-01', date_to: '2026-05-31',
  });
  assertEquals(result.period, { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(result.brands.length, 1);
  assertEquals(result.brands[0].brand, 'Acme');
  assertEquals(result.totals.live, 1);
  assertEquals(result.totals.removed, 0);
});
