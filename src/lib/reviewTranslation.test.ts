import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({ data: { session: null } }),
}));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
  SUPABASE_ANON_KEY: 'test-anon-key',
  TRANSLATE_REVIEW_URL: 'https://example.com/translate-review',
}));

import { shouldShowTranslateButton, translateReviewText } from './reviewTranslation';

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

describe('translateReviewText', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it('returns the translation on a successful response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ translation: 'The casino is very good.' }),
    });

    const result = await translateReviewText('Das Casino ist sehr gut.');

    expect(result).toBe('The casino is very good.');
  });

  it('sends the anon key and a bearer token to TRANSLATE_REVIEW_URL', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ translation: 'ok' }),
    });

    await translateReviewText('some text');

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/translate-review',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-anon-key' }),
      }),
    );
  });

  it('throws the standard friendly message on a non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });

    await expect(translateReviewText('text')).rejects.toThrow(
      'Unable to translate this review at the moment. Please try again later.',
    );
  });

  it('throws the standard friendly message when fetch itself rejects', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    await expect(translateReviewText('text')).rejects.toThrow(
      'Unable to translate this review at the moment. Please try again later.',
    );
  });

  it('throws the standard friendly message when the response has no translation field', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(translateReviewText('text')).rejects.toThrow(
      'Unable to translate this review at the moment. Please try again later.',
    );
  });
});
