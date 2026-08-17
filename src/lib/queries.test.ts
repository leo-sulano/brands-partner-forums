import { describe, it, expect, vi, beforeEach } from 'vitest';

const { singletonFrom } = vi.hoisted(() => ({ singletonFrom: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: {
    from: singletonFrom,
    // setBrandPlatformOverride (unlike the fetch* functions above) always
    // goes through the singleton and calls currentUserEmail() ->
    // supabase.auth.getSession() internally -- stub it out so those tests
    // don't throw on an undefined `.auth`.
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
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  bulkUpsertBrandSchedule,
  computeTabKpisFromEntries,
  computeBrandKpisFromEntries,
  fetchBrandPlatformOverrides,
  setBrandPlatformOverride,
  clearBrandPlatformOverride,
  saveReviewAnalysis,
} from './queries';
import { computeTabSuccessRates } from './scoreSummary.ts';
import { platformRemovedKey } from './removedPlatformBrands.ts';
import type { Entry } from '../types/entry.ts';
import type { ReviewRemovalAssessmentResult } from './reviewRemovalAssessment.ts';

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

  it('fetchRemovedPlatformBrands selects removed_at alongside tab/brand/platform', async () => {
    const selectSpy = vi.fn().mockReturnValue({
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
    });
    const fakeFrom = vi.fn().mockReturnValue({ select: selectSpy });
    await fetchRemovedPlatformBrands({ from: fakeFrom } as any);
    expect(selectSpy).toHaveBeenCalledWith('tab, brand, platform, removed_at');
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

  it('fetchBrandPlatformOverrides uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({ data: [], error: null }));
    await fetchBrandPlatformOverrides('X', { from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('brand_platform_override');
    expect(singletonFrom).not.toHaveBeenCalled();
  });

  it('fetchScheduleHiddenBrands uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({ data: [], error: null }));
    await fetchScheduleHiddenBrands('X', { from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('schedule_hidden_brands');
    expect(singletonFrom).not.toHaveBeenCalled();
  });

  it('fetchScheduleHiddenBrands falls back to the singleton when no client is passed', async () => {
    singletonFrom.mockReturnValue(chain({ data: [], error: null }));
    await fetchScheduleHiddenBrands('X');
    expect(singletonFrom).toHaveBeenCalledWith('schedule_hidden_brands');
  });

  it('fetchScheduleRestrictedBrands uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({
      data: [{ tab: 'X', brand: 'GOC', allowed_platform: 'ag' }],
      error: null,
    }));
    const rows = await fetchScheduleRestrictedBrands('X', { from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('schedule_platform_restrictions');
    expect(singletonFrom).not.toHaveBeenCalled();
    expect(rows).toEqual([{ tab: 'X', brand: 'GOC', allowed_platform: 'ag' }]);
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
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.tp).toEqual({ live: 1, removed: 0 });
    expect(kpis).toMatchObject({ live: 1, removed: 0, total: 1 });
  });

  it('always counts a Removed row with no TP date at all, regardless of the selected range (regression: previously dropped entirely)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': null, 'TP Review Status': 'Removed' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
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
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;

    const rates = computeTabSuccessRates(
      entries.map((e) => ({ tab: e.tab, data: e.data })) as Parameters<typeof computeTabSuccessRates>[0],
      ['tp'],
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

  it('agrees with Score Summary\'s computeTabSuccessRates on the same entries, MULTIPLE platforms, and range', () => {
    const rawHeadersMulti = ['Brands', 'Trust Pilot', 'TP Review Status', 'Casino Guru review added', 'CG Review Status'];
    const entries = [
      { id: '1', tab: 'Rooster Partners', sheet_row_id: '1', data: {
        Brands: 'BrandX',
        'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed',
        'Casino Guru review added': '10/06/2026', 'CG Review Status': 'Published',
      }, updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard' as const, last_sync_tag: null },
    ];

    const kpis = computeTabKpisFromEntries(entries, rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, ['tp', 'cg'])!;

    const rates = computeTabSuccessRates(
      entries.map((e) => ({ tab: e.tab, data: e.data })) as unknown as Parameters<typeof computeTabSuccessRates>[0],
      ['tp', 'cg'],
      new Set(),
      { from: new Date(2026, 4, 1), to: new Date(2026, 6, 31) },
    );
    const scoreSummaryRate = rates.get('Rooster Partners') ?? { live: 0, removed: 0 };

    expect(kpis.live).toBe(scoreSummaryRate.live);
    expect(kpis.removed).toBe(scoreSummaryRate.removed);
  });

  it('excludes a platform-flagged brand from the tab-level aggregate too, matching that platform\'s own breakdown (a flagged status is unreliable everywhere it feeds, not just its own tile)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Flagged Brand', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed' }),
    ];
    const flagged = new Set([platformRemovedKey('TP Affiliate', 'Flagged Brand', 'tp')]);
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', flagged)!;
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
    const kpis = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set())!;
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
    const kpis = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', flagged)!;
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
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), ['Germany'])!;
    expect(kpis.live).toBe(2);
    expect(kpis.removed).toBe(0);
  });

  it('proxyFilter narrows results to only entries whose Proxy Used matches, case-insensitively and trimmed', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': ' Enigma-US1 ' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'enigma-us1' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': 'Enigma-US2' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, ['Enigma-US1'])!;
    expect(kpis.live).toBe(2);
    expect(kpis.removed).toBe(0);
  });

  it('countryFilter and proxyFilter compose (AND), same as with dateFrom/dateTo', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany', 'Proxy Used': 'Enigma-US2' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France', 'Proxy Used': 'Enigma-US1' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), ['Germany'], ['Enigma-US1'])!;
    expect(kpis.live).toBe(1);
  });

  it('byCountry buckets live/removed per country case-insensitively, keyed by canonical ISO2 with the canonical display name as label', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'germany' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byCountry).toEqual({ DE: { label: 'Germany', live: 1, removed: 1 } });
    expect(kpis.live).toBe(1);
    expect(kpis.removed).toBe(1);
  });

  it('buckets an entry with no resolvable Country under a literal "Unknown" bucket instead of silently excluding it (regression: previously dropped from byCountry entirely)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': '' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': '' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byCountry).toEqual({ unknown: { label: 'Unknown', live: 1, removed: 1 } });
    expect(kpis.countries).toEqual(['Unknown']);
  });

  it('countryFilter set to "Unknown" matches entries with no resolvable Country', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': '' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), ['Unknown'])!;
    expect(kpis.live).toBe(1);
  });

  it('byCountry merges every recognized spelling of the same real country onto one bucket (regression: UK and United Kingdom previously split into two cards)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'UK' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'United Kingdom' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'England' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byCountry).toEqual({ GB: { label: 'United Kingdom', live: 2, removed: 1 } });
    expect(kpis.countries).toEqual(['United Kingdom']);
  });

  it('countryFilter set to one spelling matches entries recorded under any other alias of the same country', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'UK' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), ['United Kingdom'])!;
    expect(kpis.live).toBe(1);
  });

  it('byProxy buckets a blank Proxy Used value under a literal "No Proxy" bucket instead of skipping it (regression: previously excluded from byProxy entirely)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': '' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byProxy).toEqual({
      'enigma-us1': { label: 'Enigma-US1', live: 1, removed: 0 },
      'no proxy': { label: 'No Proxy', live: 0, removed: 1 },
    });
  });

  it('byProxy and proxies fold a redacted "*****" Proxy Used value into "No Proxy", same as blank', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': '*****' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byProxy).toEqual({
      'enigma-us1': { label: 'Enigma-US1', live: 1, removed: 0 },
      'no proxy': { label: 'No Proxy', live: 0, removed: 1 },
    });
    expect(kpis.proxies).toEqual(['Enigma-US1', 'No Proxy']);
  });

  it('countries and proxies distinct lists are built from unfiltered entries, independent of any active country/proxy filter', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'France', 'Proxy Used': 'Enigma-US2' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), ['Germany'])!;
    expect(kpis.countries).toEqual(['France', 'Germany']);
    expect(kpis.proxies).toEqual(['Enigma-US1', 'Enigma-US2']);
  });

  it('surfaces a never-seen Proxy Used value as its own identity rather than folding it into "No Proxy"', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': 'BrandNewProvider-7' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byProxy).toEqual({
      'enigma-us1': { label: 'Enigma-US1', live: 1, removed: 0 },
      'brandnewprovider-7': { label: 'BrandNewProvider-7', live: 0, removed: 1 },
    });
    expect(kpis.proxies).toEqual(['BrandNewProvider-7', 'Enigma-US1']);
  });

  it('proxyFilter set to "No Proxy" matches only blank and redacted entries, not a real (even never-seen) provider value', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': '' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': '*****' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'BrandNewProvider-7' }),
      entry('4', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, ['No Proxy'])!;
    expect(kpis.live).toBe(2);
  });

  it('returns null when platformFilter names a platform the tab has no column for', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
    ];
    // `rawHeaders` (line 123) has no CG column at all -- this tab structurally
    // can't track CasinoGuru.
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, ['cg']);
    expect(kpis).toBeNull();
  });

  it('platformFilter scopes live/removed/total to only that platform, ignoring other platforms on the same row', () => {
    const rawHeadersMulti = ['Brands', 'Trust Pilot', 'TP Review Status', 'Casino Guru review added', 'CG Review Status'];
    const multiEntry = {
      id: '1', tab: 'Rooster Partners', sheet_row_id: '1',
      data: {
        'Brands': 'Multi Brand',
        'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed',
        'Casino Guru review added': '15/06/2026', 'CG Review Status': 'Published',
      },
      updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard' as const, last_sync_tag: null,
    };

    // No filter: today's existing OR-across-platforms aggregate counts the
    // row once as live, because CG's live status wins over TP's removed
    // status on the same row -- this is the exact ambiguity the filter
    // exists to resolve.
    const unfiltered = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set());
    expect(unfiltered).not.toBeNull();
    expect(unfiltered!.live).toBe(1);
    expect(unfiltered!.removed).toBe(0);

    // Filtered to TP only: the row's true TP status (Removed) surfaces.
    const tpOnly = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, ['tp']);
    expect(tpOnly).not.toBeNull();
    expect(tpOnly!.live).toBe(0);
    expect(tpOnly!.removed).toBe(1);
    expect(tpOnly!.total).toBe(1);

    // Filtered to CG only: the row's true CG status (Published/live) surfaces.
    const cgOnly = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, ['cg']);
    expect(cgOnly).not.toBeNull();
    expect(cgOnly!.live).toBe(1);
    expect(cgOnly!.removed).toBe(0);
    expect(cgOnly!.total).toBe(1);
  });

  it('platformFilter scopes byCountry/byProxy to only rows that have a value on that platform', () => {
    const rawHeadersMulti = ['Brands', 'Trust Pilot', 'TP Review Status', 'Casino Guru review added', 'CG Review Status', 'Country'];
    const entries: Entry[] = [
      {
        id: '1', tab: 'Rooster Partners', sheet_row_id: '1',
        data: { 'Brands': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'Germany' },
        updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard' as const, last_sync_tag: null,
      },
      {
        id: '2', tab: 'Rooster Partners', sheet_row_id: '2',
        data: { 'Brands': 'B', 'Casino Guru review added': '15/06/2026', 'CG Review Status': 'Published', 'Country': 'France' },
        updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard' as const, last_sync_tag: null,
      },
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, ['cg']);
    expect(kpis).not.toBeNull();
    // Only entry 2 (France) has a CG value -- entry 1 (Germany) is TP-only
    // and must not appear in a CG-scoped breakdown at all.
    expect(kpis!.byCountry).toEqual({ FR: { label: 'France', live: 1, removed: 0 } });
    expect(kpis!.live).toBe(1);
    expect(kpis!.removed).toBe(0);
  });

  it('platformFilter still respects the per-platform removed-brand flag', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Flagged Brand', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed' }),
    ];
    const flagged = new Set([platformRemovedKey('TP Affiliate', 'Flagged Brand', 'tp')]);
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', flagged, undefined, undefined, ['tp']);
    expect(kpis).not.toBeNull();
    expect(kpis!.live).toBe(0);
    expect(kpis!.removed).toBe(0);
  });

  it('platformFilter with 2 platforms combines their live/removed into one total (combined-total semantics)', () => {
    const rawHeadersMulti = ['Brands', 'Trust Pilot', 'TP Review Status', 'Casino Guru review added', 'CG Review Status'];
    const multiEntry = {
      id: '1', tab: 'Rooster Partners', sheet_row_id: '1',
      data: {
        Brands: 'BrandX',
        'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed',
        'Casino Guru review added': '10/06/2026', 'CG Review Status': 'Published',
      },
      updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard' as const, last_sync_tag: null,
    };
    const kpis = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, ['tp', 'cg']);
    expect(kpis).not.toBeNull();
    // TP is Removed and CG is Published/live on the same row — statuses.some(isLiveStatus)
    // is checked before statuses.some(isRemovedStatus), so a row with a decided outcome on
    // both counts as live once, not once for each platform and not as removed.
    expect(kpis!.live).toBe(1);
    expect(kpis!.removed).toBe(0);
    expect(kpis!.tp).toEqual({ live: 0, removed: 1 });
    expect(kpis!.cg).toEqual({ live: 1, removed: 0 });
  });

  it('a tab is included when it tracks at least one of 2 selected platforms, scoped to only the tracked one', () => {
    const kpis = computeTabKpisFromEntries(
      [entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' })],
      rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, ['tp', 'cg'],
    );
    expect(kpis).not.toBeNull();
    expect(kpis!.live).toBe(1);
  });

  it('countryFilter with 2 values matches either (OR)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Spain' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), ['Germany', 'France'])!;
    expect(kpis.live).toBe(2);
  });

  it('an empty platformFilter array behaves identically to omitting it entirely (regression lock)', () => {
    const entries = [entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' })];
    const omitted = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    const empty = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, []);
    expect(empty).toEqual(omitted);
  });
});

