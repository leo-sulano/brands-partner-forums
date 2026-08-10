// supabase/functions/translate-review/index.ts
// Minimal translation proxy. Holds OPENAI_API_KEY (shared with ai-assistant),
// calls OpenAI once per request, no streaming, no tool-calling loop.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MODEL = 'gpt-4o-mini';

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (!req.headers.get('authorization')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: 'Translation not configured' }, 500);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }
  const text: string | undefined = body?.text;
  if (!text || typeof text !== 'string') {
    return jsonResponse({ error: 'Missing text' }, 400);
  }
  if (text.length > 10000) {
    return jsonResponse({ error: 'Review text is too long to translate' }, 400);
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: 'Translate the following review text into English. Return only the translation with no commentary, explanation, or quotation marks around it.',
          },
          { role: 'user', content: text },
        ],
        max_tokens: 2000,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    if (data.choices?.[0]?.finish_reason === 'length') {
      return jsonResponse({ error: 'Translation was too long to complete' }, 500);
    }
    const translation = data.choices?.[0]?.message?.content;
    if (typeof translation !== 'string') throw new Error('No translation in response');
    return jsonResponse({ translation: translation.trim() });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Translation failed' }, 500);
  }
});
