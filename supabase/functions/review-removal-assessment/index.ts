// supabase/functions/review-removal-assessment/index.ts
// AI Review Removal Assessment proxy. Holds OPENAI_API_KEY (shared with
// ai-assistant/translate-review), calls OpenAI once per request in JSON
// mode, no streaming, no tool-calling loop, no DB access — all inputs
// (review text + this entry's own behavioral fields) arrive in the request
// body already.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MODEL = 'gpt-4o';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

const OUTPUT_SCHEMA = `{
  "overall_result": "likely_compliant | uncertain | at_risk | no_clear_concern",
  "risk_score": <integer 0-100, higher = more risk>,
  "confidence": "low | medium | high",
  "content_assessment": {
    "status": "compliant | potential_concern | likely_violation",
    "summary": "<1-3 sentences>",
    "signals": [{ "name": "<short label>", "severity": "low | medium | high", "evidence": "<what in the text supports this>" }]
  },
  "behavioral_assessment": {
    "status": "normal | potential_concern | high_risk | insufficient_data",
    "summary": "<1-3 sentences>",
    "signals": [{ "name": "<short label>", "severity": "low | medium | high", "evidence": "<which field/value supports this>" }]
  },
  "key_finding": {
    "label": "<one concrete, specific sentence naming the single most decisive factor — never a vague category alone>",
    "confidence": "low | medium | high",
    "alternatives": [{ "label": "<specific alternative>", "likelihood": "low | medium | high" }]
  },
  "supporting_evidence": ["<concrete point>"],
  "contrary_evidence": ["<concrete point>"],
  "policy_category": "<one category from the list provided above, or the WO caveat text, or empty string if none applies>",
  "risk_or_removal_explanation": "<1-3 sentences>",
  "evidence_summary": "<1-3 sentences summarizing all evidence considered, including what was NOT available>",
  "alternative_explanation": "<1-2 sentences on a non-policy explanation, e.g. platform moderation error>",
  "recommendation": "<1-2 sentences, actionable>",
  "agent_recommendation": {
    "summary": "<1-2 sentences, addressed directly to the agent/writer, on what to do differently next time>",
    "specific_actions": ["<concrete, behavioral action an agent can change>"]
  },
  "assessment_note": "<leave this field's exact wording to the system — you do not need to fill this in accurately>"
}`;

const TP_GUIDELINE_CATEGORIES = `
Trustpilot's real published Guidelines for Reviewers (June 2026 revision)
and Action We Take policy (March 2026 revision) require a review to meet
ALL of the following. Use ONLY these as "policy_category" values (or empty
string if none apply) — do not invent others:
- Genuine Experience / No Fake Reviews: must reflect a real, first-hand
  purchase, service, or interaction with the business — not a fabricated,
  exaggerated, or otherwise non-genuine account.
- No Incentivized Reviews: the reviewer must not have received or been
  offered any incentive (discount, promo code, refund, prize-draw entry,
  freebie, or other benefit) in connection with writing or editing the
  review.
- No Conflict of Interest: not from the business's owner, employee,
  immediate family member, shareholder, or a competitor.
- No Multiple Accounts: one reviewer is limited to one verified account —
  cross-reference this against the account-level evidence you're given
  (e.g. the same proxy/IP used across multiple entries or brands) rather
  than reasoning about it in the abstract.
- No Personal/Private Data: must not expose another identifiable
  individual's personal information (name, phone, email, photo/video).
- No Promotional/Spam Content: must not exist mainly to advertise, contain
  marketing language, links, contact details, or calls to action for other
  products/services.
- No Defamatory, Threatening, Hateful, or Obscene Content: no hate speech,
  threats or incitement to harm, severe profanity, or explicit/illegal
  content.
- Correct Business Targeting: the review must be about the specific
  business it's posted against, not a different or unrelated business.
- No Misinformation or AI-Generated/Impersonated Content: must not spread
  confirmed-false claims or be generated/posted to impersonate a genuine
  reviewer.
- One Review Per Unique Experience: a reviewer may only post more than one
  review for the same business if each reflects a genuinely separate,
  distinct experience.

Trustpilot also enforces at two distinct levels — do not conflate them: a
single review is removed for a content-specific violation (any category
above), while a full business profile is suspended/restricted only for
repeated or pattern-level misuse (e.g. many fake/incentivized reviews, a
review-buying scheme). When assessing why one specific review was removed,
reason about that review's own violation — do not imply the whole brand
page was actioned unless the evidence you're given is actually about
page-level removal.
`;

