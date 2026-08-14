import { supabase, SUPABASE_ANON_KEY, REVIEW_REMOVAL_ASSESSMENT_URL } from './supabase';
import { isYesNoCol, isBehaviorExtraCol } from './entryFieldSections';

export type OverallResult = 'likely_publishable' | 'uncertain' | 'likely_removal_risk' | 'no_clear_removal_reason';
export type Confidence = 'low' | 'medium' | 'high';
export type Severity = 'low' | 'medium' | 'high';
export type ContentStatus = 'compliant' | 'potential_concern' | 'likely_violation';
export type BehavioralStatus = 'normal' | 'potential_concern' | 'high_risk' | 'insufficient_data';

export interface AssessmentSignal {
  name: string;
  severity: Severity;
  evidence: string;
}

export interface ReviewRemovalAssessmentResult {
  overall_result: OverallResult;
  risk_score: number;
  confidence: Confidence;
  content_assessment: { status: ContentStatus; summary: string; signals: AssessmentSignal[] };
  behavioral_assessment: { status: BehavioralStatus; summary: string; signals: AssessmentSignal[] };
  likely_reason: string;
  policy_category: string;
  why_it_may_have_been_removed: string;
  evidence_summary: string;
  alternative_explanation: string;
  recommendation: string;
  assessment_note: string;
}

export interface AssessmentInput {
  platform: 'tp' | 'wo';
  reviewText: string;
  behavioralFields: Record<string, string | null>;
}

export const ASSESSMENT_FAILURE_MESSAGE = 'Unable to generate an AI assessment right now. Please try again later.';

// Real account-recovery secrets (confirmed `sensitive: true` in
// AddReviewAccountModal.tsx) — these carry zero analytical value for a
// review-removal assessment and must never be sent to an external AI
// provider or persisted into `entries.ai_review_analysis`, a column on a
// table this repo's own CLAUDE.md documents as fully public-readable via
// the anon key.
export const CREDENTIAL_FIELD_NAMES = new Set(['Backup Codes', 'Authenticator Backup']);

export function collectBehavioralFields(headers: string[], fields: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const h of headers) {
    if (CREDENTIAL_FIELD_NAMES.has(h)) continue;
    if (isYesNoCol(h) || isBehaviorExtraCol(h)) out[h] = fields[h] || null;
  }
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Deliberately excludes `status` — a pure status change (e.g. Pending -> Removed)
// with no content/behavioral change should still surface the last cached
// assessment rather than discarding it. See design spec's "Staleness" section.
export async function hashAssessmentInput(input: AssessmentInput): Promise<string> {
  const sortedFields = Object.keys(input.behavioralFields).sort().reduce<Record<string, string | null>>((acc, k) => {
    acc[k] = input.behavioralFields[k];
    return acc;
  }, {});
  const canonical = JSON.stringify({ platform: input.platform, reviewText: input.reviewText, behavioralFields: sortedFields });
  return sha256Hex(canonical);
}

const OVERALL_RESULTS = new Set<string>(['likely_publishable', 'uncertain', 'likely_removal_risk', 'no_clear_removal_reason']);
const CONFIDENCES = new Set<string>(['low', 'medium', 'high']);
const SEVERITIES = new Set<string>(['low', 'medium', 'high']);
const CONTENT_STATUSES = new Set<string>(['compliant', 'potential_concern', 'likely_violation']);
const BEHAVIORAL_STATUSES = new Set<string>(['normal', 'potential_concern', 'high_risk', 'insufficient_data']);
const REQUIRED_STRING_FIELDS = [
  'likely_reason', 'policy_category', 'why_it_may_have_been_removed',
  'evidence_summary', 'alternative_explanation', 'recommendation', 'assessment_note',
] as const;

function isValidSignal(s: unknown): s is AssessmentSignal {
  if (!s || typeof s !== 'object') return false;
  const sig = s as Record<string, unknown>;
  return typeof sig.name === 'string' && SEVERITIES.has(sig.severity as string) && typeof sig.evidence === 'string';
}

function isValidSignalGroup(g: unknown, statuses: Set<string>): g is { status: string; summary: string; signals: AssessmentSignal[] } {
  if (!g || typeof g !== 'object') return false;
  const group = g as Record<string, unknown>;
  return statuses.has(group.status as string)
    && typeof group.summary === 'string'
    && Array.isArray(group.signals)
    && group.signals.every(isValidSignal);
}

export function isValidAssessmentResult(data: unknown): data is ReviewRemovalAssessmentResult {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (!OVERALL_RESULTS.has(d.overall_result as string)) return false;
  if (typeof d.risk_score !== 'number') return false;
  if (!CONFIDENCES.has(d.confidence as string)) return false;
  if (!isValidSignalGroup(d.content_assessment, CONTENT_STATUSES)) return false;
  if (!isValidSignalGroup(d.behavioral_assessment, BEHAVIORAL_STATUSES)) return false;
  return REQUIRED_STRING_FIELDS.every((k) => typeof d[k] === 'string');
}

export async function requestReviewRemovalAssessment(
  input: AssessmentInput & { status: string },
): Promise<{ analysis: ReviewRemovalAssessmentResult; model: string }> {
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* fall back to anon key */
  }

  let res: Response;
  try {
    res = await fetch(REVIEW_REMOVAL_ASSESSMENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error(ASSESSMENT_FAILURE_MESSAGE);
  }
  if (!res.ok) throw new Error(ASSESSMENT_FAILURE_MESSAGE);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(ASSESSMENT_FAILURE_MESSAGE);
  }
  const parsed = body as { analysis?: unknown; model?: unknown };
  if (!isValidAssessmentResult(parsed.analysis)) throw new Error(ASSESSMENT_FAILURE_MESSAGE);
  const model = typeof parsed.model === 'string' ? parsed.model : 'gpt-4o';
  return { analysis: parsed.analysis, model };
}
