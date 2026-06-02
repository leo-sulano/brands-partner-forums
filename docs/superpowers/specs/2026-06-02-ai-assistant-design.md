# AI Assistant (GPT-4o mini) — Design Spec

**Date:** 2026-06-02
**Status:** Approved design — ready for implementation plan
**Project:** Brands Partner Forum dashboard

## Goal

Add an AI assistant, powered by OpenAI **GPT-4o mini**, to the dashboard. It is a
floating chat widget available on every authenticated page and serves four jobs:

1. **Q&A over forum data** — natural-language questions ("how many negative TP
   mentions this week?") answered from the live Supabase data.
2. **Summarize mentions** — summarize a single mention or a brand's recent activity.
3. **General chat** — generic assistant questions not tied to forum data.
4. **Draft forum replies** — help VAs draft responses to forum posts/reviews based
   on the mention text and tone guidance.

## Decisions (locked during brainstorming)

| Decision | Choice |
|----------|--------|
| Model | OpenAI `gpt-4o-mini` (pinned as a constant; easy to bump) |
| UI placement | Floating chat widget (corner button → slide-in panel) on every authenticated page |
| Data access | Hybrid — server-side tool/function calling **plus** auto-injected current-page context |
| Chat history | Ephemeral (in-memory, clears on reload). No DB table in v1 |
| Response style | Streaming (SSE), token-by-token |
| API key location | `OPENAI_API_KEY` secret inside a Supabase Edge Function — never in the frontend |

## Architecture

```
Floating chat widget (React, in AppLayout)
        │  POST {VITE_AI_ASSISTANT_URL}   (Server-Sent Events stream)
        ▼
Supabase Edge Function `ai-assistant`   ← holds OPENAI_API_KEY (secret)
        │  orchestration loop:
        │   1. send messages + tool defs to OpenAI (gpt-4o-mini)
        │   2. if model requests a tool → run a read-only query against
        │      Supabase (service-role client) → feed the result back
        │   3. loop until final answer → stream final tokens to the widget
        ▼
OpenAI Chat Completions API (stream + function calling)
```

**Why a server-side orchestration loop.** The API key must never reach the browser.
Streaming *combined with* tool calls is far simpler when one place — the Edge
Function — drives the entire loop and only the final assistant text streams to the
client. Tools execute server-side with the service-role key. This mirrors the
existing `check-review-status` Edge Function pattern (secrets via `Deno.env`,
service-role `createClient`, CORS + `json()` helper).

## Components

### Frontend

- **`src/components/AssistantWidget.tsx`** — mounted once in `AppLayout` (`App.tsx`),
  so it appears on all pages rendered under the layout but **not** on `/login`,
  `/signup`, `/reset-password`. Collapsed = round button bottom-right; expanded =
  ~380px slide-in panel with a message list, input box, and a live streaming
  response area. Purely presentational — all network/SSE logic lives in the lib.
- **`src/lib/assistant.ts`** — the client: builds the request (messages +
  auto-context), POSTs to the Edge Function, parses the SSE stream, and exposes an
  async iterator / callback for streamed tokens. Reads `VITE_AI_ASSISTANT_URL` and
  the Supabase auth header. Follows the project rule: logic in `lib/`, components
  stay presentational.
- **Auto-context:** the widget reads the current route via React Router. On
  `/mentions/:id` it includes the mention id; on `/brands/:tab` it includes the tab.
  This is sent as a hidden system note so "summarize this" works with no pasting.
- **MentionDetail actions:** two buttons — **Summarize** and **Draft reply** — on the
  `MentionDetail` page open the widget pre-seeded with the corresponding prompt for
  that mention.

### Backend

- **`supabase/functions/ai-assistant/index.ts`** — the Edge Function. Responsibilities:
  - Read `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env`.
  - Validate the incoming Supabase auth header (same header the app already sends).
  - Run the OpenAI orchestration loop with streaming + function calling.
  - Execute read-only tools against Supabase and stream the final answer as SSE.
  - CORS handling and a clean JSON error path (mirror `check-review-status`).

## Data model (reconciled with live schema)

CLAUDE.md describes a `mentions` table, but the **live schema has no such table** — it
was dropped. All forum data lives in **`public.entries`**: one row per Sheet row, with
`id`, `tab` (the brand-group tab), `sheet_row_id`, and a `data` jsonb keyed by the exact
Sheet headers (header names vary per tab). The dashboard derives both "mentions" (via
`entryToMention`) and the score summary (via `computeScoreSummary`) from `entries` at
read time. The assistant's tools therefore query `entries` directly and reuse the same
field-picking / score-parsing logic, ported into the Edge Function.

## Tools (read-only, server-side)

Each maps to a focused query against `entries`. None can write or delete.

| Tool | Purpose |
|------|---------|
| `list_tabs` | Distinct `tab` values (brand-group tabs) so the model knows which brands exist |
| `query_entries` | Filter entries by `tab`, status, and/or a free-text `contains` match in `data`; returns mapped summary rows (`id`, tab, brand, account, status, score, date) + total count |
| `get_entry` | Fetch one entry by `id` with its full `data` jsonb — powers summarize / draft-reply |
| `get_score_summary` | Published-only star rollup per brand (optionally filtered by `tab`), reusing `computeScoreSummary` semantics — counts Published rows only, by design |

Coverage of the four jobs: **Q&A** → `list_tabs` / `query_entries` / `get_score_summary`;
**summarize** → `get_entry`; **draft reply** → `get_entry` + a drafting system prompt;
**general chat** → no tool needed.

## Configuration & Security

- **Secret:** `OPENAI_API_KEY` set via `supabase secrets set OPENAI_API_KEY=...`.
  Never committed; never sent to the frontend.
- **Frontend env:** add `VITE_AI_ASSISTANT_URL` to `src/lib/supabase.ts` alongside
  the other function-URL exports.
- **Access control:** the function requires the Supabase auth header the app already
  sends, and the whole deploy is behind the Vercel password gate. No new public
  surface beyond the function URL.
- **Errors:** every failure path returns a clean, user-safe message the widget shows
  (e.g. "Assistant unavailable — try again"). The function never leaks the API key or
  raw OpenAI error bodies to the client.
- **Cost guardrails:** capped `max_tokens` per reply and a capped tool-loop iteration
  count (≈5) to prevent runaway loops.

## Error Handling

- Missing/invalid auth header → 401 with a generic message.
- Missing `OPENAI_API_KEY` env → 500 with a generic "Assistant not configured".
- OpenAI request failure / timeout → stream an error frame the widget renders as a
  failed message; user can retry.
- Tool query failure → the loop feeds a short error string back to the model so it can
  respond gracefully rather than crashing the stream.

## Testing

The frontend has **no test runner** (no vitest/jest in `package.json`); the project
convention is to verify with `npm run build`. Edge Functions, however, do have Deno
tests (see `check-review-status/parser_test.ts`). Testing strategy reflects this:

- **Edge Function (`tools.ts`):** pure tool-input → SQL-filter / row-mapping helpers are
  extracted into a `tools.ts` module and covered by a Deno test (`deno test`), mirroring
  the `parser_test.ts` pattern. Tests cover field-picking variants, score parsing, the
  Published-only filter, and `query_entries` text matching.
- **Edge Function loop:** the orchestration loop (iteration cap, error frames) is
  validated manually against the deployed function; no networked OpenAI mock in v1.
- **Frontend:** verified via `npm run build` (must pass) plus a manual smoke test —
  open/close widget, send a message, see streamed tokens, and the MentionDetail
  Summarize / Draft-reply buttons pre-seed the widget.

## Scope Boundaries (v1 — explicitly NOT included)

- No persisted chat history (ephemeral in-memory only).
- No write actions — the assistant cannot edit mentions, statuses, or any data.
- No new database tables.
- No dedicated `/assistant` page (floating widget only).

## Future / Backlog

- Persisted per-user conversations (new Supabase table + RLS + history UI).
- Brand-level "summarize recent activity" as a one-click action on `BrandGroup`.
- Optional write actions (e.g. apply a suggested status) behind explicit confirmation.
