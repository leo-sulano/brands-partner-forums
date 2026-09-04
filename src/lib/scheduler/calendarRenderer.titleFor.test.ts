import { describe, it, expect } from 'vitest';
import { titleFor } from './calendarRenderer';
import type { BrandPlatformPause } from '../queries';

const pause = (over: Partial<BrandPlatformPause> = {}): BrandPlatformPause => ({
  tab: 'BITP', brand_key: 'brand x', platform: 'tp', paused_week_start: '2026-09-07', reason: 'client hold', ...over,
});

describe('titleFor — system (paused) variant', () => {
  it('auto-detected pause (pauseResumeAt undefined) says "Auto-paused" and "Resumes week of"', () => {
    const t = titleFor({ platform: 'tp', source: 'system', pause: pause(), clickable: true, onClick: () => {} });
    expect(t.split('\n')[0]).toBe('Auto-paused');
    expect(t).toContain('Reason: client hold');
    expect(t).toContain('Resumes week of');
  });

  it('override permanent pause (pauseResumeAt null) says "Manually paused" and "until manually cleared"', () => {
    const t = titleFor({ platform: 'tp', source: 'system', pause: pause(), pauseResumeAt: null, clickable: true, onClick: () => {} });
    expect(t.split('\n')[0]).toBe('Manually paused');
    expect(t).toContain('Reason: client hold');
    expect(t).toContain('until manually cleared');
  });

  it('override dated pause says "Manually paused" and "Resumes <date>"', () => {
    const t = titleFor({ platform: 'tp', source: 'system', pause: pause(), pauseResumeAt: '2026-10-12', clickable: true, onClick: () => {} });
    expect(t.split('\n')[0]).toBe('Manually paused');
    expect(t).toContain('Resumes ');
    expect(t).not.toContain('week of');
  });
});
