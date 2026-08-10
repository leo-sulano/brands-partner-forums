# Design: Original Review Content + On-Demand English Translation (PMS Task 1)

**Date:** 2026-08-10
**PMS task:** "Add Original Review Content with On-Demand English Translation in Edit Modal" (`cmsg9100g000004l9i95s6p27`)

## Scope

Display each review's original-language text in the Edit Entry modal, with a per-platform
"Translate to English" button that translates only on click — never automatically, never
in the review table, never editable. Depends on PMS Task 5 (shipped and deployed
2026-08-10), which added the `TP/AG/CG/WO Review Text` jsonb keys this task reads from.

## Original PMS requirements (verbatim)

> Enhance the Edit Review modal to display the review content in its original language.
> The system should not automatically translate the review. Instead, provide a "Translate
> to English" button that translates the review content only when the user requests it.
>
> Requirements:
> - Display the review content only in the Edit Review modal.
> - Always show the review in its original language.
> - Do not automatically translate the review when the modal opens.
> - Add a "Translate to English" button below or beside the original review.
> - When clicked: translate into English; display below the original; keep original visible.
> - If already English: hide or disable the button.
> - Review metadata unchanged.
> - Review content never appears in the review table.
> - If no review content exists, display "No review content available."
> - If translation fails, display "Unable to translate this review at the moment. Please
>   try again later."
> - Works consistently across TP/AG/CG/WO and future platforms.

## Current state

- `entries.data` (jsonb) holds `TP Review Text`/`AG Review Text`/`CG Review Text`/
  `WO Review Text` per platform (PMS Task 5), read via `getReviewText(data, platform)` /
  `PLATFORM_REVIEW_TEXT_KEYS` in `src/lib/scoreSummary.ts`.
- `EditEntryModal.tsx` renders structured per-platform fields, bucketed by `sectionOf()`
  into Account / Trust Pilot (also used for Wizard of Odds, relabeled) / AskGamblers /
  Casino Guru / Behavior Flags sections. It has no free-text display area today.
- `BrandGroup.tsx` already excludes the 4 review-text keys from the modal's dynamic
  "extras" fallback (`REVIEW_TEXT_KEYS`, derived from `PLATFORM_REVIEW_TEXT_KEYS`) — Task 5
  deliberately kept them invisible everywhere pending this task's purpose-built display.
- No translation infrastructure exists except the `ai-assistant` Supabase Edge Function,
  which already holds a provisioned `OPENAI_API_KEY` secret — reusable without new
  provisioning, but that function is a chat-tool-calling assistant, not a translation
  utility, and remains gated on a still-unset `VITE_AI_ASSISTANT_URL` Vercel env var per
  prior sessions (unrelated to this task, not re-verified here).
- No language-detection library exists in this repo.
- Known, accepted per-platform noise in stored text (from Task 5's data-quality-contract):
  TP occasionally holds a title instead of a body; AG can carry a trailing "Helpful (N)"
  line; CG can carry the casino's own reply appended, or be entirely absent on an
  ambiguous account; WO carries a leading byline/date/rating header baked into the text.

## Design

### 1. Where it renders

A new `ReviewTextBlock` component renders inside `EditEntryModal.tsx`'s existing Trust
Pilot / AskGamblers / Casino Guru section blocks — placed after that platform's existing
fields, before the section ends — one block per platform in `getTabPlatforms(currentTab)`
(so a Wizard of Odds tab's `wo` block renders in the same "Trust Pilot"-labeled slot its
other WO fields already use, matching the existing relabeling). No new section, no new
layout pattern.

### 2. `ReviewTextBlock` component

`src/components/ReviewTextBlock.tsx`, props `{ text: string | null; platform: Platform }`.

- If `text` is `null`: renders "No review content available." in place of the block — this
  applies per active platform, not once for the whole entry, so it doubles as a signal that
  extraction hasn't happened yet for that specific platform rather than a broken feature.
- If `text` is present: always shows the original text, read-only (display-only, not an
  editable input — matches "content should not appear in the table," and there is no
  requirement to let anyone hand-edit stored review text).
- On mount (when `text` is present), runs a client-side language-detection library
  (`franc-min`) once against `text`. If detected as English, or detection is inconclusive
  on very short text (treated as "assume English" to avoid a false-positive button on a
  two-word review), no Translate button renders at all.
- If not English: shows a "Translate to English" button below the original.
- Click flow: `translating = true` (button shows a spinner, disabled) → POST to the new
  Edge Function with `{ text }` → on success, sets `translated` and renders the English
  translation below the original (original stays visible, unchanged) → on failure, sets
  `error` to the ticket's exact copy and leaves the button re-clickable for retry.
- Translation result lives only in this component's local state — not persisted to
  Supabase, not cached across modal open/close. Re-opening the modal re-detects language
  and requires clicking Translate again if wanted. Deliberate simplicity choice (translation
  is a cheap gpt-4o-mini call), not an oversight — no persistence was requested.

### 3. `translate-review` Edge Function

New, minimal function at `supabase/functions/translate-review/index.ts`, modeled on
`ai-assistant`'s existing pattern (CORS headers, `authorization` header required, reads
`OPENAI_API_KEY` from the same already-provisioned secret — no new secret needed).

- Request: `{ text: string }`. Response: `{ translation: string }` or `{ error: string }`.
- Calls OpenAI **gpt-4o-mini** (cheap, fast, no tool-calling loop) with a narrow system
  prompt instructing translation-only, no commentary. Single JSON response — no SSE
  streaming needed, translations here are short.
- Gated the same way Edit Entry itself is: any approved logged-in user, not admin-only.
- Frontend calls it via a new small fetch helper (in `src/lib/assistant.ts` or a new
  `src/lib/translate.ts`), needing a new `VITE_TRANSLATE_REVIEW_URL` Vercel env var
  mirroring `VITE_AI_ASSISTANT_URL`'s existing pattern. **This function must be deployed
  and its URL set in Vercel before the feature works live** — the same two-step gap
  `ai-assistant` itself has had.

### 4. Empty / error states

- No review text for an active platform: "No review content available." shown in that
  platform's slot (not the whole block omitted).
- Translation fails (network, OpenAI error, non-200): exact copy "Unable to translate this
  review at the moment. Please try again later." Button remains clickable for retry, not
  permanently disabled.
- Function not yet deployed/configured: falls through the same generic failure path above
  (a network/404 error) — no special-cased "not configured" message, since the ticket only
  specifies one failure message.

### 5. Explicitly out of scope

- Cleaning up known per-platform noise (AG's "Helpful (N)", CG's appended reply, WO's
  leading header) before display or translation — shown raw, as stored. This is a known,
  already-documented Task 5 limitation, not something this task is responsible for fixing.
- Persisting translated text anywhere (DB, cache) — ephemeral, per-modal-session only.
- Editing review text through this modal — display only.

## Testing

`ReviewTextBlock`'s language-detection-gates-button-visibility logic and its empty/loading/
error states get unit tests (Vitest, mocked `fetch`). The Edge Function itself gets no
automated test suite, matching `ai-assistant`'s own established convention in this repo —
validated by live curl/manual testing once deployed, plus a manual pass after real Vercel
env var wiring, same as every other Edge Function's rollout in this repo's history.
