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
const MODEL = 'gpt-4o-mini';
const MAX_TOOL_LOOPS = 5;
const MAX_TOKENS = 800;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT =
  `You are the assistant inside the Brands Partner Forum dashboard. ` +
  `You help staff understand forum-review data and draft replies. Data lives in the ` +
  `"entries" table; use the provided tools to look things up rather than guessing. ` +
  `Forum platforms are referred to as TP (Trustpilot), AG (AskGamblers), CG (CasinoGuru). ` +
  `When asked to summarize or draft a reply, call get_entry first for the exact text. ` +
  `Be concise. If a tool returns no data, say so plainly.`;

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
