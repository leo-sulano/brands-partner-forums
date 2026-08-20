import { describe, it, expect, afterEach } from 'vitest';
import { OPERATIONAL_TABS } from './tabs';
import {
  pauseTabLocally, unpauseTabLocally, applyPausedTabs, resetPausedTabs, isTabPaused,
  getActiveOperationalTabs,
} from './pausedTabRegistry';

describe('pausedTabRegistry', () => {
  afterEach(() => {
    resetPausedTabs();
  });

  it('pauseTabLocally marks a tab paused without removing it from OPERATIONAL_TABS', () => {
    expect(OPERATIONAL_TABS).toContain('Hanan');
    pauseTabLocally('Hanan');
    expect(OPERATIONAL_TABS).toContain('Hanan');
    expect(isTabPaused('Hanan')).toBe(true);
  });

  it('unpauseTabLocally clears paused state', () => {
    pauseTabLocally('Hanan');
    unpauseTabLocally('Hanan');
    expect(isTabPaused('Hanan')).toBe(false);
  });

  it('applyPausedTabs pauses every row in the list', () => {
    applyPausedTabs([{ tab: 'Hanan' }, { tab: 'Wizard of Odds' }]);
    expect(isTabPaused('Hanan')).toBe(true);
    expect(isTabPaused('Wizard of Odds')).toBe(true);
  });

  it('resetPausedTabs unpauses everything', () => {
    pauseTabLocally('Hanan');
    pauseTabLocally('Wizard of Odds');
    resetPausedTabs();
    expect(isTabPaused('Hanan')).toBe(false);
    expect(isTabPaused('Wizard of Odds')).toBe(false);
  });

  it('getActiveOperationalTabs excludes only paused tabs, leaving OPERATIONAL_TABS itself untouched', () => {
    pauseTabLocally('Hanan');
    const active = getActiveOperationalTabs();
    expect(active).not.toContain('Hanan');
    expect(active).toContain('Wizard of Odds');
    expect(active.length).toBe(OPERATIONAL_TABS.length - 1);
    expect(OPERATIONAL_TABS).toContain('Hanan');
  });
});
