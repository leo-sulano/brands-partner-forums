// src/lib/tabs.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { tabDisplayName, tabToSlug, OPERATIONAL_TABS, renameOperationalTab } from './tabs';
import { renameHardcodedTabLocally, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry';

describe('tabDisplayName', () => {
  afterEach(() => {
    resetHardcodedTabRenames();
  });

  it('renames TP Affiliate to FTP', () => {
    expect(tabDisplayName('TP Affiliate')).toBe('FTP');
  });

  it('renames TP Brand Injection to BITP', () => {
    expect(tabDisplayName('TP Brand Injection')).toBe('BITP');
  });

  it('returns every other tab unchanged', () => {
    expect(tabDisplayName('Hanan')).toBe('Hanan');
    expect(tabDisplayName('Wizard of Odds')).toBe('Wizard of Odds');
    expect(tabDisplayName('GRG - Gulf Recovery Group')).toBe('GRG - Gulf Recovery Group');
  });

  it('a true rename of a tab with a cosmetic alias supersedes the alias', () => {
    renameHardcodedTabLocally('TP Brand Injection', 'BITP Team');
    expect(tabDisplayName('BITP Team')).toBe('BITP Team');
  });

  it('a true rename of a tab with no cosmetic alias just returns the new name', () => {
    renameHardcodedTabLocally('Hanan', 'Hanan Group');
    expect(tabDisplayName('Hanan Group')).toBe('Hanan Group');
  });

  it('renaming a tab back to its own original name restores its cosmetic alias', () => {
    // Regression: found live while verifying the hardcoded-tab-rename
    // feature — reverting 'BITP Team' back to 'TP Brand Injection' left the
    // 'BITP' alias permanently suppressed until isRenamedHardcodedTab was
    // fixed to distinguish "has a row" from "is currently renamed."
    renameHardcodedTabLocally('TP Brand Injection', 'BITP Team');
    renameHardcodedTabLocally('BITP Team', 'TP Brand Injection');
    expect(tabDisplayName('TP Brand Injection')).toBe('BITP');
  });
});

describe('tabToSlug', () => {
  afterEach(() => {
    resetHardcodedTabRenames();
  });

  it('slugifies a plain tab name', () => {
    expect(tabToSlug('Hanan')).toBe('hanan');
  });

  it('uses the SLUG_OVERRIDES entry for GRG - Gulf Recovery Group', () => {
    expect(tabToSlug('GRG - Gulf Recovery Group')).toBe('gulf-recovery-group');
  });

  it('a true rename of a tab with a slug override supersedes the override, matching tabDisplayName\'s policy', () => {
    renameHardcodedTabLocally('GRG - Gulf Recovery Group', 'Gulf Group Renamed');
    expect(tabToSlug('Gulf Group Renamed')).toBe('gulf-group-renamed');
  });

  it('a renamed tab with no slug override slugifies its new name', () => {
    renameHardcodedTabLocally('Hanan', 'Hanan Group');
    expect(tabToSlug('Hanan Group')).toBe('hanan-group');
  });
});

describe('renameOperationalTab', () => {
  afterEach(() => {
    const idx = OPERATIONAL_TABS.indexOf('Hanan Renamed');
    if (idx !== -1) OPERATIONAL_TABS.splice(idx, 1, 'Hanan');
  });

  it('renames a hardcoded tab in place, preserving its OPERATIONAL_TABS position', () => {
    const idxBefore = OPERATIONAL_TABS.indexOf('Hanan');
    renameOperationalTab('Hanan', 'Hanan Renamed');
    expect(OPERATIONAL_TABS.indexOf('Hanan Renamed')).toBe(idxBefore);
    expect(OPERATIONAL_TABS).not.toContain('Hanan');
  });

  it('is a no-op when the old name is not currently in OPERATIONAL_TABS', () => {
    const before = [...OPERATIONAL_TABS];
    renameOperationalTab('Never A Real Tab', 'Also Never');
    expect(OPERATIONAL_TABS).toEqual(before);
  });
});
