// supabase/functions/ai-assistant/tools_test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  pick,
  parseScore,
  mapEntrySummary,
  entryMatches,
  matchesStatus,
  scoreSummary,
  redactSensitive,
  runTool,
  successRateByField,
  ratingLabel,
  EntryRow,
} from './tools.ts';

Deno.test('pick falls through key variants and skips blanks', () => {
  assertEquals(pick({ 'Brand': '', 'Brands': 'Acme' }, ['Brand', 'Brands']), 'Acme');
  assertEquals(pick({}, ['Brand']), null);
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
  const out = scoreSummary(entries);
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

function mockSupabase(rows: EntryRow[]) {
  return {
    from(_table: string) {
      let filtered = rows;
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
  const out = successRateByField(entries, 'agent');
  const ann = out.find((r) => r.value === 'ANN')!;
  assertEquals(ann.live, 1);
  assertEquals(ann.removed, 0);
  assertEquals(ann.total, 1);
});

Deno.test('successRateByField picks up AG Review Status and CG Review Status (multi-platform tabs)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 'Rooster Partners', data: { Agent: 'ANN', 'AG Review Status': 'Published' } },
    { id: '2', tab: 'Rooster Partners', data: { Agent: 'BOB', 'CG Review Status': 'Removed' } },
  ];
  const out = successRateByField(entries, 'agent');
  const ann = out.find((r) => r.value === 'ANN')!;
  const bob = out.find((r) => r.value === 'BOB')!;
  assertEquals(ann.live, 1);
  assertEquals(ann.total, 1);
  assertEquals(bob.removed, 1);
  assertEquals(bob.total, 1);
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
  const out = scoreSummary(entries, 'ag');
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
  const out = scoreSummary(entries);
  assertEquals(out.length, 1);
  assertEquals(out[0].rated, 0);
  assertEquals(out[0].average, null);
  assertEquals(out[0].live, 0);
  assertEquals(out[0].removed, 2);
  assertEquals(out[0].successRate, 0);
});

Deno.test('get_score_summary defaults to tp platform when given an invalid value', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'C', 'Review Status': 'Published', 'Score added': '3' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'get_score_summary', { platform: 'not-a-real-platform' });
  assertEquals(result.brands.length, 1);
  assertEquals(result.brands[0].average, 3);
});
