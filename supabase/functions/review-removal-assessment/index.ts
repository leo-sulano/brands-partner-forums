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
  "overall_result": "likely_publishable | uncertain | likely_removal_risk | no_clear_removal_reason",
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
  "likely_reason": "<short phrase>",
  "policy_category": "<one category from the list provided above, or the WO caveat text, or empty string if none applies>",
  "why_it_may_have_been_removed": "<1-3 sentences>",
  "evidence_summary": "<1-3 sentences summarizing all evidence considered, including what was NOT available>",
  "alternative_explanation": "<1-2 sentences on a non-policy explanation, e.g. platform moderation error>",
  "recommendation": "<1-2 sentences, actionable>",
  "assessment_note": "<leave this field's exact wording to the system — you do not need to fill this in accurately>"
}`;

const TP_GUIDELINE_CATEGORIES = `
Trustpilot's real published Guidelines for Reviewers require a review to
meet ALL of the following. Use ONLY these as "policy_category" values (or
empty string if none apply) — do not invent others:
- Genuine Experience: must be based on a real, first-hand purchase,
  service, or interaction with the business.
- Relevance: must relate to the reviewer's own experience with that
  specific business, not a general or unrelated opinion.
- No Promotional/Spam Content: must not exist mainly to advertise, contain
  marketing language, links, contact details, or be posted for
  compensation/incentive without clear disclosure.
- No Conflict of Interest: not from a competitor, employee, or anyone with
  an undisclosed business relationship to the company.
- No Defamatory, Offensive, or Illegal Content: no hate speech, threats,
  harassment, discrimination, or unlawful content.
- No Personal/Private Data: must not expose private information about an
  identifiable individual.
- One Review Per Experience: a reviewer should not post multiple reviews
  for the same single experience.
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
deciding between "likely_removal_risk" and "no_clear_removal_reason" for
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
  so plainly ("no_clear_removal_reason") — do not manufacture a
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
    ? `This review's current recorded status is "${status || 'unknown'}" (a removed/refused-type status). Frame "likely_reason" and "why_it_may_have_been_removed" as explaining why the review may have been removed — or state plainly that no clear reason is evident.`
    : `This review's current recorded status is "${status || 'unknown'}" (not a removed/refused-type status). Frame "likely_reason" and "why_it_may_have_been_removed" as a forward-looking risk read — what WOULD put this review at risk if it were reviewed today — or state that no meaningful risk is evident. Do not claim the review was actually removed.`;

  const platformLabel = PLATFORM_LABEL[platform];

  let policySection: string;
  if (platform === 'tp') policySection = TP_GUIDELINE_CATEGORIES;
  else if (platform === 'wo') policySection = WO_POLICY_CAVEAT;
  else policySection = agCgPolicyCaveat(platformLabel);

  return [
    `You are an evidence-based review compliance analyst for an internal dashboard. You analyze one ${platformLabel} review's content and its account's recorded behavioral data, and assess whether the available evidence explains a possible removal — or, if not removed, a removal risk.`,
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

  const userPayload = JSON.stringify({ reviewText, behavioralFields }, null, 2);

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
        messages: [
          { role: 'system', content: buildSystemPrompt(platform, status) },
          { role: 'user', content: `Review and behavioral data:\n${userPayload}` },
        ],
        max_tokens: 1800,
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
