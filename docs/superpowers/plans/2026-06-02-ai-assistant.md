# AI Assistant (GPT-4o mini) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating GPT-4o-mini chat assistant to the dashboard, backed by a Supabase Edge Function proxy with read-only tool calling over the `entries` table and SSE streaming.

**Architecture:** A React `AssistantWidget` (mounted once in `AppLayout`) streams chat to/from a new Supabase Edge Function `ai-assistant`. The function holds `OPENAI_API_KEY`, runs the OpenAI tool-calling loop, executes read-only queries against `entries` with the service-role client, and streams the final answer back as SSE.

**Tech Stack:** React 19 + TS (Vite), Supabase Edge Functions (Deno), OpenAI Chat Completions API (`gpt-4o-mini`), `lucide-react` icons, Tailwind v4.

---

## File Structure

**Create:**
- `supabase/functions/ai-assistant/tools.ts` — tool definitions + pure helpers (field pick, score parse, row mapping, query building) + tool dispatch against a Supabase client.
- `supabase/functions/ai-assistant/tools_test.ts` — Deno tests for the pure helpers.
- `supabase/functions/ai-assistant/index.ts` — Deno.serve handler: CORS, OpenAI streaming tool-call loop, SSE output.
- `src/lib/assistant.ts` — frontend client: builds request, POSTs to the function, parses SSE, yields tokens via callback.
- `src/components/AssistantWidget.tsx` — floating button + slide-in chat panel.
- `src/contexts/AssistantContext.tsx` — tiny context so any page can open the widget pre-seeded (used by MentionDetail buttons).

**Modify:**
- `src/lib/supabase.ts` — add `AI_ASSISTANT_URL` export.
- `src/App.tsx` — wrap layout in `AssistantProvider`, mount `<AssistantWidget />` in `AppLayout`.
- `src/pages/MentionDetail.tsx` — add **Summarize** / **Draft reply** buttons that open the widget pre-seeded.

---

## Task 1: Edge Function tool helpers + tests

**Files:**
- Create: `supabase/functions/ai-assistant/tools.ts`
- Test: `supabase/functions/ai-assistant/tools_test.ts`

- [ ] **Step 1: Write `tools.ts` pure helpers + tool schema**

