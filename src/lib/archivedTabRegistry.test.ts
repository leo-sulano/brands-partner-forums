import { describe, it, expect, afterEach } from 'vitest';
import { OPERATIONAL_TABS } from './tabs';
import {
  archiveTabLocally, unarchiveTabLocally, applyArchivedTabs, resetArchivedTabs, isTabArchived,
} from './archivedTabRegistry';

describe('archivedTabRegistry', () => {
  afterEach(() => {
    resetArchivedTabs();
  });

  it('archiveTabLocally removes a hardcoded tab from OPERATIONAL_TABS and marks it archived', () => {
    expect(OPERATIONAL_TABS).toContain('Hanan');
    archiveTabLocally('Hanan');
    expect(OPERATIONAL_TABS).not.toContain('Hanan');
    expect(isTabArchived('Hanan')).toBe(true);
  });

  it('unarchiveTabLocally restores a hardcoded tab to OPERATIONAL_TABS', () => {
    archiveTabLocally('Hanan');
    unarchiveTabLocally('Hanan');
    expect(OPERATIONAL_TABS).toContain('Hanan');
    expect(isTabArchived('Hanan')).toBe(false);
  });

  it('archiveTabLocally also works for a dynamic tab name not currently in OPERATIONAL_TABS', () => {
    expect(() => archiveTabLocally('Some Dynamic Tab')).not.toThrow();
    expect(isTabArchived('Some Dynamic Tab')).toBe(true);
    expect(OPERATIONAL_TABS).not.toContain('Some Dynamic Tab');
  });

  it('applyArchivedTabs archives every row in the list', () => {
    applyArchivedTabs([{ tab: 'Hanan' }, { tab: 'Wizard of Odds' }]);
    expect(isTabArchived('Hanan')).toBe(true);
    expect(isTabArchived('Wizard of Odds')).toBe(true);
  });

  it('resetArchivedTabs unarchives everything and restores original OPERATIONAL_TABS membership', () => {
    archiveTabLocally('Hanan');
    archiveTabLocally('Wizard of Odds');
    resetArchivedTabs();
    expect(isTabArchived('Hanan')).toBe(false);
    expect(isTabArchived('Wizard of Odds')).toBe(false);
    expect(OPERATIONAL_TABS).toContain('Hanan');
    expect(OPERATIONAL_TABS).toContain('Wizard of Odds');
  });
});
