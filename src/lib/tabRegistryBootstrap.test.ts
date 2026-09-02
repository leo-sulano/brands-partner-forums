import { describe, it, expect, afterEach } from 'vitest';
import { bootstrapTabRegistries } from './tabRegistryBootstrap';
import { isTabPaused, getActiveOperationalTabs, resetPausedTabs } from './pausedTabRegistry';
import { getTabPlatforms, resetHiddenTabPlatforms } from './tab-configs';
import { resolveHardcodedTabKey, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry';
import { OPERATIONAL_TABS, renameOperationalTab } from './tabs';

function fakeClient(tables: Record<string, unknown[]>) {
  const builder = (rows: unknown[]) => ({
    select: () => builder(rows),
    eq: () => builder(rows),
    is: () => builder(rows),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  });
  return { from: (table: string) => builder(tables[table] ?? []) } as any;
}

describe('bootstrapTabRegistries', () => {
  // These tests pause a real tab ('TP Brand Injection') and hide a real
  // platform ('ag' on 'Rooster Partners') via module-global registries --
  // reset after every test (not just relying on Vitest's default per-file
  // process isolation) so this file can never leak that state into another
  // test file that happens to share the same worker process.
  afterEach(() => {
    resetPausedTabs();
    resetHiddenTabPlatforms();
    resetHardcodedTabRenames();
    // Revert the OPERATIONAL_TABS splice the rename test below applies --
    // resetHardcodedTabRenames only clears the resolver's own maps, not the
    // array itself (see the same distinction the real bootstrap function
    // has to account for).
    if (OPERATIONAL_TABS.includes('Hanan Group')) renameOperationalTab('Hanan Group', 'Hanan');
  });

  it('applies fetched rows to all five registries, including OPERATIONAL_TABS for a rename', async () => {
    resetPausedTabs();
    resetHiddenTabPlatforms();
    resetHardcodedTabRenames();
    const client = fakeClient({
      custom_tabs: [],
      tab_hidden_platforms: [{ tab: 'Rooster Partners', platform: 'ag' }],
      tab_archive_log: [],
      paused_tabs: [{ tab: 'TP Brand Injection' }],
      hardcoded_tab_renames: [{ original_name: 'Hanan', current_name: 'Hanan Group' }],
    });
    await bootstrapTabRegistries(client, 'test');
    expect(isTabPaused('TP Brand Injection')).toBe(true);
    expect(getActiveOperationalTabs().includes('TP Brand Injection')).toBe(false);
    expect(getTabPlatforms('Rooster Partners').includes('ag')).toBe(false);
    expect(resolveHardcodedTabKey('Hanan Group')).toBe('Hanan');
    // The regression this test was missing: registerHardcodedTabRenames
    // alone only updates the resolver's lookup maps -- a fresh bootstrap
    // (a cold Edge Function isolate, or any browser session other than the
    // one that performed the rename) must also apply the rename to
    // OPERATIONAL_TABS itself, or the renamed tab is unreachable by its new
    // name/slug everywhere except the resolver-internal lookups.
    expect(OPERATIONAL_TABS.includes('Hanan Group')).toBe(true);
    expect(OPERATIONAL_TABS.includes('Hanan')).toBe(false);
  });

  it('degrades one failed registry fetch to empty without throwing or blocking the others', async () => {
    resetPausedTabs();
    resetHiddenTabPlatforms();
    const client = {
      from: (table: string) => {
        if (table === 'paused_tabs') {
          return {
            select: () => ({
              then: (resolve: any, reject: any) => Promise.reject(new Error('boom')).then(resolve, reject),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({ then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) }),
            is: () => ({ then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) }),
            then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) as any,
          }),
        };
      },
    } as any;
    await expect(bootstrapTabRegistries(client, 'test')).resolves.toBeUndefined();
    expect(getActiveOperationalTabs().includes('TP Brand Injection')).toBe(true); // never got paused, fetch failed open
    expect(resolveHardcodedTabKey('Anything')).toBe('Anything'); // no rows fetched, resolver is a no-op
  });
});
