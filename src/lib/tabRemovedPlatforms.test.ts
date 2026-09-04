import { describe, it, expect } from 'vitest';
import { deriveTabRemovedPlatformRows } from './tabRemovedPlatforms';

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
