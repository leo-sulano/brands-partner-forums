import { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, ChevronDown } from 'lucide-react';
import type { Entry } from '../types/entry';
import {
  ASSESSMENT_FAILURE_MESSAGE,
  collectBehavioralFields,
  hashAssessmentInput,
  isValidAssessmentResult,
  requestReviewRemovalAssessment,
  type ReviewRemovalAssessmentResult,
  type AssessmentSignal,
} from '../lib/reviewRemovalAssessment';
import { computeRemovalEvidence } from '../lib/reviewRemovalEvidence';
import { saveReviewAnalysis } from '../lib/queries';
import { PLATFORM_SHORT_LABEL, type Platform } from '../lib/scoreSummary';
import Tooltip from './Tooltip';

interface Props {
  entry: Entry;
  tab: string;
  platform: Platform;
  status: string;
  reviewText: string;
  headers: string[];
  fields: Record<string, string>;
  tabEntries: Entry[];
  brand: string;
  cachedAnalysis: ReviewRemovalAssessmentResult | null;
  cachedHash: string | null;
  disabled?: boolean;
}

const OVERALL_META: Record<ReviewRemovalAssessmentResult['overall_result'], { emoji: string; label: string }> = {
  likely_publishable: { emoji: '🟢', label: 'Likely Publishable' },
  uncertain: { emoji: '🟡', label: 'Uncertain / Insufficient Evidence' },
  likely_removal_risk: { emoji: '🔴', label: 'Likely Removal Risk' },
  no_clear_removal_reason: { emoji: '⚪', label: 'No Clear Removal Reason' },
};

const CONTENT_STATUS_META: Record<ReviewRemovalAssessmentResult['content_assessment']['status'], { emoji: string; label: string }> = {
  compliant: { emoji: '🟢', label: 'Compliant' },
  potential_concern: { emoji: '🟡', label: 'Potential Concern' },
  likely_violation: { emoji: '🔴', label: 'Likely Policy Issue' },
};

const BEHAVIORAL_STATUS_META: Record<ReviewRemovalAssessmentResult['behavioral_assessment']['status'], { emoji: string; label: string }> = {
  normal: { emoji: '🟢', label: 'Normal' },
  potential_concern: { emoji: '🟠', label: 'Potential Concern' },
  high_risk: { emoji: '🔴', label: 'High Risk' },
  insufficient_data: { emoji: '⚪', label: 'Insufficient Data' },
};

function riskBucket(score: number): { emoji: string; label: string } {
  if (score >= 70) return { emoji: '🔴', label: 'High' };
  if (score >= 40) return { emoji: '🟠', label: 'Medium' };
  return { emoji: '🟢', label: 'Low' };
}

