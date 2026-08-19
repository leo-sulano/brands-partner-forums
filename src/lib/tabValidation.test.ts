import { describe, it, expect, beforeEach } from 'vitest';
import { validateNewTabName } from './tabValidation';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';
import { archiveTabLocally, unarchiveTabLocally } from './archivedTabRegistry';

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
});
