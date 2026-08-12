import { describe, it, expect } from 'vitest';
import { sectionOf } from './entryFieldSections';

describe('sectionOf', () => {
  it('buckets account/identity columns as account', () => {
    expect(sectionOf('Account')).toBe('account');
    expect(sectionOf('Country')).toBe('account');
    expect(sectionOf('Proxy Used')).toBe('account');
    expect(sectionOf('Brands')).toBe('account');
    expect(sectionOf('Agent')).toBe('account');
  });

  it('buckets Trust Pilot columns, including both score column variants, as tp', () => {
    expect(sectionOf('Trust Pilot')).toBe('tp');
    expect(sectionOf('TP Review Status')).toBe('tp');
    expect(sectionOf('Link to the profile')).toBe('tp');
    expect(sectionOf('TP Score added')).toBe('tp');
    expect(sectionOf('Score added')).toBe('tp');
  });

  it('buckets AskGamblers columns, including its score column, as ag', () => {
    expect(sectionOf('Ask Gambler review added')).toBe('ag');
    expect(sectionOf('AG Review Status')).toBe('ag');
    expect(sectionOf('AG Review Link')).toBe('ag');
    expect(sectionOf('AG User')).toBe('ag');
    expect(sectionOf('AG Score added')).toBe('ag');
  });

  it('buckets Casino Guru columns, including its score column, as cg', () => {
    expect(sectionOf('Casino Guru review added')).toBe('cg');
    expect(sectionOf('CG Review Status')).toBe('cg');
    expect(sectionOf('CG Review Link')).toBe('cg');
    expect(sectionOf('CG User')).toBe('cg');
    expect(sectionOf('CG Score added')).toBe('cg');
  });

  it('does not misclassify Agent as an AG column', () => {
    expect(sectionOf('Agent')).toBe('account');
  });

  it('buckets yes/no and behavior-extra columns as yesno (Behavior Flags)', () => {
    expect(sectionOf('Photo in Account?')).toBe('yesno');
    expect(sectionOf('Native Language?')).toBe('yesno');
    expect(sectionOf('Backup Codes')).toBe('yesno');
    expect(sectionOf('Authenticator Backup')).toBe('yesno');
    expect(sectionOf('Desktop/Mobile')).toBe('yesno');
  });
});
