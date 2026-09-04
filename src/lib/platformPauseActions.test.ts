import { describe, it, expect } from 'vitest';
import { savePlatformPause, resumePlatformPause, derivePauseModalInitial } from './platformPauseActions';
import { overrideKey, type OverrideDetails } from './scheduleOverrides';
import type { Platform } from './removedPlatformBrands';

type Call = [string, ...unknown[]];

function fakeWriters() {
  const calls: Call[] = [];
  return {
    calls,
    writers: {
      setOverride: async (...a: unknown[]) => { calls.push(['setOverride', ...a]); },
      clearOverride: async (...a: unknown[]) => { calls.push(['clearOverride', ...a]); },
      deletePause: async (...a: unknown[]) => { calls.push(['deletePause', ...a]); },
    } as never,
  };
}

const TAB = 'BITP';
const PLATS: Platform[] = ['tp', 'ag'];

function overrideMapWith(entries: Array<[Platform, Partial<OverrideDetails>]>): Map<string, OverrideDetails> {
  const m = new Map<string, OverrideDetails>();
  for (const [p, d] of entries) {
    m.set(overrideKey(TAB, 'brand x', p), { state: 'pause', reason: null, resumeAt: null, setBy: null, ...d });
  }
  return m;
}

describe('savePlatformPause', () => {
  it('writes a new override for a newly-checked platform', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformPause({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: ['tp'],
      reason: 'client hold', resumeAt: null, overrideMap: new Map(),
    }, writers);
    expect(calls).toEqual([['setOverride', TAB, 'Brand X', 'tp', 'pause', { reason: 'client hold', resumeAt: null }]]);
  });

  it('does not re-write an unchanged existing pause', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformPause({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: ['tp'],
      reason: 'r', resumeAt: '2026-10-05',
      overrideMap: overrideMapWith([['tp', { reason: 'r', resumeAt: '2026-10-05' }]]),
    }, writers);
    expect(calls).toEqual([]);
  });

  it('re-writes when reason or resumeAt changed', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformPause({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: ['tp'],
      reason: 'new reason', resumeAt: null,
      overrideMap: overrideMapWith([['tp', { reason: 'old', resumeAt: null }]]),
    }, writers);
    expect(calls).toEqual([['setOverride', TAB, 'Brand X', 'tp', 'pause', { reason: 'new reason', resumeAt: null }]]);
  });

  it('unchecking a paused platform clears the override AND deletes the materialized pause row', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformPause({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: [],
      reason: '', resumeAt: null,
      overrideMap: overrideMapWith([['tp', { reason: 'r', resumeAt: null }]]),
    }, writers);
    expect(calls).toEqual([
      ['clearOverride', TAB, 'brand x', 'tp'],
      ['deletePause', TAB, 'brand x', 'tp'],
    ]);
  });

  it('ignores platforms outside eligiblePlatforms', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformPause({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: ['tp'], checkedPlatforms: ['ag'],
      reason: 'x', resumeAt: null, overrideMap: new Map(),
    }, writers);
    expect(calls).toEqual([]);
  });
});

describe('resumePlatformPause', () => {
  it('clears the override then deletes the materialized pause row', async () => {
    const { calls, writers } = fakeWriters();
    await resumePlatformPause(TAB, 'brand x', 'tp', writers);
    expect(calls).toEqual([
      ['clearOverride', TAB, 'brand x', 'tp'],
      ['deletePause', TAB, 'brand x', 'tp'],
    ]);
  });
});

describe('derivePauseModalInitial', () => {
  it('checks paused platforms and seeds reason/resumeAt from the first paused one', () => {
    const res = derivePauseModalInitial(TAB, 'Brand X', PLATS, overrideMapWith([
      ['ag', { reason: 'ag reason', resumeAt: '2026-11-01' }],
    ]));
    expect(res.checkedPlatforms).toEqual(['ag']);
    expect(res.initialReason).toBe('ag reason');
    expect(res.initialResumeAt).toBe('2026-11-01');
  });

  it('returns empty state when nothing is paused', () => {
    const res = derivePauseModalInitial(TAB, 'Brand X', PLATS, new Map());
    expect(res).toEqual({ checkedPlatforms: [], initialReason: '', initialResumeAt: null });
  });
});
