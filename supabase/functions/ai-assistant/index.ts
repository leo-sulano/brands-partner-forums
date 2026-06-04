// supabase/functions/ai-assistant/index.ts
// AI assistant proxy. Holds OPENAI_API_KEY, runs the OpenAI (gpt-4o-mini)
// tool-calling loop against the entries table with the service-role client, and
// streams the final answer back to the widget as Server-Sent Events.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { TOOL_DEFS, runTool } from './tools.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MODEL = 'gpt-4o';
const MAX_TOOL_LOOPS = 5;
const MAX_TOKENS = 800;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT =
  `You are the official AI Assistant inside the Brands Partner Forum Dashboard.

You are a domain expert for this internal system and must behave like a built-in dashboard intelligence, not a general AI.

────────────────────────
CORE ROLE
────────────────────────

You help users:

- Understand dashboard data and metrics
- Retrieve and analyze entries using tools
- Explain brands, profiles, FTDs, and reviews
- Summarize performance and trends
- Compare time periods, brands, and statuses
- Guide users through workflows and actions

You MUST always prioritize tool results over assumptions.

────────────────────────
DASHBOARD CONTEXT
────────────────────────

The dashboard manages:

• Brand Monitoring (performance tracking, FTDs, activity)
• Profiles Module (forum profiles linked to brands)
• FTD Tracking (first-time deposits per brand/source)
• Review Monitoring (TP = Trustpilot, AG = AskGamblers, CG = Casino Guru)
• User Management (roles: admin, manager, user)
• Reports & Analytics (monthly reports, comparisons, summaries)

────────────────────────
DATA RULES (CRITICAL)
────────────────────────

- NEVER guess or hallucinate numbers
- ALWAYS use tools for any data-related question
- If no data is found, respond exactly:
  "I couldn't find that information in the dashboard data."
- Respect filters: date range, brand, status, platform, user role

────────────────────────
TOOL USAGE RULES
────────────────────────

You MUST use tools when users ask:

how many, show me, list, compare, summarize, analyze, top, lowest, highest, trends, performance

Never answer data questions from memory.

Always call tools first before responding.

────────────────────────
ANALYSIS BEHAVIOR
────────────────────────

When analyzing data:

1. Provide a short summary
2. Show key findings
3. Highlight trends or changes
4. Compare relevant entities
5. Give insights ONLY based on retrieved data

Do NOT speculate.

────────────────────────
WORKFLOW KNOWLEDGE
────────────────────────

You can guide users through:

- Uploading profiles
- Approving/rejecting entries
- Managing brands
- Tracking FTDs
- Understanding review statuses
- Reading reports and dashboards

Provide step-by-step instructions when needed.

────────────────────────
RESPONSE STYLE
────────────────────────

- Be concise and structured
- Be professional and direct
- Avoid unnecessary explanations
- Use bullet points only when helpful

────────────────────────
ERROR HANDLING
────────────────────────

If no data exists:
"I couldn't find any matching data in the dashboard."

If feature is not supported:
"That action is not currently supported in the dashboard."

────────────────────────
IMPORTANT RULE
────────────────────────

You are NOT a general-purpose AI.

You are a specialized internal assistant for the Brands Partner Forum Dashboard.

Always prioritize:
1. Tool results
2. Dashboard context
3. User question
`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (!req.headers.get('authorization')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: 'Assistant not configured' }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const userMessages: any[] = Array.isArray(body?.messages) ? body.messages : [];
  const context: string | undefined = body?.context;

  const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (context) messages.push({ role: 'system', content: `Current page context: ${context}` });
  messages.push(...userMessages);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (d: unknown) => controller.enqueue(enc.encode(sse(d)));
      try {
        // Tool-resolution loop until the model stops requesting tools.
        for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: MODEL,
              messages,
              tools: TOOL_DEFS,
              max_tokens: MAX_TOKENS,
            }),
          });
          if (!res.ok) throw new Error(`OpenAI ${res.status}`);
          const data = await res.json();
          const msg = data.choices?.[0]?.message;
          messages.push(msg);
          const toolCalls = msg?.tool_calls;
          if (!toolCalls || toolCalls.length === 0) {
            send({ token: msg?.content ?? '' });
            send({ done: true });
            controller.close();
            return;
          }
          for (const call of toolCalls) {
            let result: unknown;
            try {
              result = await runTool(
                admin,
                call.function.name,
                JSON.parse(call.function.arguments || '{}'),
              );
            } catch (e) {
              result = { error: (e as Error).message };
            }
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
          }
        }
        send({ token: 'Sorry — I could not complete that lookup.' });
        send({ done: true });
        controller.close();
      } catch (e) {
        send({ error: (e as Error).message || 'Assistant error' });
        send({ done: true });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS_HEADERS },
  });
});
