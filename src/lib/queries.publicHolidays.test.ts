import { describe, it, expect, vi } from 'vitest';

// Minimal chainable Supabase mock: from().select().order() resolves to { data, error }.
function mockClient(rows: unknown[]) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  return { from } as never;
}

describe('fetchPublicHolidays', () => {
  // Generous timeout: this test dynamically imports the large queries.ts
  // module; under full-suite parallel transform load its cold compile can
  // exceed the default 5s (it runs in ~2.5s in isolation). Raising it here
  // rather than globally keeps the tight default for every other test.
  it('selects id,date,name ordered by date and returns the rows', { timeout: 20000 }, async () => {
    const { fetchPublicHolidays } = await import('./queries');
    const rows = [{ id: 'a', date: '2026-01-01', name: "New Year's Day" }];
    const client = mockClient(rows);
    const result = await fetchPublicHolidays(client);
    expect(result).toEqual(rows);
  });
});