function evidenceSummaryLine(evidence: ReturnType<typeof computeRemovalEvidence>): string | null {
  const parts: string[] = [];
  const { crossEntry, brandHistory, crossPlatform } = evidence;

  if (crossEntry.sameProxyCount > 0) {
    const removedNote = crossEntry.sameProxyRemovedCount > 0 ? ` (${crossEntry.sameProxyRemovedCount} removed)` : '';
    parts.push(`Same proxy: ${crossEntry.sameProxyCount} other entr${crossEntry.sameProxyCount === 1 ? 'y' : 'ies'}${removedNote}`);
  }
  if (brandHistory.totalReviews > 0) {
    const pctNote = brandHistory.successRatePct != null ? ` (${brandHistory.successRatePct}%)` : '';
    parts.push(`Brand history: ${brandHistory.liveCount}/${brandHistory.totalReviews} live${pctNote}`);
  }
  if (crossPlatform.applicable) {
    const otherParts = Object.entries(crossPlatform.other)
      .filter(([, v]) => v && v.status)
      .map(([p, v]) => `${PLATFORM_SHORT_LABEL[p as keyof typeof PLATFORM_SHORT_LABEL]} ${v!.status}`);
    if (otherParts.length > 0) parts.push(`Other platforms: ${otherParts.join(', ')}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

const SEVERITY_RANK: Record<AssessmentSignal['severity'], number> = { high: 0, medium: 1, low: 2 };

function SignalBadge({ signal }: { signal: AssessmentSignal }) {
  const icon = signal.severity === 'low' ? '✓' : '⚠';
  const color = signal.severity === 'high'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : signal.severity === 'medium'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <Tooltip content={signal.evidence} className={`items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {icon} {signal.name}
    </Tooltip>
  );
}

export default function ReviewRemovalAssessment({ entry, tab, platform, status, reviewText, headers, fields, tabEntries, brand, cachedAnalysis, cachedHash, disabled }: Props) {
  const [result, setResult] = useState<ReviewRemovalAssessmentResult | null>(
    isValidAssessmentResult(cachedAnalysis) ? cachedAnalysis : null,
  );
  // Tracked as state (not read directly off a prop on every render) so a
  // successful analyze/re-analyze can update the "last saved" baseline
  // without mutating the prop — React props are treated as read-only.
  const [savedHash, setSavedHash] = useState<string | null>(cachedHash ?? null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const behavioralFields = useMemo(() => collectBehavioralFields(headers, fields), [headers, fields]);
  const evidence = useMemo(
    () => computeRemovalEvidence(tabEntries, entry, platform, brand, tab),
    [tabEntries, entry, platform, brand, tab],
  );

  useEffect(() => {
    let cancelled = false;
    hashAssessmentInput({ platform, reviewText, behavioralFields, evidence }).then((h) => {
      if (!cancelled) setCurrentHash(h);
    });
    return () => {
      cancelled = true;
    };
  }, [platform, reviewText, behavioralFields, evidence]);

  const isStale = result !== null && currentHash !== null && savedHash !== currentHash;
  const hasFreshResult = result !== null && !isStale;

  async function handleAnalyze() {
    if (!reviewText.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { analysis, model } = await requestReviewRemovalAssessment({ platform, status, reviewText, behavioralFields, evidence });
      const hash = currentHash ?? (await hashAssessmentInput({ platform, reviewText, behavioralFields, evidence }));
      await saveReviewAnalysis(entry.id, tab, platform, analysis, evidence, hash, model);
      setResult(analysis);
      setSavedHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : ASSESSMENT_FAILURE_MESSAGE);
    } finally {
      setLoading(false);
    }
  }

  if (!reviewText.trim() && !result) return null;

  const evidenceLine = evidenceSummaryLine(evidence);

  return (
    <div className="mt-3 rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">AI Review Removal Assessment</span>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={disabled || loading || !reviewText.trim()}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />}
          {loading ? 'Analyzing…' : hasFreshResult ? 'Re-analyze' : 'Analyze Review'}
        </button>
      </div>

      {error && (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
      )}

      {evidenceLine && (
        <div className="mt-2 rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
          {evidenceLine}
        </div>
      )}

      {result && (
        <div className="mt-3 space-y-2">
          {isStale && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
              Outdated — review or related dashboard data changed since this assessment was generated.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
            <span>Risk: {riskBucket(result.risk_score).emoji} {riskBucket(result.risk_score).label}</span>
            <span>Assessment: {OVERALL_META[result.overall_result].emoji} {OVERALL_META[result.overall_result].label}</span>
            <span>Confidence: {result.confidence.charAt(0).toUpperCase() + result.confidence.slice(1)}</span>
          </div>

          <div className="text-xs text-slate-600">
            <div><span className="font-medium text-slate-700">Root Cause:</span> {result.root_cause.label || '—'} <span className="text-slate-400">({result.root_cause.confidence} confidence)</span></div>
          </div>

          {(result.content_assessment.signals.length > 0 || result.behavioral_assessment.signals.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {[...result.content_assessment.signals, ...result.behavioral_assessment.signals]
                .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
                .slice(0, 6)
                .map((s, i) => <SignalBadge key={`${s.name}-${i}`} signal={s} />)}
            </div>
          )}

          {result.agent_recommendation.summary && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-800">
              <span className="font-medium">For Next Time:</span> {result.agent_recommendation.summary}
              {result.agent_recommendation.specific_actions.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {result.agent_recommendation.specific_actions.map((action, i) => <li key={i}>{action}</li>)}
                </ul>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            <ChevronDown className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'Hide AI Assessment' : 'View AI Assessment'}
          </button>

          {expanded && (
            <div className="space-y-2 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              <div>
                <span className="font-medium text-slate-700">
                  Content Assessment ({CONTENT_STATUS_META[result.content_assessment.status].emoji} {CONTENT_STATUS_META[result.content_assessment.status].label}):
                </span>{' '}
                {result.content_assessment.summary}
              </div>
              <div>
                <span className="font-medium text-slate-700">
                  Behavioral Assessment ({BEHAVIORAL_STATUS_META[result.behavioral_assessment.status].emoji} {BEHAVIORAL_STATUS_META[result.behavioral_assessment.status].label}):
                </span>{' '}
                {result.behavioral_assessment.summary}
              </div>
              {result.root_cause.alternative_causes.length > 0 && (
                <div>
                  <span className="font-medium text-slate-700">Alternative Causes:</span>
                  <ul className="mt-0.5 list-disc pl-4">
                    {result.root_cause.alternative_causes.map((c, i) => <li key={i}>{c.label} <span className="text-slate-400">({c.likelihood})</span></li>)}
                  </ul>
                </div>
              )}
              {result.evidence_for_removal.length > 0 && (
                <div>
                  <span className="font-medium text-slate-700">Evidence For Removal:</span>
                  <ul className="mt-0.5 list-disc pl-4">
                    {result.evidence_for_removal.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              {result.evidence_against_removal.length > 0 && (
                <div>
                  <span className="font-medium text-slate-700">Evidence Against Removal:</span>
                  <ul className="mt-0.5 list-disc pl-4">
                    {result.evidence_against_removal.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              <div><span className="font-medium text-slate-700">Policy Category:</span> {result.policy_category || '—'}</div>
              <div><span className="font-medium text-slate-700">Why:</span> {result.why_it_may_have_been_removed || '—'}</div>
              <div><span className="font-medium text-slate-700">Evidence:</span> {result.evidence_summary || '—'}</div>
              <div><span className="font-medium text-slate-700">Alternative Explanation:</span> {result.alternative_explanation || '—'}</div>
              <div><span className="font-medium text-slate-700">Recommendation:</span> {result.recommendation || '—'}</div>
              <div className="pt-1 text-[11px] italic text-slate-400">{result.assessment_note}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
