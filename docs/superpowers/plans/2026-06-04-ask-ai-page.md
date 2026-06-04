# Ask AI Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated full-page AI chat interface at `/ask-ai`, accessible to logged-in users via a sidebar nav link.

**Architecture:** A new `AskAI` page owns its own chat state and calls `streamAssistant` directly — identical pattern to `AssistantWidget`. The floating widget returns `null` on `/ask-ai` to avoid duplication. The route is protected by the existing `ProtectedRoute` wrapper.

**Tech Stack:** React 19, TypeScript, Tailwind v4, React Router v7, Lucide React (`Bot`, `Send`, `Mic`), existing `streamAssistant` from `src/lib/assistant.ts`, existing `Toast` component, Web Speech API.

**Verification:** No unit test suite — verify each task with `npm run build`.

---

### Task 1: Suppress floating widget on `/ask-ai`

**Files:**
- Modify: `src/components/AssistantWidget.tsx` — add early-return on `/ask-ai` route

- [ ] **Step 1: Read the current file**

Read `src/components/AssistantWidget.tsx` to confirm `useLocation` is already imported (it is, at line 2) and `location` is already declared (line 20).

- [ ] **Step 2: Add the early-return guard**

After the `recognitionRef` declaration and before the first `useEffect` (i.e., after line 22), add:

```tsx
if (location.pathname === '/ask-ai') return null;
```

The top of the component body should now look like:

```tsx
export default function AssistantWidget() {
  const { open, openWith, close, seed, clearSeed } = useAssistant();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const location = useLocation();
  const params = useParams();
  const listRef = useRef<HTMLDivElement>(null);

  if (location.pathname === '/ask-ai') return null;

  // Pre-seed the input...
```

- [ ] **Step 3: Run `npm run build` and confirm it passes**

```
npm run build
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/AssistantWidget.tsx
git commit -m "feat(ask-ai): suppress floating widget on /ask-ai route"
```

---

### Task 2: Add "Ask AI" nav link to the sidebar

**Files:**
- Modify: `src/components/Sidebar.tsx` — add `Bot` icon import and nav link

- [ ] **Step 1: Add `Bot` to the lucide-react import**

The current import at line 3 is:
```tsx
import {
  LayoutDashboard, RefreshCw, MessagesSquare, ScrollText,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Link2, Users, ChevronDown, BarChart3,
  type LucideIcon,
} from 'lucide-react';
```

Add `Bot` to it:
```tsx
import {
  LayoutDashboard, RefreshCw, MessagesSquare, ScrollText,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Link2, Users, ChevronDown, BarChart3, Bot,
  type LucideIcon,
} from 'lucide-react';
```

- [ ] **Step 2: Add "Ask AI" to `topLinks`**

The current `topLinks` array at line 24 is:
```tsx
const topLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
];
```

Change it to:
```tsx
const topLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ask-ai', label: 'Ask AI', icon: Bot, end: true },
];
```

- [ ] **Step 3: Run `npm run build` and confirm it passes**

```
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(ask-ai): add Ask AI nav link to sidebar"
```

---

### Task 3: Create the `AskAI` page

**Files:**
- Create: `src/pages/AskAI.tsx`

- [ ] **Step 1: Create `src/pages/AskAI.tsx` with the full implementation**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Send, Mic } from 'lucide-react';
import { streamAssistant, type ChatMessage } from '../lib/assistant';
import Toast from '../components/Toast';

const speechSupported =
  typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

