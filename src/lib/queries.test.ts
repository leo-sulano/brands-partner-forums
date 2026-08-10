import { describe, it, expect, vi, beforeEach } from 'vitest';

const { singletonFrom } = vi.hoisted(() => ({ singletonFrom: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: {
    from: singletonFrom,
    // setBrandPlatformFlagged/setBrandPlatformOverride (unlike the fetch*
    // functions above) always go through the singleton and call
    // currentUserEmail() -> supabase.auth.getSession() internally -- stub it
    // out so those tests don't throw on an undefined `.auth`.
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
  SUPABASE_ANON_KEY: '',
  CHECK_STATUS_URL: '',
  CHECK_STATUS_BASE_URL: '',
  CHECK_STATUS_TOKEN: '',
  CHECK_AG_STATUS_URL: '',
  CHECK_AG_STATUS_BASE_URL: '',
}));

import {
  fetchBrandSchedule,
  fetchActiveBrandPlatformPauses,
  fetchRemovedPlatformBrands,
  bulkUpsertBrandSchedule,
  computeTabKpisFromEntries,
  fetchFlaggedPlatformBrands,
  fetchBrandPlatformOverrides,
  setBrandPlatformFlagged,
  setBrandPlatformOverride,
  clearBrandPlatformOverride,
} from './queries';
import { computeTabSuccessRates } from './scoreSummary.ts';
import { platformRemovedKey } from './removedPlatformBrands.ts';
import type { Entry } from '../types/entry.ts';

// Minimal fake of Supabase's thenable PostgrestFilterBuilder: every filter
// method returns the same builder, and awaiting it anywhere in the chain
// resolves via .then() to the fixed result.
function chain(result: { data: unknown; error: null }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve(result),
  };
  return builder;
}

describe('queries.ts injectable Supabase client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchBrandSchedule uses the passed-in client, not the singleton', async () => {
    singletonFrom.mockReturnValue(chain({ data: [], error: null }));
    const fakeFrom = vi.fn().mockReturnValue(chain({
      data: [{ tab: 'X', brand_key: 'y', week_start: '2026-08-10', platform: 'tp', monday: null, tuesday: null, wednesday: null, thursday: null, friday: null }],
      error: null,
    }));
    const fakeClient = { from: fakeFrom } as any;

    const rows = await fetchBrandSchedule('X', '2026-08-10', fakeClient);

    expect(fakeFrom).toHaveBeenCalledWith('brand_schedule');
    expect(singletonFrom).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it('fetchActiveBrandPlatformPauses falls back to the singleton when no client is passed', async () => {
    singletonFrom.mockReturnValue(chain({ data: [], error: null }));
    await fetchActiveBrandPlatformPauses('X');
    expect(singletonFrom).toHaveBeenCalledWith('brand_platform_pause');
  });

  it('fetchRemovedPlatformBrands uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({ data: [], error: null }));
    await fetchRemovedPlatformBrands({ from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('removed_platform_brands');
    expect(singletonFrom).not.toHaveBeenCalled();
  });

  it('bulkUpsertBrandSchedule uses the passed-in client for the upsert', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const fakeFrom = vi.fn().mockReturnValue({ upsert });
    await bulkUpsertBrandSchedule(
      [{ tab: 'X', brand: 'Y', week_start: '2026-08-10', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null }],
      { from: fakeFrom } as any,
    );
    expect(fakeFrom).toHaveBeenCalledWith('brand_schedule');
    expect(upsert).toHaveBeenCalled();
    expect(singletonFrom).not.toHaveBeenCalled();
  });

  it('fetchFlaggedPlatformBrands uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({ data: [], error: null }));
    await fetchFlaggedPlatformBrands({ from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('flagged_platform_brands');
    expect(singletonFrom).not.toHaveBeenCalled();
  });

  it('fetchBrandPlatformOverrides uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({ data: [], error: null }));
    await fetchBrandPlatformOverrides('X', { from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('brand_platform_override');
    expect(singletonFrom).not.toHaveBeenCalled();
  });

  it('setBrandPlatformFlagged upserts into flagged_platform_brands when flagged=true', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    singletonFrom.mockReturnValue({ upsert });
    await setBrandPlatformFlagged('X', 'WinMega', 'tp', true);
    expect(singletonFrom).toHaveBeenCalledWith('flagged_platform_brands');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'X', brand: 'WinMega', platform: 'tp' }),
      { onConflict: 'tab,brand_key,platform' },
    );
  });

  it('setBrandPlatformFlagged deletes from flagged_platform_brands when flagged=false', async () => {
    const chainObj: any = { delete: () => chainObj, eq: () => chainObj, then: (resolve: any) => resolve({ error: null }) };
    singletonFrom.mockReturnValue(chainObj);
    await setBrandPlatformFlagged('X', 'WinMega', 'tp', false);
    expect(singletonFrom).toHaveBeenCalledWith('flagged_platform_brands');
  });

  it('setBrandPlatformOverride upserts into brand_platform_override', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    singletonFrom.mockReturnValue({ upsert });
    await setBrandPlatformOverride('X', 'WinMega', 'tp', 'pause');
    expect(singletonFrom).toHaveBeenCalledWith('brand_platform_override');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'X', brand: 'WinMega', platform: 'tp', override_state: 'pause' }),
      { onConflict: 'tab,brand_key,platform' },
    );
  });

  it('clearBrandPlatformOverride deletes from brand_platform_override', async () => {
    const chainObj: any = { delete: () => chainObj, eq: () => chainObj, then: (resolve: any) => resolve({ error: null }) };
    singletonFrom.mockReturnValue(chainObj);
    await clearBrandPlatformOverride('X', 'winmega', 'tp');
    expect(singletonFrom).toHaveBeenCalledWith('brand_platform_override');
  });
});

