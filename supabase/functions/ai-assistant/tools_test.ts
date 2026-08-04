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