describe('computeBrandKpisFromEntries', () => {
  const rawHeaders = ['URL PAGE', 'Trust Pilot', 'TP Review Status'];

  it('buckets entries by brand and sums per-brand totals back to the same numbers computeTabKpisFromEntries reports for the whole tab', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Brand A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
      entry('2', { 'URL PAGE': 'Brand A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed' }),
      entry('3', { 'URL PAGE': 'Brand B', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
    ];
    const perBrand = computeBrandKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    const tabTotal = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;

    expect(perBrand).toHaveLength(2);
    const brandA = perBrand.find((b) => b.brand === 'Brand A')!;
    const brandB = perBrand.find((b) => b.brand === 'Brand B')!;
    expect(brandA.kpis.tp).toEqual({ live: 1, removed: 1 });
    expect(brandB.kpis.tp).toEqual({ live: 1, removed: 0 });

    const summedLive = perBrand.reduce((s, b) => s + b.kpis.live, 0);
    const summedRemoved = perBrand.reduce((s, b) => s + b.kpis.removed, 0);
    expect(summedLive).toBe(tabTotal.live);
    expect(summedRemoved).toBe(tabTotal.removed);
  });

  it('groups brand names case/whitespace-insensitively, keeping the first-seen casing as the label', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
      entry('2', { 'URL PAGE': ' aussie online pokies ', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed' }),
    ];
    const perBrand = computeBrandKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(perBrand).toHaveLength(1);
    expect(perBrand[0].brand).toBe('Aussie Online Pokies');
    expect(perBrand[0].kpis.tp).toEqual({ live: 1, removed: 1 });
  });

  it('drops a brand entirely from the Brands view when every platform it tracks is page-flagged removed (nothing left to show)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Flagged Brand', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed' }),
      entry('2', { 'URL PAGE': 'Other Brand', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
    ];
    const flagged = new Set([platformRemovedKey('TP Affiliate', 'Flagged Brand', 'tp')]);
    const perBrand = computeBrandKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', flagged);
    expect(perBrand.find((b) => b.brand === 'Flagged Brand')).toBeUndefined();
    expect(perBrand.find((b) => b.brand === 'Other Brand')).toBeDefined();
  });

  it('keeps a brand visible with only its flagged platform\'s row hidden when it tracks other, unflagged platforms', () => {
    const rawHeadersMulti = ['Brands', 'Trust Pilot', 'TP Review Status', 'Casino Guru review added', 'CG Review Status'];
    const entries = [
      { id: '1', tab: 'Rooster Partners', sheet_row_id: '1', data: {
        Brands: 'Multi Brand',
        'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed',
        'Casino Guru review added': '10/06/2026', 'CG Review Status': 'Published',
      }, updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard' as const, last_sync_tag: null },
    ];
    const flagged = new Set([platformRemovedKey('Rooster Partners', 'Multi Brand', 'tp')]);
    const perBrand = computeBrandKpisFromEntries(entries, rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', flagged);
    const brand = perBrand.find((b) => b.brand === 'Multi Brand')!;
    expect(brand).toBeDefined();
    expect(brand.kpis.activePlatforms).toEqual(['cg']);
    expect(brand.kpis.cg).toEqual({ live: 1, removed: 0 });
  });

  it('skips rows with a blank brand name', () => {
    const entries = [entry('1', { 'URL PAGE': '', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' })];
    const perBrand = computeBrandKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(perBrand).toHaveLength(0);
  });

  it('returns an empty array when the tab tracks none of the selected platforms (mirrors computeTabKpisFromEntries returning null)', () => {
    const entries = [entry('1', { 'URL PAGE': 'Brand A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' })];
    const perBrand = computeBrandKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, ['ag']);
    expect(perBrand).toEqual([]);
  });

  it('sorts brands alphabetically', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Zebra Casino', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
      entry('2', { 'URL PAGE': 'Alpha Casino', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
    ];
    const perBrand = computeBrandKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(perBrand.map((b) => b.brand)).toEqual(['Alpha Casino', 'Zebra Casino']);
  });
});

const SAMPLE_ANALYSIS = { overall_result: 'no_clear_removal_reason' } as unknown as ReviewRemovalAssessmentResult;

describe('saveReviewAnalysis', () => {
  it('updates the 4 analysis columns for the given entry id', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    singletonFrom.mockReturnValue({ update });

    await saveReviewAnalysis('entry-1', 'Rooster Partners', SAMPLE_ANALYSIS, 'hash-abc', 'gpt-4o');

    expect(singletonFrom).toHaveBeenCalledWith('entries');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      ai_review_analysis: SAMPLE_ANALYSIS,
      ai_review_analysis_hash: 'hash-abc',
      ai_review_analysis_model: 'gpt-4o',
    }));
    expect(eq).toHaveBeenCalledWith('id', 'entry-1');
  });

  it('throws if the update fails', async () => {
    const eq = vi.fn().mockResolvedValue({ error: new Error('db down') });
    const update = vi.fn().mockReturnValue({ eq });
    singletonFrom.mockReturnValue({ update });

    await expect(saveReviewAnalysis('entry-1', 'Rooster Partners', SAMPLE_ANALYSIS, 'hash-abc', 'gpt-4o'))
      .rejects.toThrow('db down');
  });
});
