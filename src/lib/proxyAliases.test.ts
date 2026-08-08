import { describe, it, expect } from 'vitest';
import { canonicalProxyKey, canonicalProxyName } from './proxyAliases';

describe('canonicalProxyKey', () => {
  it('merges a known alias onto the same key as its canonical spelling', () => {
    expect(canonicalProxyKey('Proylite')).toBe(canonicalProxyKey('Proxylite'));
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(canonicalProxyKey('  proylite  ')).toBe(canonicalProxyKey('Proxylite'));
  });

  it('passes an unrecognized proxy name through unchanged (lowercased)', () => {
    expect(canonicalProxyKey('Enigma-US1')).toBe('enigma-us1');
  });
});

describe('canonicalProxyName', () => {
  it('returns the canonical spelling for a known alias', () => {
    expect(canonicalProxyName('Proylite')).toBe('Proxylite');
    expect(canonicalProxyName('proylite')).toBe('Proxylite');
  });

  it('returns the trimmed raw value for anything unrecognized', () => {
    expect(canonicalProxyName('  Enigma-US1  ')).toBe('Enigma-US1');
  });
});