const WO_POLICY_CAVEAT = `
Wizard of Odds does not have a confirmed, publicly documented review
moderation policy equivalent to Trustpilot's Guidelines for Reviewers. Do
NOT invent or imply a specific Wizard of Odds policy. Set "policy_category"
to "No confirmed Wizard of Odds policy framework available" and reason only
from general genuine-review integrity principles for the content
assessment (real, specific personal experience; free of promotional/spam
language; not generic or templated).
`;

// Shared by both AskGamblers and Casino Guru — neither has a confirmed
// public review-moderation policy equivalent to Trustpilot's, and this
// dashboard's own prior research (a spike testing 4 brands already known
// dead on Trustpilot against their AskGamblers/CasinoGuru pages) found all
// 4 still fully live on both platforms — no removed/delisted state found.
// That doesn't prove either platform never removes a review, but it is
// real evidence worth weighing toward "no clear removal reason" rather
// than assuming a policy violation, which is why it's surfaced here rather
// than left as silent context only this codebase's maintainers know.
function agCgPolicyCaveat(platformLabel: string): string {
  return `
${platformLabel} does not have a confirmed, publicly documented review
moderation policy equivalent to Trustpilot's Guidelines for Reviewers. Do
NOT invent or imply a specific ${platformLabel} policy. Set
"policy_category" to "No confirmed ${platformLabel} policy framework
available" and reason only from general genuine-review integrity
principles for the content assessment (real, specific personal experience;
free of promotional/spam language; not generic or templated).

Additional context: prior research on this dashboard tested several
brands already confirmed to have had their Trustpilot page removed, and
found their ${platformLabel} pages still fully live and populated (real
ratings, review counts intact) — no delisted/removed state was found. This
is not proof ${platformLabel} never removes a review, but it is real
evidence that ${platformLabel} may not delist a page just because the
underlying business closed or was flagged elsewhere — weigh this when
deciding between "at_risk" and "no_clear_concern" for
this platform specifically, and note it explicitly in "evidence_summary"
or "alternative_explanation" when it's relevant to your conclusion.
`;
}

