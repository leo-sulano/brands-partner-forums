# Voice Message — Design Spec

**Date:** 2026-06-03
**Status:** Approved

## Overview

Add a microphone button to the AI assistant chat widget so users can speak a message instead of typing. The browser transcribes the audio via the Web Speech API and sends the resulting text through the existing message pipeline. The assistant continues to reply with text only.

## Scope

- Voice **input** only (speech-to-text). No text-to-speech reply.
- Browser-native transcription via Web Speech API — no backend changes, no new API costs.
- If the browser does not support the Web Speech API, the mic button is not rendered.

## Files Changed

| File | Change |
|------|--------|
| `src/components/AssistantWidget.tsx` | Add mic button, recording state, Web Speech API integration |

No other files change. No backend, Edge Function, or type changes required.

## Architecture

The Web Speech API runs entirely in the browser. The transcript it produces is a plain string, passed directly into the existing `sendMessage` handler. From that point on, the message is indistinguishable from a typed message.

```
User speaks
  → SpeechRecognition.onresult → transcript string
  → existing sendMessage(transcript)
  → SSE stream from Edge Function
  → assistant text reply rendered in widget
```

## UI Behavior

### Button placement
A mic icon button sits to the left of the existing Send button, matching its size and style. Uses Lucide `Mic` and `MicOff` icons.

### Recording lifecycle
1. User clicks mic → `SpeechRecognition` starts (`continuous: false`, `interimResults: false`)
2. Mic icon turns red with a CSS pulse ring; textarea is disabled and dimmed
3. Speech ends naturally → `onresult` fires → transcript captured → `sendMessage` called automatically
4. User clicks mic again while recording → recognition stopped early; if a partial transcript exists it is sent, otherwise silently reset to idle

### Visual states

| State | Mic button | Input textarea |
|-------|------------|----------------|
| Idle | Gray `Mic` icon | Normal |
| Recording | Red `Mic` icon + pulse ring | Disabled, dimmed |
| Streaming reply | Both buttons disabled | Disabled |

### Feature detection
```ts
const speechSupported =
  typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
```
If `speechSupported` is false, the mic button is not rendered. No fallback UI or error state shown.

## State

Two new pieces of state added to `AssistantWidget`:

```ts
const [recording, setRecording] = useState(false)
const recognitionRef = useRef<SpeechRecognition | null>(null)
```

No changes to `AssistantContext` or `AssistantState`.

## Error Handling

| SpeechRecognition error | Behavior |
|------------------------|----------|
| `not-allowed` | Toast: "Microphone access denied" |
| `no-speech` | Silently reset to idle |
| `network` or other | Toast: "Voice recognition unavailable" |
| `onend` with empty transcript | Silently reset to idle |

Uses the existing `Toast` component — no new UI component needed.

## Out of Scope

- Text-to-speech (assistant speaking replies)
- Showing/editing the transcript before sending
- Server-side transcription (Whisper)
- Recording audio file upload or storage
