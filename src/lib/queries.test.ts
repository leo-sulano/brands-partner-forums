import { describe, it, expect, vi, beforeEach } from 'vitest';

const { singletonFrom } = vi.hoisted(() => ({ singletonFrom: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: { from: singletonFrom },
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
} from './queries';
import { computeTabSuccessRates } from './scoreSummary.ts';
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
});
