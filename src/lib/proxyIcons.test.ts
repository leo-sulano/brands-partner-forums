import { describe, it, expect } from 'vitest';
import { proxyIconUrl } from './proxyIcons';

describe('proxyIconUrl', () => {
  it('builds a Google favicon-service URL from a slugified, lowercased proxy name', () => {
    expect(proxyIconUrl('Proxylite')).toBe('https://www.google.com/s2/favicons?domain=proxylite.com&sz=64');
    expect(proxyIconUrl('SpyderProxy')).toBe('https://www.google.com/s2/favicons?domain=spyderproxy.com&sz=64');
  });

  it('strips whitespace and non-alphanumeric characters before slugifying', () => {
    expect(proxyIconUrl(' Enigma US1 ')).toBe('https://www.google.com/s2/favicons?domain=enigmaus1.com&sz=64');
    expect(proxyIconUrl('Proxy-Lite_2')).toBe('https://www.google.com/s2/favicons?domain=proxylite2.com&sz=64');
  });

  it('returns null for a masked/redacted value with no plausible domain', () => {
    expect(proxyIconUrl('*****')).toBeNull();
  });

  it('returns null for anything shorter than 3 alphanumeric characters', () => {
    expect(proxyIconUrl('AB')).toBeNull();
    expect(proxyIconUrl('')).toBeNull();
    expect(proxyIconUrl('  ')).toBeNull();
  });
});
