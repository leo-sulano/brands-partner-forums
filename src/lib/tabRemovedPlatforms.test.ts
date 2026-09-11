import { describe, it, expect } from 'vitest';
import { deriveTabRemovedPlatformRows, deriveTabRemovedCustomPlatformRows } from './tabRemovedPlatforms';

describe('deriveTabRemovedPlatformRows', () => {
  it('maps every row through with brand/platform/removedAt/removedBy', () => {
    const rows = deriveTabRemovedPlatformRows([
      { brand: 'WinMega', platform: 'tp', removed_at: '2026-08-01', removed_by: 'leo@x.com' },
    ]);
    expect(rows).toEqual([
      { brand: 'WinMega', platform: 'tp', removedAt: '2026-08-01', removedBy: 'leo@x.com' },
    ]);
  });

  it('carries a null removed_by through unchanged', () => {
    const [row] = deriveTabRemovedPlatformRows([
      { brand: 'WinMega', platform: 'tp', removed_at: '2026-08-01', removed_by: null },
    ]);
    expect(row.removedBy).toBeNull();
  });

  it('sorts by brand then platform for stable display', () => {
    const rows = deriveTabRemovedPlatformRows([
      { brand: 'WinMega', platform: 'ag', removed_at: '2026-08-01', removed_by: null },
      { brand: 'Pribet.com', platform: 'tp', removed_at: '2026-08-01', removed_by: null },
      { brand: 'WinMega', platform: 'tp', removed_at: '2026-08-01', removed_by: null },
    ]);
    expect(rows.map((r) => `${r.brand}/${r.platform}`)).toEqual([
      'Pribet.com/tp', 'WinMega/ag', 'WinMega/tp',
    ]);
  });

  it('does not filter anything out — every row for the tab is shown', () => {
    const rows = deriveTabRemovedPlatformRows([
      { brand: 'A', platform: 'tp', removed_at: '2026-08-01', removed_by: null },
      { brand: 'B', platform: 'ag', removed_at: '2026-08-01', removed_by: null },
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe('deriveTabRemovedCustomPlatformRows', () => {
  it('shapes and sorts rows by brand then platform id', () => {
    const rows = deriveTabRemovedCustomPlatformRows([
      { brand: 'Zeta Co', platform_id: 'p1', removed_at: '2026-09-01', removed_by: 'a@x.com' },
      { brand: 'Alpha Co', platform_id: 'p2', removed_at: '2026-09-02', removed_by: null },
    ]);
    expect(rows).toEqual([
      { brand: 'Alpha Co', platformId: 'p2', removedAt: '2026-09-02', removedBy: null },
      { brand: 'Zeta Co', platformId: 'p1', removedAt: '2026-09-01', removedBy: 'a@x.com' },
    ]);
  });
});
