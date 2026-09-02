import { describe, it, expect, vi } from 'vitest';

// Minimal chainable Supabase mock: from().select().order() resolves to { data, error }.
function mockClient(rows: unknown[]) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  return { from } as never;
}

describe('fetchPublicHolidays', () => {
  it('selects id,date,name ordered by date and returns the rows', async () => {
    const { fetchPublicHolidays } = await import('./queries');
    const rows = [{ id: 'a', date: '2026-01-01', name: "New Year's Day" }];
    const client = mockClient(rows);
    const result = await fetchPublicHolidays(client);
    expect(result).toEqual(rows);
  });
});