function entry(id: string, data: Record<string, string | null>): Entry {
  return { id, tab: 'TP Affiliate', sheet_row_id: id, data, updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard', last_sync_tag: null };
}

describe('computeTabKpisFromEntries', () => {
  const rawHeaders = ['URL PAGE', 'Trust Pilot', 'TP Review Status'];

  it('excludes a row whose TP date falls outside the range, and includes one whose TP date falls inside it', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
      entry('2', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '10/01/2026', 'TP Review Status': 'Removed' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(kpis.tp).toEqual({ live: 1, removed: 0 });
    expect(kpis).toMatchObject({ live: 1, removed: 0, total: 1 });
  });

  it('always counts a Removed row with no TP date at all, regardless of the selected range (regression: previously dropped entirely)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': null, 'TP Review Status': 'Removed' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(kpis.tp).toEqual({ live: 0, removed: 1 });
    expect(kpis.removed).toBe(1);
  });

  it('agrees with Score Summary\'s computeTabSuccessRates on the same entries, platform, and range', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
      entry('2', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '10/01/2026', 'TP Review Status': 'Removed' }),
      entry('3', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': null, 'TP Review Status': 'Removed' }),
      entry('4', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '15/07/2026', 'TP Review Status': 'Live' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());

    const rates = computeTabSuccessRates(
      entries.map((e) => ({ tab: e.tab, data: e.data })) as Parameters<typeof computeTabSuccessRates>[0],
      'tp',
      new Set(),
      { from: new Date(2026, 4, 1), to: new Date(2026, 6, 31) },
    );
    const scoreSummaryTp = rates.get('TP Affiliate') ?? { live: 0, removed: 0 };

    // Entry 2's TP date (Jan) is genuinely outside the range, so both
    // implementations correctly exclude it — only entry 3 (undated) and
    // entries 1/4 (in-range) should count: live 2 (entries 1, 4), removed 1
    // (entry 3 only; entry 2 is excluded, not counted as removed).
    expect(kpis.tp).toEqual({ live: scoreSummaryTp.live, removed: scoreSummaryTp.removed });
    expect(kpis.tp).toEqual({ live: 2, removed: 1 });
  });

  it('excludes a platform-flagged brand from the tab-level aggregate too, matching that platform\'s own breakdown (a flagged status is unreliable everywhere it feeds, not just its own tile)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Flagged Brand', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed' }),
    ];
    const flagged = new Set([platformRemovedKey('TP Affiliate', 'Flagged Brand', 'tp')]);
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', flagged);
    expect(kpis.tp).toEqual({ live: 0, removed: 0 });
    expect(kpis.removed).toBe(0);
  });

  it('counts a multi-platform row in the aggregate via whichever platform is in range, even when another platform on the same row is out of range', () => {
    const rawHeadersMulti = ['Brands', 'Trust Pilot', 'TP Review Status', 'Casino Guru review added', 'CG Review Status'];
    const multiEntry = {
      id: '1', tab: 'Rooster Partners', sheet_row_id: '1',
      data: {
        'Brands': 'Multi Brand',
        'Trust Pilot': '10/01/2026', 'TP Review Status': 'Removed',
        'Casino Guru review added': '10/06/2026', 'CG Review Status': 'Published',
      },
      updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard' as const, last_sync_tag: null,
    };
    const kpis = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set());
    expect(kpis.tp).toEqual({ live: 0, removed: 0 });
    expect(kpis.cg).toEqual({ live: 1, removed: 0 });
    expect(kpis.live).toBe(1);
    expect(kpis.removed).toBe(0);
  });

  it('a multi-platform row still counts in the aggregate via an unflagged platform, even when another platform on the same row is flagged', () => {
    const rawHeadersMulti = ['Brands', 'Trust Pilot', 'TP Review Status', 'Casino Guru review added', 'CG Review Status'];
    const multiEntry = {
      id: '1', tab: 'Rooster Partners', sheet_row_id: '1',
      data: {
        'Brands': 'Multi Brand',
        'Trust Pilot': '10/01/2026', 'TP Review Status': 'Removed',
        'Casino Guru review added': '10/06/2026', 'CG Review Status': 'Published',
      },
      updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard' as const, last_sync_tag: null,
    };
    const flagged = new Set([platformRemovedKey('Rooster Partners', 'Multi Brand', 'tp')]);
    const kpis = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', flagged);
    expect(kpis.tp).toEqual({ live: 0, removed: 0 });
    expect(kpis.cg).toEqual({ live: 1, removed: 0 });
    expect(kpis.live).toBe(1);
    expect(kpis.removed).toBe(0);
  });

  it('countryFilter narrows results to only entries whose Country matches, case-insensitively', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'germany' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'France' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), 'Germany');
    expect(kpis.live).toBe(2);
    expect(kpis.removed).toBe(0);
  });

  it('proxyFilter narrows results to only entries whose Proxy Used matches, case-insensitively and trimmed', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': ' Enigma-US1 ' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'enigma-us1' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': 'Enigma-US2' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, 'Enigma-US1');
    expect(kpis.live).toBe(2);
    expect(kpis.removed).toBe(0);
  });

  it('countryFilter and proxyFilter compose (AND), same as with dateFrom/dateTo', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany', 'Proxy Used': 'Enigma-US2' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France', 'Proxy Used': 'Enigma-US1' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), 'Germany', 'Enigma-US1');
    expect(kpis.live).toBe(1);
  });

  it('byCountry buckets live/removed per country case-insensitively, keyed by canonical ISO2 with the canonical display name as label', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'germany' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(kpis.byCountry).toEqual({ DE: { label: 'Germany', live: 1, removed: 1 } });
    expect(kpis.live).toBe(1);
    expect(kpis.removed).toBe(1);
  });

  it('buckets an entry with no resolvable Country under a literal "Unknown" bucket instead of silently excluding it (regression: previously dropped from byCountry entirely)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': '' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': '' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(kpis.byCountry).toEqual({ unknown: { label: 'Unknown', live: 1, removed: 1 } });
    expect(kpis.countries).toEqual(['Unknown']);
  });

  it('countryFilter set to "Unknown" matches entries with no resolvable Country', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': '' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), 'Unknown');
    expect(kpis.live).toBe(1);
  });

  it('byCountry merges every recognized spelling of the same real country onto one bucket (regression: UK and United Kingdom previously split into two cards)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'UK' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'United Kingdom' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'England' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(kpis.byCountry).toEqual({ GB: { label: 'United Kingdom', live: 2, removed: 1 } });
    expect(kpis.countries).toEqual(['United Kingdom']);
  });

  it('countryFilter set to one spelling matches entries recorded under any other alias of the same country', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'UK' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), 'United Kingdom');
    expect(kpis.live).toBe(1);
  });

  it('byProxy buckets live/removed per proxy and skips entries with a blank Proxy Used value', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': '' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(kpis.byProxy).toEqual({ 'enigma-us1': { label: 'Enigma-US1', live: 1, removed: 0 } });
  });

  it('countries and proxies distinct lists are built from unfiltered entries, independent of any active country/proxy filter', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'France', 'Proxy Used': 'Enigma-US2' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), 'Germany');
    expect(kpis.countries).toEqual(['France', 'Germany']);
    expect(kpis.proxies).toEqual(['Enigma-US1', 'Enigma-US2']);
  });
});
