import { describe, it, expect } from 'vitest';
import { deriveTabPausedBrandRows } from './tabPausedBrands';

const brandByKey = new Map([
  ['winmega', 'WinMega'],
  ['pribet.com', 'Pribet.com'],
  ['spinjo', 'Spinjo'],
]);
const allEligible = () => true;

describe('deriveTabPausedBrandRows', () => {
  it('keeps only override_state === "pause" rows', () => {
    const rows = deriveTabPausedBrandRows(
      [
        { brand_key: 'winmega', platform: 'tp', override_state: 'pause', reason: 'Break', resume_at: '2026-10-05', set_by: 'leo@x.com' },
        { brand_key: 'pribet.com', platform: 'ag', override_state: 'active', reason: null, resume_at: null, set_by: null },
      ],
      brandByKey,
      allEligible,
    );
    expect(rows).toEqual([
      { brand: 'WinMega', brandKey: 'winmega', platform: 'tp', reason: 'Break', resumeAt: '2026-10-05', setBy: 'leo@x.com' },
    ]);
  });

  it('drops combos the eligible predicate rejects', () => {
    const rows = deriveTabPausedBrandRows(
      [
        { brand_key: 'winmega', platform: 'tp', override_state: 'pause', reason: 'a', resume_at: null, set_by: null },
        { brand_key: 'winmega', platform: 'ag', override_state: 'pause', reason: 'b', resume_at: null, set_by: null },
      ],
      brandByKey,
      (_bk, p) => p === 'tp',
    );
    expect(rows.map((r) => r.platform)).toEqual(['tp']);
  });

  it('maps null reason to "" and absent resume_at to null (permanent)', () => {
    const [row] = deriveTabPausedBrandRows(
      [{ brand_key: 'spinjo', platform: 'cg', override_state: 'pause', reason: null, resume_at: null, set_by: null }],
      brandByKey,
      allEligible,
    );
    expect(row.reason).toBe('');
    expect(row.resumeAt).toBeNull();
  });

  it('falls back to brand_key when the display name is unknown', () => {
    const [row] = deriveTabPausedBrandRows(
      [{ brand_key: 'ghostbrand', platform: 'tp', override_state: 'pause', reason: 'x', resume_at: null, set_by: null }],
      brandByKey,
      allEligible,
    );
    expect(row.brand).toBe('ghostbrand');
  });

  it('sorts by brand then platform for stable display', () => {
    const rows = deriveTabPausedBrandRows(
      [
        { brand_key: 'spinjo', platform: 'tp', override_state: 'pause', reason: 'x', resume_at: null, set_by: null },
        { brand_key: 'winmega', platform: 'ag', override_state: 'pause', reason: 'x', resume_at: null, set_by: null },
        { brand_key: 'winmega', platform: 'tp', override_state: 'pause', reason: 'x', resume_at: null, set_by: null },
      ],
      brandByKey,
      allEligible,
    );
    expect(rows.map((r) => `${r.brand}/${r.platform}`)).toEqual([
      'Spinjo/tp', 'WinMega/ag', 'WinMega/tp',
    ]);
  });
});
