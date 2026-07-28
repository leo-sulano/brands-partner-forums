import { describe, it, expect } from 'vitest';
import { tabDisplayName } from './tabs';

describe('tabDisplayName', () => {
  it('renames TP Affiliate to FTP', () => {
    expect(tabDisplayName('TP Affiliate')).toBe('FTP');
  });

  it('renames TP Brand Injection to BITP', () => {
    expect(tabDisplayName('TP Brand Injection')).toBe('BITP');
  });

  it('returns every other tab unchanged', () => {
    expect(tabDisplayName('Hanan')).toBe('Hanan');
    expect(tabDisplayName('Wizard of Odds')).toBe('Wizard of Odds');
    expect(tabDisplayName('GRG - Gulf Recovery Group')).toBe('GRG - Gulf Recovery Group');
  });
});