```ts
// supabase/functions/ai-assistant/tools.ts
// deno-lint-ignore-file no-explicit-any

// --- field picking (ported from src/lib/queries.ts + scoreSummary.ts) ---
export function pick(data: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) {
    const v = data?.[k];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return null;
}

const BRAND_KEYS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE'];
const ACCOUNT_KEYS = ['Account Name', 'account_name', 'casino', 'Casino', 'name', 'Name'];
const STATUS_KEYS = ['TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status', 'Review Status', 'status', 'Status'];
const SCORE_KEYS = ['TP Score added', 'Score added', 'Score Added', 'Score'];
const DATE_KEYS = ['Trust Pilot', 'Score added', 'posted_at', 'Posted At', 'date', 'Date'];

export type Star = 1 | 2 | 3 | 4 | 5;

export function parseScore(raw: string | null | undefined): Star | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^[1-5]$/.test(s)) return null;
  return Number(s) as Star;
}

export interface EntryRow { id: string; tab: string; data: Record<string, any>; }

export function mapEntrySummary(e: EntryRow) {
  return {
    id: e.id,
    tab: e.tab,
    brand: pick(e.data, BRAND_KEYS),
    account: pick(e.data, ACCOUNT_KEYS),
    status: pick(e.data, STATUS_KEYS),
    score: pick(e.data, SCORE_KEYS),
    date: pick(e.data, DATE_KEYS),
  };
}

// Free-text match across all stringified values in `data`.
export function entryMatches(e: EntryRow, contains: string): boolean {
  const needle = contains.trim().toLowerCase();
  if (!needle) return true;
  for (const v of Object.values(e.data ?? {})) {
    if (v != null && String(v).toLowerCase().includes(needle)) return true;
  }
  return false;
}

export function matchesStatus(e: EntryRow, status: string): boolean {
  const want = status.trim().toLowerCase();
  const have = (pick(e.data, STATUS_KEYS) ?? '').trim().toLowerCase();
  return have === want;
}

// Published-only star rollup, grouped by `${tab} ${brand}`. Mirrors computeScoreSummary.
export function scoreSummary(entries: EntryRow[]) {
  const buckets = new Map<string, { tab: string; brand: string; counts: Record<Star, number>; unrated: number }>();
  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;
    const status = (pick(e.data, STATUS_KEYS) ?? '').trim().toLowerCase();
    if (status !== 'published') continue;
    const key = `${e.tab} ${brand}`;
    let b = buckets.get(key);
    if (!b) { b = { tab: e.tab, brand, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, unrated: 0 }; buckets.set(key, b); }
    const sc = parseScore(pick(e.data, SCORE_KEYS));
    if (sc == null) b.unrated += 1; else b.counts[sc] += 1;
  }
  return [...buckets.values()].map((b) => {
    const rated = b.counts[1] + b.counts[2] + b.counts[3] + b.counts[4] + b.counts[5];
    const total = rated + b.unrated;
    const average = rated === 0 ? null
      : Math.round(((b.counts[1] + 2 * b.counts[2] + 3 * b.counts[3] + 4 * b.counts[4] + 5 * b.counts[5]) / rated) * 10) / 10;
    return { tab: b.tab, brand: b.brand, counts: b.counts, unrated: b.unrated, rated, total, average };
  });
}

// --- OpenAI tool schemas ---
export const TOOL_DEFS = [
  { type: 'function', function: { name: 'list_tabs', description: 'List the distinct brand-group tabs available.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'query_entries', description: 'Search forum entries. Filter by tab, status (e.g. Published, Removed, Refused), and/or a free-text contains match. Returns summary rows and total count.', parameters: { type: 'object', properties: { tab: { type: 'string' }, status: { type: 'string' }, contains: { type: 'string' }, limit: { type: 'number', description: 'max rows to return, default 25' } } } } },
  { type: 'function', function: { name: 'get_entry', description: 'Fetch one entry by id with its full data, for summarizing or drafting a reply.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'get_score_summary', description: 'Published-only star-rating rollup per brand, optionally filtered to one tab.', parameters: { type: 'object', properties: { tab: { type: 'string' } } } } },
];

// --- tool dispatch (impure: needs a supabase client) ---
export async function runTool(supabase: any, name: string, args: any): Promise<unknown> {
  if (name === 'list_tabs') {
    const { data, error } = await supabase.from('entries').select('tab');
    if (error) throw error;
    return { tabs: [...new Set((data ?? []).map((r: any) => r.tab))].sort() };
  }
  if (name === 'query_entries') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    let rows: EntryRow[] = data ?? [];
    if (args?.status) rows = rows.filter((e) => matchesStatus(e, args.status));
    if (args?.contains) rows = rows.filter((e) => entryMatches(e, args.contains));
    const total = rows.length;
    const limit = Math.min(Number(args?.limit) || 25, 50);
    return { total, rows: rows.slice(0, limit).map(mapEntrySummary) };
  }
  if (name === 'get_entry') {
    const { data, error } = await supabase.from('entries').select('id, tab, data').eq('id', args?.id).maybeSingle();
    if (error) throw error;
    return data ?? { error: 'not found' };
  }
  if (name === 'get_score_summary') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { brands: scoreSummary(data ?? []) };
  }
  return { error: `unknown tool: ${name}` };
}
```

- [ ] **Step 2: Write `tools_test.ts`**

