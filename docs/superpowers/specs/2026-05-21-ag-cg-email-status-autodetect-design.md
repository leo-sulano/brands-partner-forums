# Design: AG/CG Email-Based Review Status Auto-Detection

**Date:** 2026-05-21
**Status:** Approved

## Problem

AskGamblers (AG) and Casino Guru (CG) send notification emails to individual agent accounts (ProtonMail and Outlook) whenever a review is approved or rejected. Currently, someone must open each account's inbox, read each email, and manually update the review status in the Google Sheet. With many brands and agents, this is slow and error-prone.

## Goal

Automatically detect AG and CG review status changes from notification emails and write the result (`Published` or `Refused`) back to the correct row in the Google Sheet — with no manual inbox checking required.

## Architecture

```
Each agent inbox (ProtonMail / Outlook)
  → auto-forward rule (emails from noreply@askgamblers.com or no-reply@casino.guru)
  → Central Gmail inbox (e.g. ag-cg-monitor@gmail.com)
        ↓  (Apps Script — hourly time trigger)
  parseAgCgEmails()
    → parse platform, casino name, username, status from each unprocessed email
    → find matching sheet row (tab + casino name + username)
    → update AG/CG Review Status column
    → apply Gmail label "ag-cg-processed"
    → on failure: log to "Email Parse Errors" tab, skip label (retry next run)
```

## Prerequisites (one-time manual setup)

For each agent email account, create a forwarding/filter rule:
- **Condition:** From is `noreply@askgamblers.com` OR `no-reply@casino.guru`
- **Action:** Forward to the central Gmail address (e.g. `ag-cg-monitor@gmail.com`)

Both Outlook and ProtonMail (paid) support auto-forwarding filter rules. ProtonMail free accounts do not support auto-forwarding — those accounts require upgrading or using the Outlook/Gmail app with IMAP access.

## Email Parsing

### AskGamblers — `noreply@askgamblers.com`

| Signal | Source | Example |
|---|---|---|
| Casino name | Subject | `"Spinjo Casino Review Approved!"` → `Spinjo Casino` |
| Status | Subject keyword | `Approved` → `Published`, `Rejected` → `Refused` |
| Username | Body greeting | `"Hello Tanner12,"` → `Tanner12` |

Subject regex: `/^(.+?) Review (Approved|Rejected)/i`

### Casino Guru — `no-reply@casino.guru`

| Signal | Source | Example |
|---|---|---|
| Status | Subject | `"Your review has been approved"` / `"…rejected"` |
| Casino name (rejected) | Body text | `"your casino review (EmirBet Casino)"` → `EmirBet Casino` |
| Casino name (approved) | "Show review" link href | Slug extracted from `https://casino.guru/.../emirbet-casino/…` |
| Username | Body greeting | `"Hello Peytonn0."` → `Peytonn0` |

Body regex (rejected): `/casino review \((.+?)\)/i`
Link href regex (approved): extract first `href` containing `casino.guru` from email HTML body, then extract path slug (e.g. `emirbet-casino` → `EmirBet Casino` via slug-to-title conversion). If no `casino.guru` link is found in an approved email, the email is logged to the error tab with reason `"no_review_url"` and skipped.

## Row Matching

For each parsed email:

1. **Identify tab** — a configurable map of casino name (lowercase, trimmed) → sheet tab name.
   Example: `{ "spinjo casino": "Rooster Partners", "emirbet casino": "Hanan Brands" }`
   This map lives as a constant (`CASINO_TAB_MAP`) at the top of `EmailParser.gs` and is updated as new brands are added.

2. **Find row** within the tab where:
   - The column named by `BRAND_COL` (default: `"Casino"`) matches the parsed casino name (case-insensitive, trimmed, with " Casino" suffix stripped for comparison — e.g. `"Spinjo Casino"` → `"Spinjo"`)
   - The column named by `USERNAME_COL` (default: `"Username"`) matches the parsed username (case-insensitive, trimmed)

3. **Write status** to the correct column:
   - AG email → column named by `AG_STATUS_COL` (default: `"AG Review Status"`)
   - CG email → column named by `CG_STATUS_COL` (default: `"CG Review Status"`)

All four column name constants (`BRAND_COL`, `USERNAME_COL`, `AG_STATUS_COL`, `CG_STATUS_COL`) are defined at the top of `EmailParser.gs` and can be adjusted if sheet column names differ across tabs.

### Casino Name Normalization

Parsed casino names are normalized before lookup: lowercased, trimmed, and the word " casino" is stripped from the end. Sheet values undergo the same normalization at match time. This handles mismatches like `"Spinjo Casino"` (email) vs `"Spinjo"` (sheet cell).

## Status Values Written to Sheet

| Email outcome | Sheet value |
|---|---|
| Approved / published | `Published` |
| Rejected | `Refused` |

