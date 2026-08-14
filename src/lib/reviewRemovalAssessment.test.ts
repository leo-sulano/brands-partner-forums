import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({ data: { session: null } }),
}));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
  SUPABASE_ANON_KEY: 'test-anon-key',
  REVIEW_REMOVAL_ASSESSMENT_URL: 'https://example.com/review-removal-assessment',
}));

import {
  collectBehavioralFields,
  hashAssessmentInput,
  isValidAssessmentResult,
  requestReviewRemovalAssessment,
  type ReviewRemovalAssessmentResult,
} from './reviewRemovalAssessment';

const VALID_RESULT: ReviewRemovalAssessmentResult = {
  overall_result: 'no_clear_removal_reason',
  risk_score: 10,
  confidence: 'medium',
  content_assessment: {
    status: 'compliant',
    summary: 'Looks like a genuine experience.',
    signals: [{ name: 'Specific experience', severity: 'low', evidence: 'Mentions exact deposit/withdrawal amounts and dates.' }],
  },
  behavioral_assessment: {
    status: 'normal',
    summary: 'No unusual signals recorded.',
    signals: [],
  },
  likely_reason: 'No clear reason found.',
  policy_category: '',
  why_it_may_have_been_removed: 'No evidence points to a specific cause.',
  evidence_summary: 'Content is compliant; behavioral data shows nothing unusual.',
  alternative_explanation: 'Could be an unrelated moderation error.',
  recommendation: 'No action needed based on available evidence.',
  assessment_note: 'This is an AI assessment based on the available review, dashboard data, behavioral signals, and Trustpilot\'s published guidelines. It does not confirm Trustpilot\'s private/internal moderation decision.',
};

describe('collectBehavioralFields', () => {
  it('excludes credential fields (Backup Codes, Authenticator Backup) while keeping real behavioral fields', () => {
    const headers = ['Backup Codes', 'Authenticator Backup', 'Sticky IP (Mobile) (Y/N)'];
    const fields = {
      'Backup Codes': 'ABCD-1234-EFGH-5678',
      'Authenticator Backup': 'some-otp-secret',
      'Sticky IP (Mobile) (Y/N)': 'No',
    };

    const result = collectBehavioralFields(headers, fields);

    expect(result).not.toHaveProperty('Backup Codes');
    expect(result).not.toHaveProperty('Authenticator Backup');
    expect(result['Sticky IP (Mobile) (Y/N)']).toBe('No');
  });
});

describe('hashAssessmentInput', () => {
  it('is deterministic for identical input', async () => {
    const input = { platform: 'tp' as const, reviewText: 'Great casino', behavioralFields: { 'Sticky IP (Mobile) (Y/N)': 'No' } };
    const a = await hashAssessmentInput(input);
    const b = await hashAssessmentInput(input);
    expect(a).toBe(b);
  });

  it('changes when reviewText changes', async () => {
    const a = await hashAssessmentInput({ platform: 'tp', reviewText: 'Great casino', behavioralFields: {} });
    const b = await hashAssessmentInput({ platform: 'tp', reviewText: 'Bad casino', behavioralFields: {} });
    expect(a).not.toBe(b);
  });

  it('changes when a behavioral field value changes', async () => {
    const a = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: { 'Sticky IP (Mobile) (Y/N)': 'No' } });
    const b = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: { 'Sticky IP (Mobile) (Y/N)': 'Yes' } });
    expect(a).not.toBe(b);
  });

  it('is unaffected by behavioral field key order', async () => {
    const a = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: { A: '1', B: '2' } });
    const b = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: { B: '2', A: '1' } });
    expect(a).toBe(b);
  });

  it('changes when platform changes', async () => {
    const a = await hashAssessmentInput({ platform: 'tp', reviewText: 'x', behavioralFields: {} });
    const b = await hashAssessmentInput({ platform: 'wo', reviewText: 'x', behavioralFields: {} });
    expect(a).not.toBe(b);
  });
});

describe('isValidAssessmentResult', () => {
  it('accepts a well-formed result', () => {
    expect(isValidAssessmentResult(VALID_RESULT)).toBe(true);
  });

  it('rejects a missing top-level key', () => {
    const { recommendation, ...rest } = VALID_RESULT;
    expect(isValidAssessmentResult(rest)).toBe(false);
  });

  it('rejects an invalid overall_result enum value', () => {
    expect(isValidAssessmentResult({ ...VALID_RESULT, overall_result: 'definitely_removed' })).toBe(false);
  });

  it('rejects an invalid confidence enum value', () => {
    expect(isValidAssessmentResult({ ...VALID_RESULT, confidence: 'certain' })).toBe(false);
  });

  it('rejects a non-array signals field', () => {
    expect(isValidAssessmentResult({
      ...VALID_RESULT,
      content_assessment: { ...VALID_RESULT.content_assessment, signals: 'none' },
    })).toBe(false);
  });

  it('rejects a malformed signal object (bad severity)', () => {
    expect(isValidAssessmentResult({
      ...VALID_RESULT,
      content_assessment: { ...VALID_RESULT.content_assessment, signals: [{ name: 'x', severity: 'extreme', evidence: 'y' }] },
    })).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidAssessmentResult(null)).toBe(false);
  });
});

describe('requestReviewRemovalAssessment', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it('returns the analysis and model on a successful response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ analysis: VALID_RESULT, model: 'gpt-4o' }),
    });

    const result = await requestReviewRemovalAssessment({ platform: 'tp', status: 'Removed', reviewText: 'x', behavioralFields: {} });

    expect(result.analysis).toEqual(VALID_RESULT);
    expect(result.model).toBe('gpt-4o');
  });

  it('sends the anon key and a bearer token to REVIEW_REMOVAL_ASSESSMENT_URL', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ analysis: VALID_RESULT, model: 'gpt-4o' }) });

    await requestReviewRemovalAssessment({ platform: 'tp', status: 'Removed', reviewText: 'x', behavioralFields: {} });

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/review-removal-assessment',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-anon-key', Authorization: expect.stringMatching(/^Bearer /) }),
      }),
    );
  });

  it('throws the standard friendly message on a non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });

    await expect(requestReviewRemovalAssessment({ platform: 'tp', status: 'Removed', reviewText: 'x', behavioralFields: {} }))
      .rejects.toThrow('Unable to generate an AI assessment right now. Please try again later.');
  });

  it('throws the standard friendly message when fetch itself rejects', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    await expect(requestReviewRemovalAssessment({ platform: 'tp', status: 'Removed', reviewText: 'x', behavioralFields: {} }))
      .rejects.toThrow('Unable to generate an AI assessment right now. Please try again later.');
  });

  it('throws the standard friendly message when the response analysis fails shape validation', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ analysis: { bad: true }, model: 'gpt-4o' }) });

    await expect(requestReviewRemovalAssessment({ platform: 'tp', status: 'Removed', reviewText: 'x', behavioralFields: {} }))
      .rejects.toThrow('Unable to generate an AI assessment right now. Please try again later.');
  });
});
