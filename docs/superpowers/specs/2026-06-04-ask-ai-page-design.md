# Ask AI Page — Design Spec

**Date:** 2026-06-04
**Status:** Approved

## Overview

Add a dedicated "Ask AI" page at `/ask-ai` — a full-screen chat interface for the AI assistant. Accessible only to logged-in users. The existing floating widget is suppressed on this route since the page itself is the chat.

## Scope

- New `/ask-ai` route, protected by existing `ProtectedRoute`
- "Ask AI" nav link added to the top of the sidebar (below Overview)
- Full-page centered chat layout with scrollable message list and pinned input
- Floating `AssistantWidget` hidden on `/ask-ai` to avoid duplication
- All chat logic reuses existing `streamAssistant` from `src/lib/assistant.ts`

## Files Changed

| File | Change |
|------|--------|
| `src/pages/AskAI.tsx` | Create — full-page chat page |
| `src/components/Sidebar.tsx` | Add "Ask AI" `NavLink` to `topLinks` |
| `src/App.tsx` | Lazy-import `AskAI`, add `/ask-ai` route inside `ProtectedRoute` |
| `src/components/AssistantWidget.tsx` | Return `null` when `location.pathname === '/ask-ai'` |

## Architecture

The `AskAI` page owns its own local state (`messages`, `input`, `streaming`) and calls `streamAssistant` directly — identical pattern to `AssistantWidget` but rendered at page scale. No changes to `AssistantContext`.

```
User navigates to /ask-ai
  → Sidebar "Ask AI" NavLink (active highlight)
  → AskAI page renders full-height chat
  → AssistantWidget returns null (no floating button)
  → User types / sends → streamAssistant → SSE stream → tokens render
```

## Page Layout (`AskAI.tsx`)

```
┌─ page (h-full flex flex-col) ──────────────────────┐
│  <h1> Ask AI                                        │
│                                                     │
│  ┌─ message list (flex-1 overflow-y-auto) ────────┐ │
│  │  max-w-2xl mx-auto w-full                      │ │
│  │  [empty state] "Ask anything about forum..."   │ │
│  │  [user bubble] right-aligned, brand-600        │ │
│  │  [assistant bubble] left-aligned, slate-100    │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ input bar (border-t, p-4) ────────────────────┐ │
│  │  max-w-2xl mx-auto w-full                      │ │
│  │  [textarea flex-1] [mic button] [send button]  │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

- Message bubbles: same styles as `AssistantWidget` (brand-600 user, slate-100 assistant)
- Input: same textarea + Send button pattern; mic button included (reuses `speechSupported` + `toggleVoice` logic)
- Streaming indicator: `…` placeholder in assistant bubble while streaming
- Auto-scroll to latest message on each token

## Sidebar Change

Add to `topLinks` in `Sidebar.tsx`:

```ts
{ to: '/ask-ai', label: 'Ask AI', icon: Bot }
```

Import `Bot` from `lucide-react`. Positioned immediately after Overview.

## Widget Suppression

In `AssistantWidget.tsx`, early-return before rendering anything:

```ts
const location = useLocation(); // already imported
if (location.pathname === '/ask-ai') return null;
```

## Error Handling

- Stream errors render as `⚠️ <message>` in the assistant bubble — same as the widget
- `streaming` resets on `onDone` and `onError` — same pattern as the widget

## Out of Scope

- Persisting chat history across page navigations
- Sharing chat history between the floating widget and the page
- Suggested prompts or quick-action buttons
