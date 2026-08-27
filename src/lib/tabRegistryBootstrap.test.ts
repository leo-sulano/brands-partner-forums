import { describe, it, expect } from 'vitest';
import { bootstrapTabRegistries } from './tabRegistryBootstrap';
import { isTabPaused, getActiveOperationalTabs, resetPausedTabs } from './pausedTabRegistry';
import { getTabPlatforms, resetHiddenTabPlatforms } from './tab-configs';

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
  it('applies fetched rows to all four registries', async () => {
    resetPausedTabs();
    resetHiddenTabPlatforms();
    const client = fakeClient({
      custom_tabs: [],
      tab_hidden_platforms: [{ tab: 'Rooster Partners', platform: 'ag' }],
      tab_archive_log: [],
      paused_tabs: [{ tab: 'TP Brand Injection' }],
    });
    await bootstrapTabRegistries(client, 'test');
    expect(isTabPaused('TP Brand Injection')).toBe(true);
    expect(getActiveOperationalTabs().includes('TP Brand Injection')).toBe(false);
    expect(getTabPlatforms('Rooster Partners').includes('ag')).toBe(false);
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
            then: (r: any) => Promise.resolve({ data: table === 'paused_tabs' ? [] : [], error: null }).then(r) as any,
          }),
        };
      },
    } as any;
    await expect(bootstrapTabRegistries(client, 'test')).resolves.toBeUndefined();
    expect(getActiveOperationalTabs().includes('TP Brand Injection')).toBe(true); // never got paused, fetch failed open
  });
});
