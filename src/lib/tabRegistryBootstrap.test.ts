import { describe, it, expect, afterEach } from 'vitest';
import { bootstrapTabRegistries } from './tabRegistryBootstrap';
import { isTabPaused, getActiveOperationalTabs, resetPausedTabs } from './pausedTabRegistry';
import { getTabPlatforms, resetHiddenTabPlatforms } from './tab-configs';
import { resolveHardcodedTabKey, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry';

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
  });

  it('applies fetched rows to all five registries', async () => {
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
