import { describe, it, expect } from 'vitest';
import { getPlatformRule, PLATFORM_RULES } from './schedulerRules';

describe('getPlatformRule', () => {
  it('returns the exact built-in rule for each of the 4 built-in platforms', () => {
    expect(getPlatformRule('tp')).toEqual(PLATFORM_RULES.tp);
    expect(getPlatformRule('ag')).toEqual(PLATFORM_RULES.ag);
    expect(getPlatformRule('cg')).toEqual(PLATFORM_RULES.cg);
    expect(getPlatformRule('wo')).toEqual(PLATFORM_RULES.wo);
  });

  it('returns the fixed default rule (1 post/week, no preferred days) for any other platform key', () => {
    expect(getPlatformRule('some-custom-platform-uuid')).toEqual({ postsPerWeek: 1, preferredDays: [] });
  });
});
