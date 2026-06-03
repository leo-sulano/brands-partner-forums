# Voice Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mic button to the AI assistant chat widget that records speech via the Web Speech API, transcribes it in the browser, and sends the transcript as a text message.

**Architecture:** All changes are in `src/components/AssistantWidget.tsx`. The Web Speech API runs entirely in the browser — no backend changes. When recording ends, the transcript flows into the existing `send()` function unchanged.

**Tech Stack:** React 19, TypeScript, Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`), Tailwind v4 (`animate-ping`), Lucide React (`Mic` icon), existing `Toast` component.

**Verification:** This project has no unit test suite. Verify each task with `npm run build` (TypeScript errors surface here — `tsc --noEmit` does not work in this repo).

---

### Task 1: Add imports, feature detection, and new state

**Files:**
- Modify: `src/components/AssistantWidget.tsx:1-15`

- [ ] **Step 1: Add `Mic` to the lucide-react import and import `Toast`**

Replace lines 1–5 of `AssistantWidget.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { MessageCircle, X, Send, Mic } from 'lucide-react';
import { streamAssistant, type ChatMessage } from '../lib/assistant';
import { useAssistant } from '../contexts/AssistantContext';
import Toast from './Toast';
```

- [ ] **Step 2: Add `speechSupported` constant after the imports (line 7, before the component)**

```tsx
const speechSupported =
  typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
```

- [ ] **Step 3: Add `recording`, `toastMsg`, and `recognitionRef` inside the component, after the existing state declarations (after line 11)**

```tsx
const [recording, setRecording] = useState(false);
const [toastMsg, setToastMsg] = useState<string | null>(null);
const recognitionRef = useRef<SpeechRecognition | null>(null);
```

- [ ] **Step 4: Run `npm run build` and confirm it passes with no errors**

```
npm run build
```

Expected: build succeeds. If you see `Cannot find name 'SpeechRecognition'`, your TypeScript lib target is below ES2021 — check `tsconfig.json` and ensure `"lib"` includes `"DOM"`.

- [ ] **Step 5: Commit**

```bash
git add src/components/AssistantWidget.tsx
git commit -m "feat(voice): add imports, feature detection, and recording state"
```

---

### Task 2: Refactor `send()` and add `toggleVoice()`

**Files:**
- Modify: `src/components/AssistantWidget.tsx` — `send` function and new `toggleVoice` function

- [ ] **Step 1: Refactor `send()` to accept an optional `text` override**

Replace the existing `send()` function (currently starts at line 36):

```tsx
async function send(text?: string) {
  const msg = (text ?? input).trim();
  if (!msg || streaming) return;
  const next: ChatMessage[] = [...messages, { role: 'user', content: msg }];
  setMessages(next);
  setInput('');
  setStreaming(true);
  setMessages((m) => [...m, { role: 'assistant', content: '' }]);
  await streamAssistant(next, pageContext(), {
    onToken: (tok) =>
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: 'assistant',
          content: copy[copy.length - 1].content + tok,
        };
        return copy;
      }),
    onError: (msg) =>
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` };
        return copy;
      }),
    onDone: () => setStreaming(false),
  });
  setStreaming(false);
}
```

The only change is the signature `async function send(text?: string)` and the first line `const msg = (text ?? input).trim();`. Everything else stays identical.

- [ ] **Step 2: Add `toggleVoice()` immediately after `send()`**

```tsx
function toggleVoice() {
  if (recording) {
    recognitionRef.current?.stop();
    return;
  }
  const SR = window.SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  const recognition: SpeechRecognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript.trim();
    if (transcript) send(transcript);
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech') return;
    setToastMsg(
      e.error === 'not-allowed'
        ? 'Microphone access denied'
        : 'Voice recognition unavailable',
    );
  };

  recognition.onend = () => {
    setRecording(false);
    recognitionRef.current = null;
  };

  recognitionRef.current = recognition;
  recognition.start();
  setRecording(true);
}
```

- [ ] **Step 3: Run `npm run build` and confirm it passes**

```
npm run build
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/AssistantWidget.tsx
git commit -m "feat(voice): add toggleVoice with Web Speech API"
```

---

### Task 3: Update JSX — mic button, textarea, and Toast

**Files:**
- Modify: `src/components/AssistantWidget.tsx` — the returned JSX

- [ ] **Step 1: Wrap the widget's open-state return in a fragment and add the `Toast` render**

Replace the `return (` that opens the widget panel (the one that starts with `<div className="fixed bottom-5 right-5 z-50 flex h-[32rem]...`):

```tsx
return (
  <>
    {toastMsg && (
      <Toast
        message={toastMsg}
        kind="error"
        onClose={() => setToastMsg(null)}
      />
    )}
    <div className="fixed bottom-5 right-5 z-50 flex h-[32rem] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
```

And close the fragment at the very end of the component (after the `</div>` that closes the panel):

```tsx
    </div>
  </>
);
```

- [ ] **Step 2: Add the mic button to the input row, to the left of the textarea**

Replace the entire `<div className="flex items-end gap-2 border-t ...">` section (the input row):

```tsx
<div className="flex items-end gap-2 border-t border-slate-200 p-3">
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
```

Key changes vs. the original:
- Mic button added before the textarea (only rendered when `speechSupported`)
- `animate-ping` pulse span inside mic button shown when `recording`
- Textarea gains `disabled={recording}` and dynamic `placeholder` / `opacity-50`
- Send button gains `|| recording` to its disabled condition
- Send button and mic button both gain `shrink-0` so they don't collapse at narrow widths

- [ ] **Step 3: Run `npm run build` and confirm it passes**

```
npm run build
```

Expected: build succeeds with no TypeScript or Vite errors.

- [ ] **Step 4: Manual smoke test**

Open the dev server (`npm run dev`), navigate to any page, open the assistant widget. Verify:
- Mic button appears to the left of the textarea
- Clicking mic causes the icon to pulse red and `Listening…` appears in the textarea
- Speak a sentence — transcript appears as a user message and the assistant responds
- In a browser without speech support (or with the `speechSupported` const forced to `false`), the mic button is absent

- [ ] **Step 5: Commit**

```bash
git add src/components/AssistantWidget.tsx
git commit -m "feat(voice): add mic button, pulse indicator, and toast error display"
```