const AI_RULES = `
Rules you MUST follow:
- Analyze evidence rather than assume a violation — a review being
  Removed/Refused does not by itself prove anything was wrong with it.
- Distinguish content problems from behavioral problems; they are separate
  assessments and can disagree.
- Consider both positive and negative evidence — note what looks fine, not
  only what looks concerning.
- Explain exactly what evidence led to each conclusion; never assert a
  finding without pointing to the specific text or field supporting it.
- Reference the applicable guideline category when possible (Trustpilot
  reviews only — AskGamblers, Casino Guru, and Wizard of Odds have no
  confirmed public policy, so use their caveat text instead).
- If evidence is genuinely insufficient or the review looks compliant, say
  so plainly ("no_clear_concern") — do not manufacture a
  justification.
- Never fabricate a Trustpilot, AskGamblers, Casino Guru, or Wizard of Odds
  policy beyond what is given to you above.
- Never claim certainty about the platform's actual internal moderation
  decision — you only have partial, indirect evidence.
- Never automatically classify a review as fake.
- Never assume a positive, short, or generic-sounding review is
  automatically suspicious or removable.
- Never assume a single behavioral signal alone proves manipulation — these
  are indicators only, weigh them alongside the content.
- Give every signal an explicit severity (low/medium/high) and evidence.
- Always state an overall confidence level (low/medium/high).
- You MUST populate both "supporting_evidence" and "contrary_evidence" — a
  real assessment always has something on both sides, even if one side is thin
  (e.g. "no positive evidence beyond the review's polite tone").
- "key_finding.label" must name a specific, concrete factor, not a bare category —
  "possible coordinated review activity" alone is not acceptable; name what
  specifically suggests it (e.g. "posted 4 minutes after a welcome-email redirect,
  from a proxy already tied to 2 other removed reviews for different brands").
- The request body's "evidence" object contains deterministic, code-computed facts
  (cross-entry proxy/country matches, this brand's historical outcomes on this
  platform, this entry's status on other platforms if applicable, and hard
  signals). Treat every value in "evidence" as ground truth — never contradict,
  adjust, or re-derive these numbers; reason from them, don't reinterpret them.
- If evidence.hardSignals.duplicateReviewTextFound or
  evidence.hardSignals.proxyTiedToOtherRemoval is true, that signal MUST appear as
  your top-ranked "key_finding" candidate unless you explicitly explain in
  "contrary_evidence" why it does not apply to this specific case.
  Note: "proxyTiedToOtherRemoval" means the proxy was tied to a removal on ANY
  platform this tab tracks, not necessarily the platform you are currently
  assessing — state which platform(s) the removal(s) were actually on if you
  cite this signal, rather than implying it happened on the platform under review.
- For Trustpilot specifically, if evidence.crossEntry.sameProxyCount or
  evidence.crossEntry.sameProxySameCountryCount is greater than 0, weigh this
  explicitly against the "No Multiple Accounts" guideline category — cite the
  actual count in your reasoning rather than a vague reference to "shared
  proxy activity."
- "agent_recommendation.specific_actions" must be concrete and behavioral (things a
  human agent can change about how or when they act) — never a restatement of
  platform policy.
`;

type Platform = 'tp' | 'ag' | 'cg' | 'wo';

const PLATFORM_LABEL: Record<Platform, string> = {
  tp: 'Trustpilot',
  ag: 'AskGamblers',
  cg: 'Casino Guru',
  wo: 'Wizard of Odds',
};

const ASSESSMENT_NOTE_BY_PLATFORM: Record<Platform, string> = {
  tp: "This is an AI assessment based on the available review, dashboard data, behavioral signals, and Trustpilot's published guidelines. It does not confirm Trustpilot's private/internal moderation decision.",
  ag: "This is an AI assessment based on the available review, dashboard data, and behavioral signals. AskGamblers does not have a confirmed public review moderation policy, so this assessment does not reference one, and it does not confirm AskGamblers' private/internal moderation decision.",
  cg: "This is an AI assessment based on the available review, dashboard data, and behavioral signals. Casino Guru does not have a confirmed public review moderation policy, so this assessment does not reference one, and it does not confirm Casino Guru's private/internal moderation decision.",
  wo: "This is an AI assessment based on the available review, dashboard data, and behavioral signals. Wizard of Odds does not have a confirmed public review moderation policy, so this assessment does not reference one, and it does not confirm Wizard of Odds' private/internal moderation decision.",
};

