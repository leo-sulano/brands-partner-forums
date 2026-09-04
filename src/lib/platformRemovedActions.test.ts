import { describe, it, expect } from 'vitest';
import { savePlatformRemoved, deriveRemovedModalInitial } from './platformRemovedActions';
import { buildRemovedPlatformBrandSet, buildRemovedPlatformBrandDateMap, type Platform } from './removedPlatformBrands';

type Call = [string, ...unknown[]];

function fakeWriters(notifyImpl?: (payload: unknown) => Promise<void>) {
  const calls: Call[] = [];
  return {
    calls,
    writers: {
      setRemoved: async (...a: unknown[]) => { calls.push(['setRemoved', ...a]); },
      notify: async (payload: unknown) => {
        calls.push(['notify', payload]);
        if (notifyImpl) await notifyImpl(payload);
      },
      syncStatus: async (...a: unknown[]) => { calls.push(['syncStatus', ...a]); },
    } as never,
  };
}

const TAB = 'BITP';
const PLATS: Platform[] = ['tp', 'ag'];

function existing(rows: { tab: string; brand: string; platform: Platform; removed_at: string }[]) {
  return {
    existingSet: buildRemovedPlatformBrandSet(rows),
    existingDateMap: buildRemovedPlatformBrandDateMap(rows),
  };
}

describe('savePlatformRemoved', () => {
  it('flags a newly-checked platform removed and notifies + syncs status', async () => {
    const { calls, writers } = fakeWriters();
    const result = await savePlatformRemoved({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: ['tp'],
      dateTexts: {}, ...existing([]),
    }, writers);
    expect(calls[0]).toEqual(['setRemoved', TAB, 'Brand X', 'tp', true, undefined]);
    expect(calls[1][0]).toBe('notify');
    expect(calls[2]).toEqual(['syncStatus', TAB]);
    expect(result.notifyFailures).toEqual([]);
  });

  it('parses a typed date into the removed_at ISO string passed to setRemoved', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformRemoved({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: ['tp'],
      dateTexts: { tp: '05/09/2026' }, ...existing([]),
    }, writers);
    expect(calls[0]).toEqual(['setRemoved', TAB, 'Brand X', 'tp', true, '2026-09-05']);
  });

  it('does not re-write an unchanged existing flag with the same displayed date', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformRemoved({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: ['tp'],
      dateTexts: { tp: '05/09/2026' },
      ...existing([{ tab: TAB, brand: 'Brand X', platform: 'tp', removed_at: '2026-09-05' }]),
    }, writers);
    expect(calls).toEqual([]);
  });

  it('re-writes when only the date changed while staying checked, without notifying', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformRemoved({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: ['tp'],
      dateTexts: { tp: '10/09/2026' },
      ...existing([{ tab: TAB, brand: 'Brand X', platform: 'tp', removed_at: '2026-09-05' }]),
    }, writers);
    expect(calls).toEqual([['setRemoved', TAB, 'Brand X', 'tp', true, '2026-09-10']]);
  });

  it('unchecking a flagged platform clears it with no notify/sync', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformRemoved({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: [],
      dateTexts: {},
      ...existing([{ tab: TAB, brand: 'Brand X', platform: 'tp', removed_at: '2026-09-05' }]),
    }, writers);
    expect(calls).toEqual([['setRemoved', TAB, 'Brand X', 'tp', false, undefined]]);
  });

  it('ignores platforms outside eligiblePlatforms', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformRemoved({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: ['tp'], checkedPlatforms: ['ag'],
      dateTexts: {}, ...existing([]),
    }, writers);
    expect(calls).toEqual([]);
  });

  it('diffs against lookupTab (the original tab) while writing to tab (the moved-to tab)', async () => {
    // Mirrors BrandGroup.tsx's Edit Entry save: a brand moved to a new tab in
    // the same save that also (re-)flags a platform removed — the checkbox
    // reflected the brand's state on its ORIGINAL tab, so a flag that was
    // already set there must not be treated as newly-removed on the new tab.
    const { calls, writers } = fakeWriters();
    await savePlatformRemoved({
      tab: 'NEW_TAB', lookupTab: 'OLD_TAB', brand: 'Brand X', eligiblePlatforms: PLATS,
      checkedPlatforms: ['tp'], dateTexts: {},
      ...existing([{ tab: 'OLD_TAB', brand: 'Brand X', platform: 'tp', removed_at: '2026-09-05' }]),
    }, writers);
    expect(calls).toEqual([]);
  });

  it('records a notify failure but still keeps the flag write and fires the status sync', async () => {
    const { calls, writers } = fakeWriters(async () => { throw new Error('email down'); });
    const result = await savePlatformRemoved({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: ['tp'],
      dateTexts: {}, ...existing([]),
    }, writers);
    expect(calls.map((c) => c[0])).toEqual(['setRemoved', 'notify', 'syncStatus']);
    expect(result.notifyFailures).toEqual(['tp']);
  });
});

describe('deriveRemovedModalInitial', () => {
  it('checks currently-flagged platforms and seeds their display dates', () => {
    const { existingSet, existingDateMap } = existing([
      { tab: TAB, brand: 'Brand X', platform: 'ag', removed_at: '2026-09-05' },
    ]);
    const res = deriveRemovedModalInitial(TAB, 'Brand X', PLATS, existingSet, existingDateMap);
    expect(res.checkedPlatforms).toEqual(['ag']);
    expect(res.initialDateTexts).toEqual({ ag: '05/09/2026' });
  });

  it('returns empty state when nothing is flagged', () => {
    const { existingSet, existingDateMap } = existing([]);
    const res = deriveRemovedModalInitial(TAB, 'Brand X', PLATS, existingSet, existingDateMap);
    expect(res).toEqual({ checkedPlatforms: [], initialDateTexts: {} });
  });
});
