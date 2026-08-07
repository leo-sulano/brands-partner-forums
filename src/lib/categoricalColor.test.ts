import { describe, it, expect } from 'vitest';
import { categoricalColorForKey } from './categoricalColor';

describe('categoricalColorForKey', () => {
  it('is deterministic for the same key', () => {
    expect(categoricalColorForKey('germany')).toBe(categoricalColorForKey('germany'));
  });

  it('is stable regardless of when/how often it is called (no rank/position dependency)', () => {
    const first = categoricalColorForKey('united states');
    for (let i = 0; i < 5; i++) {
      expect(categoricalColorForKey('united states')).toBe(first);
    }
  });

  it('returns a hex color from the fixed 8-slot palette', () => {
    const palette = new Set([
      '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
      '#e87ba4', '#008300', '#4a3aa7', '#e34948',
    ]);
    expect(palette.has(categoricalColorForKey('france'))).toBe(true);
    expect(palette.has(categoricalColorForKey('enigma-us1'))).toBe(true);
  });

  it('gives different keys a good chance of different colors (not a constant)', () => {
    const colors = new Set(
      ['germany', 'france', 'spain', 'italy', 'uk', 'usa', 'canada', 'brazil'].map(categoricalColorForKey),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
