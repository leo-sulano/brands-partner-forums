import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveHardcodedTabKey, isRenamedHardcodedTab, registerHardcodedTabRenames,
  renameHardcodedTabLocally, resetHardcodedTabRenames,
} from './hardcodedTabRenameRegistry';

describe('hardcodedTabRenameRegistry', () => {
  beforeEach(() => {
    resetHardcodedTabRenames();
  });

  it('resolveHardcodedTabKey is a no-op passthrough for a tab never renamed', () => {
    expect(resolveHardcodedTabKey('Hanan')).toBe('Hanan');
  });

  it('isRenamedHardcodedTab is false for a tab never renamed', () => {
    expect(isRenamedHardcodedTab('Hanan')).toBe(false);
  });

  it('registerHardcodedTabRenames makes resolveHardcodedTabKey resolve the current name back to the original', () => {
    registerHardcodedTabRenames([{ original_name: 'TP Brand Injection', current_name: 'BITP Team' }]);
    expect(resolveHardcodedTabKey('BITP Team')).toBe('TP Brand Injection');
    expect(isRenamedHardcodedTab('BITP Team')).toBe(true);
  });

  it('resolveHardcodedTabKey on the original name itself is unaffected by a registered rename', () => {
    registerHardcodedTabRenames([{ original_name: 'TP Brand Injection', current_name: 'BITP Team' }]);
    expect(resolveHardcodedTabKey('TP Brand Injection')).toBe('TP Brand Injection');
  });

  it('renameHardcodedTabLocally moves a first-time rename from the original name', () => {
    renameHardcodedTabLocally('Rooster Partners', 'RP Group');
    expect(resolveHardcodedTabKey('RP Group')).toBe('Rooster Partners');
    expect(isRenamedHardcodedTab('RP Group')).toBe(true);
    expect(isRenamedHardcodedTab('Rooster Partners')).toBe(false);
  });

  it('renameHardcodedTabLocally moves a second rename, preserving the original key', () => {
    renameHardcodedTabLocally('Rooster Partners', 'RP Group');
    renameHardcodedTabLocally('RP Group', 'RP Group 2');
    expect(resolveHardcodedTabKey('RP Group 2')).toBe('Rooster Partners');
    expect(isRenamedHardcodedTab('RP Group')).toBe(false);
    expect(isRenamedHardcodedTab('RP Group 2')).toBe(true);
  });

  it('isRenamedHardcodedTab is false again after renaming a tab back to its own original name', () => {
    // Regression: found live while verifying the hardcoded-tab-rename
    // feature. rename_hardcoded_tab never deletes its row, only updates
    // current_name -- renaming 'BITP Team' back to 'TP Brand Injection'
    // leaves a row with original_name === current_name, which must read as
    // "not currently renamed" (so the old TAB_DISPLAY_NAMES cosmetic alias
    // applies again), not as "still renamed."
    renameHardcodedTabLocally('TP Brand Injection', 'BITP Team');
    renameHardcodedTabLocally('BITP Team', 'TP Brand Injection');
    expect(resolveHardcodedTabKey('TP Brand Injection')).toBe('TP Brand Injection');
    expect(isRenamedHardcodedTab('TP Brand Injection')).toBe(false);
  });

  it('resetHardcodedTabRenames clears all registered renames', () => {
    registerHardcodedTabRenames([{ original_name: 'TP Brand Injection', current_name: 'BITP Team' }]);
    resetHardcodedTabRenames();
    expect(resolveHardcodedTabKey('BITP Team')).toBe('BITP Team');
    expect(isRenamedHardcodedTab('BITP Team')).toBe(false);
  });
});
