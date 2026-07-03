import { describe, it, expect } from 'vitest';
import { TAB_COLUMN_CONFIGS } from './tab-configs';

describe('TAB_COLUMN_CONFIGS', () => {
  it('places Country immediately after Account in every tab', () => {
    for (const [tab, cols] of Object.entries(TAB_COLUMN_CONFIGS)) {
      const accountIdx = cols.indexOf('Account');
      expect(accountIdx, `${tab} has no Account column`).toBeGreaterThanOrEqual(0);
      expect(cols[accountIdx + 1], `${tab}: Country should immediately follow Account`).toBe('Country');
    }
  });
});