## Idempotency

- After successfully processing an email, apply Gmail label `ag-cg-processed`.
- The script queries only emails from AG/CG senders **without** the `ag-cg-processed` label.
- If processing fails (parse error or no row found), the label is not applied — the email retries on the next hourly run.
- This ensures no email is processed twice and failed emails are not silently dropped.

## Error Logging

A tab named `"Email Parse Errors"` in the sheet receives one row per failure:

| Column | Content |
|---|---|
| Timestamp | ISO datetime of the parse attempt |
| Platform | `AG` or `CG` |
| Subject | Full email subject |
| Body snippet | First 300 characters of plain text body |
| Failure reason | `"no_casino_name"`, `"no_username"`, `"no_matching_row"`, `"unknown_tab"` |

## Trigger

An hourly time-based trigger installed once by running `createEmailSyncTrigger()` from the Apps Script editor. Uses `ScriptApp.newTrigger(...).timeBased().everyHours(1)`. The installer removes any existing trigger with the same handler name before creating a new one (safe to re-run).

## New Files

| Path | Purpose |
|---|---|
| `supabase/apps-script/EmailParser.gs` | All email parsing and sheet-update logic |

## Modified Files

| Path | Change |
|---|---|
| `supabase/apps-script/Code.gs` | Add `createEmailSyncTrigger()` installer function |

## Out of Scope

- Detecting AG/CG email status for accounts that cannot forward (ProtonMail free without upgrade).
- Handling "review removed after publishing" notifications (only approved/rejected are in scope — removed email format not yet confirmed).
- Notifying the dashboard UI when a status changes via email (status will appear on next sheet→Supabase sync).
- Retry logic beyond the label-skip mechanism.
- Parsing emails other than AG and CG (e.g. Trustpilot — handled by the existing `check-review-status` Edge Function).

---

## Addendum — 2026-05-29: Real-Email Validation & Revisions

The parsers above were written from *assumed* formats. Validating against four real emails
(AG approved/rejected, CG approved/rejected) revealed two breaks. This addendum is the
source of truth where it conflicts with the original spec.

### Finding 1 — AskGamblers "approved" greeting is `Congratulations`, not `Hello`

Real AG approved emails open with **`Congratulations <username>,`** (confirmed across two
samples: `Congratulations Tanner12,` / `Congratulations Trym12,`). AG *rejected* emails use
`Hello <username>,`. The original username regex matched only `Hello`, so every AG-approved
email produced `username = null` and was logged `no_username` — never written.

**Fix:** broaden the greeting match to `Hello` **or** `Congratulations`:
`/(?:Hello|Congratulations)\s+([\w.\-]+)\s*[,\.]/i`. AG casino name still comes from the
subject (`<Casino> Review Approved!` / `Rejected`), which is correct as-is.

### Finding 2 — Casino Guru "approved" emails contain NO casino name

The casino name is absent from the CG-approved subject *and* body. The only signal is the
"Show review" button, whose href is a **review-ID** URL with no casino slug, e.g.:

```
https://casino.guru/userReview/130406/49   →   https://casino.guru/luckyvibe-casino-review
```

The original spec assumed the email href already contained the casino slug — it does not.
The slug only appears after following the link to its canonical review page.

**Decision (approved 2026-05-29): follow the link.** For CG-approved emails the parser
extracts the `casino.guru/userReview/...` href; the orchestrator then resolves it with
`UrlFetchApp` and reads the canonical `...-casino-review` slug to get the casino name.
Verified: `userReview/130406/49` resolves to `luckyvibe-casino-review` → `luckyvibe` →
Rooster Partners. This adds one external request to casino.guru per CG-approved email;
on fetch failure or unmapped slug the email is logged (`cg_resolve_failed` / `unknown_tab`)
and NOT labeled, so it retries next run. CG *rejected* is unchanged — its body literally
contains `casino review (<Name>)`.

It was also confirmed that **one Account Name has at most one pending CG review at a time**,
so a username-only fallback would be safe; we are not implementing it now (link-following
is sufficient), but it remains a cheap future option if link resolution proves flaky.

### Finding 3 — Canonical code location is the clasp project, not `supabase/apps-script/`

The live Apps Script project is managed by **clasp** from `apps-script/` (it has
`.clasp.json`). The earlier `EmailParser.gs` was written into `supabase/apps-script/`, which
is a **stale, un-deployed** copy whose `Code.gs` still uses the old `SPREADSHEET_ID` /
`dumpAllTabs` architecture. The current live `Code.gs` uses `SHEET_ID`. Therefore:

- `EmailParser.gs` moves into `apps-script/` and references **`SHEET_ID`** (not `SPREADSHEET_ID`).
- `createEmailSyncTrigger()` is added to `apps-script/Code.gs`.
- The stale `supabase/apps-script/` copies are removed to prevent further drift.
