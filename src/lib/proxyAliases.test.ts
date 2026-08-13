import { describe, it, expect } from 'vitest';
import { canonicalProxyKey, canonicalProxyName, resolveProxyLabel, NO_PROXY_LABEL } from './proxyAliases';

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

describe('resolveProxyLabel', () => {
  it('resolves a blank value to "No Proxy"', () => {
    expect(resolveProxyLabel('')).toBe('No Proxy');
    expect(resolveProxyLabel('   ')).toBe('No Proxy');
    expect(resolveProxyLabel(null)).toBe('No Proxy');
    expect(resolveProxyLabel(undefined)).toBe('No Proxy');
  });

  it('resolves a redacted "*****" value to "No Proxy"', () => {
    expect(resolveProxyLabel('*****')).toBe('No Proxy');
  });

  it('passes through a value starting with an active provider name, case-insensitively', () => {
    expect(resolveProxyLabel('Enigma-US1')).toBe('Enigma-US1');
    expect(resolveProxyLabel('proxio_de2')).toBe('proxio_de2');
    expect(resolveProxyLabel('SPYDERPROXY-uk3')).toBe('SPYDERPROXY-uk3');
  });

  it('resolves a known typo alias to its canonical provider spelling before matching', () => {
    expect(resolveProxyLabel('proylite-1')).toBe('proylite-1');
    expect(resolveProxyLabel('  Proylite  ')).toBe('Proylite');
  });

  it('resolves an unrecognized/decommissioned provider value to "No Proxy"', () => {
    expect(resolveProxyLabel('OldVPN-7')).toBe('No Proxy');
    expect(resolveProxyLabel('RandomHost22')).toBe('No Proxy');
  });

  it('composes with canonicalProxyKey to key blank, redacted, and unrecognized values identically', () => {
    const noProxyKey = canonicalProxyKey(NO_PROXY_LABEL);
    expect(canonicalProxyKey(resolveProxyLabel(''))).toBe(noProxyKey);
    expect(canonicalProxyKey(resolveProxyLabel('*****'))).toBe(noProxyKey);
    expect(canonicalProxyKey(resolveProxyLabel('OldVPN-7'))).toBe(noProxyKey);
  });

  it('composes with canonicalProxyName to display the canonical spelling for a matched typo alias', () => {
    expect(canonicalProxyName(resolveProxyLabel('Proylite'))).toBe('Proxylite');
  });
});