export default function AskAI() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, streaming]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || streaming) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: msg }];
    setMessages(next);
    setInput('');
    setStreaming(true);
    setMessages((m) => [...m, { role: 'assistant', content: '' }]);
    await streamAssistant(next, 'Using the Ask AI page.', {
      onToken: (tok) =>
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: copy[copy.length - 1].content + tok,
          };
          return copy;
        }),
      onError: (msg) => {
        setStreaming(false);
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` };
          return copy;
        });
      },
      onDone: () => setStreaming(false),
    });
  }

  function toggleVoice() {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    // webkitSpeechRecognition is the vendor-prefixed form; not typed in lib.dom.d.ts
    const SR = window.SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const recognition: SpeechRecognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.addEventListener('result', (e) => {
      const transcript = e.results[0][0].transcript.trim();
      setRecording(false);
      if (transcript) send(transcript);
    });

    recognition.addEventListener('error', (e) => {
      if (e.error === 'no-speech') return;
      setToastMsg(
        e.error === 'not-allowed'
          ? 'Microphone access denied'
          : 'Voice recognition unavailable',
      );
    });

    recognition.addEventListener('end', () => {
      setRecording(false);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    });

    recognition.addEventListener('start', () => setRecording(true));
    recognitionRef.current = recognition;
    recognition.start();
  }

  return (
    <>
      {toastMsg && (
        <Toast message={toastMsg} kind="error" onClose={() => setToastMsg(null)} />
      )}
      <div className="flex h-full flex-col">
        <h1 className="mb-4 text-xl font-semibold text-slate-800">Ask AI</h1>

        <div ref={listRef} className="flex-1 overflow-y-auto pb-4">
          <div className="mx-auto w-full max-w-2xl space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-400">
                Ask anything about forum mentions, scores, or brands.
              </p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                  <span
                    className={[
                      'inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
                      m.role === 'user'
                        ? 'bg-brand-600 text-white'
                        : 'bg-slate-100 text-slate-800',
                    ].join(' ')}
                  >
                    {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <div className="mx-auto flex w-full max-w-2xl items-end gap-2">
            {speechSupported && (
              <button
                onClick={toggleVoice}
                disabled={streaming}
                aria-label={recording ? 'Stop recording' : 'Start voice input'}
                className={[
                  'relative flex size-9 shrink-0 items-center justify-center rounded-md disabled:opacity-40',
                  recording
                    ? 'bg-red-50 text-red-600'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
                ].join(' ')}
              >
                {recording && (
                  <span className="absolute inline-flex size-full animate-ping rounded-md bg-red-300 opacity-60" />
                )}
                <Mic className="relative size-4" />
              </button>
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={recording}
              rows={1}
              placeholder={recording ? 'Listening…' : 'Type a message…'}
              className={[
                'flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none',
                recording ? 'opacity-50' : '',
              ].join(' ')}
            />
            <button
              onClick={() => send()}
              disabled={streaming || !input.trim() || recording}
              aria-label="Send"
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Run `npm run build` and confirm it passes**

```
npm run build
```

Expected: build succeeds. The page compiles but isn't routed yet — that's Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/pages/AskAI.tsx
git commit -m "feat(ask-ai): add full-page Ask AI chat page"
```

---

### Task 4: Wire the route in `App.tsx`, verify, and push

**Files:**
- Modify: `src/App.tsx` — lazy-import `AskAI`, add `/ask-ai` inside `ProtectedRoute`

- [ ] **Step 1: Add the lazy import**

The current lazy imports block ends at line 19. Add `AskAI` after `ScoreSummary`:

```tsx
const ScoreSummary = lazy(() => import('./pages/ScoreSummary'));
const AskAI        = lazy(() => import('./pages/AskAI'));
```

- [ ] **Step 2: Add the `/ask-ai` route inside `ProtectedRoute`**

The current `ProtectedRoute` block (lines 60-65) is:
```tsx
<Route element={<ProtectedRoute />}>
  <Route path="/sync" element={<SyncStatus />} />
  <Route path="/log" element={<ActivityLog />} />
  <Route path="/score-summary" element={<ScoreSummary />} />
  <Route path="/admin/users" element={<AdminUsers />} />
</Route>
```

Add `/ask-ai` to it:
```tsx
<Route element={<ProtectedRoute />}>
  <Route path="/ask-ai" element={<AskAI />} />
  <Route path="/sync" element={<SyncStatus />} />
  <Route path="/log" element={<ActivityLog />} />
  <Route path="/score-summary" element={<ScoreSummary />} />
  <Route path="/admin/users" element={<AdminUsers />} />
</Route>
```

- [ ] **Step 3: Run `npm run build` and confirm it passes**

```
npm run build
```

Expected: build succeeds with no TypeScript or Vite errors.

- [ ] **Step 4: Commit and push**

```bash
git add src/App.tsx
git commit -m "feat(ask-ai): wire /ask-ai protected route"
git push origin main
```