```ts
// supabase/functions/ai-assistant/tools_test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { pick, parseScore, mapEntrySummary, entryMatches, matchesStatus, scoreSummary } from './tools.ts';

Deno.test('pick falls through key variants and skips blanks', () => {
  assertEquals(pick({ 'Brand': '', 'Brands': 'Acme' }, ['Brand', 'Brands']), 'Acme');
  assertEquals(pick({}, ['Brand']), null);
});

Deno.test('parseScore accepts 1-5 only', () => {
  assertEquals(parseScore('4'), 4);
  assertEquals(parseScore('0'), null);
  assertEquals(parseScore('x'), null);
});

Deno.test('entryMatches is case-insensitive across values', () => {
  const e = { id: '1', tab: 't', data: { note: 'Big WIN here' } };
  assertEquals(entryMatches(e, 'win'), true);
  assertEquals(entryMatches(e, 'loss'), false);
});

Deno.test('matchesStatus compares normalized status', () => {
  const e = { id: '1', tab: 't', data: { 'Review Status': 'Published' } };
  assertEquals(matchesStatus(e, 'published'), true);
  assertEquals(matchesStatus(e, 'removed'), false);
});

Deno.test('scoreSummary counts Published only', () => {
  const entries = [
    { id: '1', tab: 't', data: { Brand: 'A', 'Review Status': 'Published', 'Score added': '5' } },
    { id: '2', tab: 't', data: { Brand: 'A', 'Review Status': 'Removed', 'Score added': '1' } },
  ];
  const out = scoreSummary(entries);
  assertEquals(out.length, 1);
  assertEquals(out[0].rated, 1);
  assertEquals(out[0].average, 5);
});

Deno.test('mapEntrySummary surfaces key fields', () => {
  const row = mapEntrySummary({ id: 'x', tab: 'Rooster', data: { Brands: 'Acme', 'Account Name': 'acc1', 'Review Status': 'Published' } });
  assertEquals(row.brand, 'Acme');
  assertEquals(row.account, 'acc1');
  assertEquals(row.status, 'Published');
});
```

- [ ] **Step 3: Run tests, expect PASS**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: all tests pass (6 passed).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat(ai-assistant): edge function tool helpers + tests"
```

---

## Task 2: Edge Function handler (OpenAI loop + SSE)

**Files:**
- Create: `supabase/functions/ai-assistant/index.ts`

- [ ] **Step 1: Write `index.ts`**

```ts
// supabase/functions/ai-assistant/index.ts
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

const SYSTEM_PROMPT = `You are the assistant inside the Brands Partner Forum dashboard.
You help staff understand forum-review data and draft replies. Data lives in the "entries" table; use the provided tools to look things up rather than guessing. Forum platforms are referred to as TP (Trustpilot), AG (AskGamblers), CG (CasinoGuru). When asked to summarize or draft a reply, call get_entry first for the exact text. Be concise. If a tool returns no data, say so plainly.`;

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (!req.headers.get('authorization')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  }
  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'Assistant not configured' }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
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
        // Tool-resolution loop (non-streamed) until the model stops requesting tools.
        for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
            body: JSON.stringify({ model: MODEL, messages, tools: TOOL_DEFS, max_tokens: MAX_TOKENS }),
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
              result = await runTool(admin, call.function.name, JSON.parse(call.function.arguments || '{}'));
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
```

> Note: v1 streams the final answer as a single token frame after the tool loop resolves (simpler and robust). Token-by-token streaming of the final turn can be layered on later by switching the final OpenAI call to `stream: true`; the SSE contract (`{token}` / `{done}` / `{error}`) already supports it.

- [ ] **Step 2: Type-check the function with Deno**

Run: `deno check supabase/functions/ai-assistant/index.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ai-assistant/index.ts
git commit -m "feat(ai-assistant): edge function OpenAI tool-loop + SSE handler"
```

---

## Task 3: Frontend client (`src/lib/assistant.ts`)

**Files:**
- Create: `src/lib/assistant.ts`
- Modify: `src/lib/supabase.ts`

- [ ] **Step 1: Add the function URL export to `supabase.ts`**

Add after the `CHECK_STATUS_TOKEN` export:

```ts
export const AI_ASSISTANT_URL = import.meta.env.VITE_AI_ASSISTANT_URL ?? '';
```

- [ ] **Step 2: Write `src/lib/assistant.ts`**

```ts
import { AI_ASSISTANT_URL, SUPABASE_ANON_KEY } from './supabase';
import { supabase } from './supabase';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