function buildSystemPrompt(platform: Platform, status: string): string {
  const removedLike = /remov|refus|reject/i.test(status);
  const framing = removedLike
    ? `This review's current recorded status is "${status || 'unknown'}" (a removed/refused-type status). Frame "key_finding" and "risk_or_removal_explanation" as explaining why the review may have been removed — or state plainly that no clear reason is evident.`
    : `This review's current recorded status is "${status || 'unknown'}" (not a removed/refused-type status). This is a live/pending review, not a removed one — give a two-sided read, not just risk avoidance. First, the forward-looking risk read: what WOULD put this review at risk if it were reviewed today, framed in "risk_or_removal_explanation" — or state that no meaningful risk is evident. Second, and just as important: use "contrary_evidence" and "content_assessment.summary" to name concrete, specific things in the review's own text (word choice, specificity of detail, plausibility, consistency with the account's other behavior) that support it reading as genuine and compliant — do not limit this to "no risk found," actually point to what's good about it. Set "key_finding" to whichever of the two is more decisive for this review — a real risk factor if one clearly exists, or its standout strength if the evidence leans compliant. Do not claim the review was actually removed.`;

  const platformLabel = PLATFORM_LABEL[platform];

  let policySection: string;
  if (platform === 'tp') policySection = TP_GUIDELINE_CATEGORIES;
  else if (platform === 'wo') policySection = WO_POLICY_CAVEAT;
  else policySection = agCgPolicyCaveat(platformLabel);

  return [
    `You are an evidence-based review compliance analyst for an internal dashboard. You analyze one ${platformLabel} review's content and its account's recorded behavioral data, and assess whether the available evidence explains a possible removal or removal risk — and, for a review that has not been removed, what supports it reading as genuine and compliant.`,
    ``,
    `CORE PRINCIPLE: Do NOT assume "the review was removed, therefore something is wrong with it." Instead ask "does the available evidence explain this?" Concluding no clear reason is evident is a fully valid, expected outcome — do not reverse-engineer a justification for a removal.`,
    ``,
    framing,
    ``,
    policySection,
    AI_RULES,
    `Return ONLY a single JSON object matching exactly this shape (fill in every field; do not add or omit keys):`,
    OUTPUT_SCHEMA,
  ].join('\n');
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (!req.headers.get('authorization')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: 'Assessment not configured' }, 500);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const platform = body?.platform;
  const status = typeof body?.status === 'string' ? body.status : '';
  const reviewText = typeof body?.reviewText === 'string' ? body.reviewText : '';
  const behavioralFields = body?.behavioralFields && typeof body.behavioralFields === 'object' ? body.behavioralFields : {};
  const rawEvidence = body?.evidence;
  const evidence = rawEvidence && typeof rawEvidence === 'object' && !Array.isArray(rawEvidence) ? rawEvidence : {};

  // Defense-in-depth: never trust the client alone to have excluded these.
  // Backup Codes / Authenticator Backup are real account-recovery secrets
  // and must never reach OpenAI or be echoed back for persistence.
  const CREDENTIAL_FIELD_NAMES = new Set(['Backup Codes', 'Authenticator Backup']);
  for (const key of Object.keys(behavioralFields)) {
    if (CREDENTIAL_FIELD_NAMES.has(key)) delete behavioralFields[key];
  }

  if (platform !== 'tp' && platform !== 'ag' && platform !== 'cg' && platform !== 'wo') {
    return jsonResponse({ error: 'platform must be "tp", "ag", "cg", or "wo"' }, 400);
  }
  if (!reviewText.trim()) {
    return jsonResponse({ error: 'Missing reviewText' }, 400);
  }
  if (reviewText.length > 10000) {
    return jsonResponse({ error: 'Review text is too long to analyze' }, 400);
  }

  // The evidence bundle is a small, code-computed object (counts, a handful of
  // strings, an example-brands list capped at 5) — this is not a real-world
  // limit, just a defensive cap so a malformed/oversized payload can't inflate
  // the prompt or the OpenAI bill the way an unbounded `reviewText` could.
  const evidenceJson = JSON.stringify(evidence);
  if (evidenceJson.length > 5000) {
    return jsonResponse({ error: 'Evidence payload is too large to analyze' }, 400);
  }

  const userPayload = JSON.stringify({ reviewText, behavioralFields, evidence }, null, 2);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: 'json_object' },
        temperature: 0,
        messages: [
          { role: 'system', content: buildSystemPrompt(platform, status) },
          { role: 'user', content: `Review and behavioral data:\n${userPayload}` },
        ],
        max_tokens: 2400,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    if (data.choices?.[0]?.finish_reason === 'length') {
      return jsonResponse({ error: 'Assessment response was too long to complete' }, 500);
    }
    const raw = data.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') throw new Error('No content in response');
    let analysis: unknown;
    try {
      analysis = JSON.parse(raw);
    } catch {
      throw new Error('Model did not return valid JSON');
    }
    if (analysis && typeof analysis === 'object') {
      (analysis as Record<string, unknown>).assessment_note = ASSESSMENT_NOTE_BY_PLATFORM[platform as Platform];
    }
    return jsonResponse({ analysis, model: MODEL });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Assessment failed' }, 500);
  }
});
