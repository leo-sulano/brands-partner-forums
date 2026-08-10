import { describe, it, expect } from 'vitest';
import { shouldShowTranslateButton } from './reviewTranslation';

describe('shouldShowTranslateButton', () => {
  it('returns false for English text', () => {
    expect(shouldShowTranslateButton(
      'This is a genuinely nice casino with fast withdrawals and great support.'
    )).toBe(false);
  });

  it('returns true for German text', () => {
    expect(shouldShowTranslateButton(
      'Das Casino ist sehr gut. Die Auszahlungen waren schnell und der Kundenservice war hilfreich.'
    )).toBe(true);
  });

  it('returns true for Spanish text', () => {
    expect(shouldShowTranslateButton(
      'Este casino es muy bueno. Los retiros fueron rápidos y el servicio al cliente fue muy útil.'
    )).toBe(true);
  });

  it('returns false for very short/undetermined text (assume English rather than false-positive the button)', () => {
    expect(shouldShowTranslateButton('ok')).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(shouldShowTranslateButton('')).toBe(false);
  });
});