// POSTs the conversation to the ai-assistant Edge Function and parses the SSE
// stream. `context` is an optional hidden note about the current page/entity.
export async function streamAssistant(
  messages: ChatMessage[],
  context: string | undefined,
  cb: StreamCallbacks,
): Promise<void> {
  if (!AI_ASSISTANT_URL) {
    cb.onError('Assistant not configured');
    return;
  }
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch { /* fall back to anon key */ }

  let res: Response;
  try {
    res = await fetch(AI_ASSISTANT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ messages, context }),
    });
  } catch (e) {
    cb.onError((e as Error).message || 'Network error');
    return;
  }
  if (!res.ok || !res.body) {
    cb.onError('Assistant unavailable — try again');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith('data:')) continue;
      let payload: any;
      try { payload = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (payload.error) { cb.onError(payload.error); return; }
      if (payload.token) cb.onToken(payload.token);
      if (payload.done) { cb.onDone(); return; }
    }
  }
  cb.onDone();
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/assistant.ts src/lib/supabase.ts
git commit -m "feat(ai-assistant): frontend SSE client + function URL env"
```

---

## Task 4: Assistant context + widget

**Files:**
- Create: `src/contexts/AssistantContext.tsx`
- Create: `src/components/AssistantWidget.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write `src/contexts/AssistantContext.tsx`**

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react';

interface AssistantState {
  open: boolean;
  seed: string | null;          // optional pre-filled prompt
  openWith: (seed?: string) => void;
  close: () => void;
  clearSeed: () => void;
}

