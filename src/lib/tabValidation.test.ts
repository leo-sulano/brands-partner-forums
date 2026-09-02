import { describe, it, expect, beforeEach } from 'vitest';
import { validateNewTabName } from './tabValidation';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';
import { archiveTabLocally, unarchiveTabLocally } from './archivedTabRegistry';
import { renameOperationalTab } from './tabs';
import { renameHardcodedTabLocally, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry';

describe('validateNewTabName', () => {
  beforeEach(() => {
    unregisterDynamicTab('Sunset Partners');
  });

  it('rejects a blank name', () => {
    expect(validateNewTabName('   ')).toBe('Enter a tab name.');
  });

  it('rejects a name that collides with a hardcoded tab', () => {
    expect(validateNewTabName('Hanan')).toBe('A tab named "Hanan" already exists.');
  });

  it('rejects a name that collides with an already-registered dynamic tab', () => {
    registerDynamicTabs([{ name: 'Sunset Partners', platforms: ['tp'] }]);
    expect(validateNewTabName('Sunset Partners')).toBe('A tab named "Sunset Partners" already exists.');
  });

  it('rejects a name that produces the same URL slug as an existing tab', () => {
    expect(validateNewTabName('Gulf Recovery Group')).toBe(
      '"Gulf Recovery Group" produces the same URL as an existing tab. Pick a more distinct name.',
    );
  });

  it('rejects a name containing /, ? or #', () => {
    expect(validateNewTabName('Foo/Bar')).toBe('A tab name cannot contain /, ? or #.');
    expect(validateNewTabName('Foo?Bar')).toBe('A tab name cannot contain /, ? or #.');
    expect(validateNewTabName('Foo#Bar')).toBe('A tab name cannot contain /, ? or #.');
  });

  it('accepts a genuinely new, distinct name', () => {
    expect(validateNewTabName('Sunset Partners')).toBeNull();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateNewTabName('  Hanan  ')).toBe('A tab named "Hanan" already exists.');
  });

  it('rejects a name matching a currently-archived tab', () => {
    archiveTabLocally('Old Archived Tab');
    expect(validateNewTabName('Old Archived Tab')).toBe(
      '"Old Archived Tab" is currently archived — unarchive it, or choose a different name.',
    );
    unarchiveTabLocally('Old Archived Tab');
  });

  it('still rejects a hardcoded tab\'s original name even after that tab has been renamed away from it', () => {
    renameOperationalTab('Hanan', 'Hanan Renamed');
    renameHardcodedTabLocally('Hanan', 'Hanan Renamed');
    expect(validateNewTabName('Hanan')).toBe('A tab named "Hanan" already exists.');
    // cleanup: revert both the OPERATIONAL_TABS splice and the registry entry
    renameOperationalTab('Hanan Renamed', 'Hanan');
    resetHardcodedTabRenames();
  });

  it('allows a hardcoded tab to rename itself back to its own original name', () => {
    // Regression: found live while verifying the hardcoded-tab-rename
    // feature — renaming a tab back to its own true original identity was
    // wrongly rejected by the exact same permanent-reservation rule the
    // test above confirms for every OTHER tab.
    renameOperationalTab('Hanan', 'Hanan Renamed');
    renameHardcodedTabLocally('Hanan', 'Hanan Renamed');
    expect(validateNewTabName('Hanan', 'Hanan Renamed')).toBeNull();
    // cleanup
    renameOperationalTab('Hanan Renamed', 'Hanan');
    resetHardcodedTabRenames();
  });

  it('allows a hardcoded tab with a slug override to rename itself back to its own original name', () => {
    // Regression: tabToSlug used to keep applying SLUG_OVERRIDES (keyed by
    // original name) even after a true rename, so reverting 'GRG - Gulf
    // Recovery Group' back to itself from a renamed state compared its own
    // still-overridden slug against itself and wrongly reported a collision.
    renameOperationalTab('GRG - Gulf Recovery Group', 'Gulf Ops');
    renameHardcodedTabLocally('GRG - Gulf Recovery Group', 'Gulf Ops');
    expect(validateNewTabName('GRG - Gulf Recovery Group', 'Gulf Ops')).toBeNull();
    // cleanup
    renameOperationalTab('Gulf Ops', 'GRG - Gulf Recovery Group');
    resetHardcodedTabRenames();
  });

  it('still rejects a DIFFERENT tab claiming a reserved original name it does not own', () => {
    renameOperationalTab('Hanan', 'Hanan Renamed');
    renameHardcodedTabLocally('Hanan', 'Hanan Renamed');
    // 'Trybet' trying to become 'Hanan' -- currentTabName's own original key
    // ('Trybet') does not match the name being validated ('Hanan'), so the
    // exemption must not apply.
    expect(validateNewTabName('Hanan', 'Trybet')).toBe('A tab named "Hanan" already exists.');
    // cleanup
    renameOperationalTab('Hanan Renamed', 'Hanan');
    resetHardcodedTabRenames();
  });
});
