import { describe, it, expect } from 'vitest';
import { diffRemovedEntries, type RemovedEntryRow } from './removedEntriesDiff';

function row(overrides: Partial<RemovedEntryRow>): RemovedEntryRow {
  return {
    id: 'row-id',
    run_id: 'run-id',
    entry_id: 'entry-1',
    tab: 'Rooster Partners',
    brand: 'Fortuneplay',
    account_name: 'john82',
    platform: 'TP',
    link: 'https://trustpilot.com/reviews/1',
    created_at: '2026-07-02T00:00:00Z',
    ...overrides,
  };
}

describe('diffRemovedEntries', () => {
  it('shows net churn instead of netting to zero', () => {
    // entry-1 was removed last run and is reinstated (absent from current).
    // entry-2 is newly removed this run (absent from previous).
    const previous = [row({ entry_id: 'entry-1' })];
    const current = [row({ entry_id: 'entry-2', account_name: 'spinmaster99' })];

    const diff = diffRemovedEntries(current, previous);

    expect(diff['Rooster Partners::Fortuneplay']).toHaveLength(1);
    expect(diff['Rooster Partners::Fortuneplay'][0].entry_id).toBe('entry-2');
  });

  it('does not flag an entry as new when it matches by entry_id+platform', () => {
    const previous = [row({ entry_id: 'entry-1' })];
    const current = [row({ entry_id: 'entry-1' })];

    const diff = diffRemovedEntries(current, previous);

    expect(diff['Rooster Partners::Fortuneplay']).toBeUndefined();
  });

  it('falls back to account_name+platform when entry_id is null', () => {
    const previous = [row({ entry_id: null, account_name: 'john82' })];
    const current = [row({ entry_id: null, account_name: 'john82' })];

    const diff = diffRemovedEntries(current, previous);

    expect(diff['Rooster Partners::Fortuneplay']).toBeUndefined();
  });

  it('treats each platform on a multi-platform entry independently', () => {
    const previous = [row({ entry_id: 'entry-1', platform: 'TP' })];
    const current = [
      row({ entry_id: 'entry-1', platform: 'TP' }),
      row({ entry_id: 'entry-1', platform: 'AG', link: 'https://askgamblers.com/reviews/1' }),
    ];

    const diff = diffRemovedEntries(current, previous);

    expect(diff['Rooster Partners::Fortuneplay']).toHaveLength(1);
    expect(diff['Rooster Partners::Fortuneplay'][0].platform).toBe('AG');
  });

  it('groups brandless entries under an empty-string brand key', () => {
    const previous: RemovedEntryRow[] = [];
    const current = [row({ tab: 'Trybet', brand: null, entry_id: 'entry-3' })];

    const diff = diffRemovedEntries(current, previous);

    expect(diff['Trybet::']).toHaveLength(1);
  });
});
