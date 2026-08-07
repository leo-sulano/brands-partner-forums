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
  fetchFlaggedPlatformBrands,
  fetchBrandPlatformOverrides,
} from './queries';

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
});