const Ctx = createContext<AssistantState | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  return (
    <Ctx.Provider value={{
      open, seed,
      openWith: (s?: string) => { if (s) setSeed(s); setOpen(true); },
      close: () => setOpen(false),
      clearSeed: () => setSeed(null),
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAssistant() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssistant must be used within AssistantProvider');
  return v;
}
```

- [ ] **Step 2: Write `src/components/AssistantWidget.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { MessageCircle, X, Send } from 'lucide-react';
import { streamAssistant, type ChatMessage } from '../lib/assistant';
import { useAssistant } from '../contexts/AssistantContext';

export default function AssistantWidget() {
  const { open, openWith, close, seed, clearSeed } = useAssistant();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const location = useLocation();
  const params = useParams();
  const listRef = useRef<HTMLDivElement>(null);

  // Pre-seed the input when a page requests it (e.g. MentionDetail buttons).
  useEffect(() => {
    if (seed) { setInput(seed); clearSeed(); }
  }, [seed, clearSeed]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, streaming]);

  function pageContext(): string | undefined {
    const path = location.pathname;
    if (path.startsWith('/mentions/') && params.id) return `Viewing entry id ${params.id}.`;
    if (path.startsWith('/brands/') && params.tab) return `Viewing brand tab "${params.tab}".`;
    if (path === '/') return 'Viewing the overview page.';
    return undefined;
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setStreaming(true);
    setMessages((m) => [...m, { role: 'assistant', content: '' }]);
    await streamAssistant(next, pageContext(), {
      onToken: (tok) => setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: copy[copy.length - 1].content + tok };
        return copy;
      }),
      onError: (msg) => setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` };
        return copy;
      }),
      onDone: () => setStreaming(false),
    });
    setStreaming(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => openWith()}
        aria-label="Open assistant"
        className="fixed bottom-5 right-5 z-50 flex size-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700"
      >
        <MessageCircle className="size-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[32rem] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <span className="text-sm font-semibold text-slate-800">Assistant</span>
        <button onClick={close} aria-label="Close assistant" className="text-slate-400 hover:text-slate-700">
          <X className="size-5" />
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">Ask about forum mentions, scores, or get help drafting a reply.</p>
        ) : messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <span className={[
              'inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
              m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800',
            ].join(' ')}>
              {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 border-t border-slate-200 p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder="Type a message…"
          className="flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          aria-label="Send"
          className="flex size-9 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount provider + widget in `src/App.tsx`**

Wrap the existing `<Routes>` tree in `AssistantProvider` (inside `AuthProvider`), and render `<AssistantWidget />` inside `AppLayout` after the closing `</div>` of the main column. Imports:

```tsx
import { AssistantProvider } from './contexts/AssistantContext';
import AssistantWidget from './components/AssistantWidget';
```

`AppLayout` return becomes:

```tsx
function AppLayout() {
  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 md:p-8 overflow-x-hidden">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <AssistantWidget />
    </div>
  );
}
```

And wrap in `App()`:

```tsx
export default function App() {
  return (
    <AuthProvider>
      <AssistantProvider>
        <Routes>
          {/* ...unchanged routes... */}
        </Routes>
      </AssistantProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/AssistantContext.tsx src/components/AssistantWidget.tsx src/App.tsx
git commit -m "feat(ai-assistant): floating chat widget + assistant context"
```

---

## Task 5: MentionDetail Summarize / Draft-reply buttons

**Files:**
- Modify: `src/pages/MentionDetail.tsx`

- [ ] **Step 1: Import the hook**

```tsx
import { useAssistant } from '../contexts/AssistantContext';
```

- [ ] **Step 2: Use the hook and add buttons**

Inside the component, add `const { openWith } = useAssistant();`. After the status card (`</div>` closing the Status block, before the `toast` block), add:

```tsx
<div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
  <h2 className="text-sm font-semibold text-slate-700">AI assistant</h2>
  <div className="mt-3 flex flex-wrap gap-2">
    <button
      onClick={() => openWith(`Summarize this entry (id ${mention.id}) in 2-3 sentences.`)}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      Summarize
    </button>
    <button
      onClick={() => openWith(`Draft a polite, professional reply to this entry (id ${mention.id}).`)}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      Draft reply
    </button>
  </div>
</div>
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/MentionDetail.tsx
git commit -m "feat(ai-assistant): summarize / draft-reply buttons on MentionDetail"
```

---

## Task 6: Docs + deploy notes + push

**Files:**
- Modify: `CLAUDE.md` (Recent Changes + note the assistant), `README.md` if it documents env vars.

- [ ] **Step 1: Document required setup**

Note in `CLAUDE.md` Recent Changes that the assistant requires:
- `supabase secrets set OPENAI_API_KEY=sk-...`
- `supabase functions deploy ai-assistant`
- `VITE_AI_ASSISTANT_URL` env var in Vercel (the deployed function URL).

- [ ] **Step 2: Final build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit + push**

```bash
git add -A
git commit -m "docs(ai-assistant): setup + deploy notes"
git push
```

> Deploy steps (run by the operator, outside this plan): set the secret, `supabase functions deploy ai-assistant`, add `VITE_AI_ASSISTANT_URL` in Vercel, redeploy frontend.

---

## Self-Review

- **Spec coverage:** floating widget (T4), Edge Function proxy + OPENAI_API_KEY (T2), hybrid data access — tools (T1/T2) + page context (T4), ephemeral chat (T4 `useState`), streaming SSE contract (T2/T3), four jobs via tools + drafting prompt (T1/T2/T5), MentionDetail actions (T5), env wiring (T3), error paths (T2/T3), guardrails MAX_TOOL_LOOPS/MAX_TOKENS (T2). All covered.
- **No-write guarantee:** every tool in `runTool` is a `select`; no insert/update/delete. ✓
- **Type consistency:** SSE contract `{token}|{done}|{error}` identical in producer (T2 `index.ts`) and consumer (T3 `assistant.ts`); `ChatMessage`, `streamAssistant`, `useAssistant`/`openWith` names consistent across T3–T5. ✓
- **Scope:** single feature, one plan. ✓
