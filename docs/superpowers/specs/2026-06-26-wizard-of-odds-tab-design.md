# Wizard of Odds Tab — Design Spec

**Date:** 2026-06-26
**Status:** Approved

## Overview

Add "Wizard of Odds" as a new brand group tab in the dashboard, mirroring the existing tab pattern. The tab maps 1:1 to the "Wizard of Odds" sheet in the Google Sheet. No changes to the import pipeline are needed — it already syncs all sheet tabs generically.

## Changes Required

### 1. `src/lib/tabs.ts`

Add `"Wizard of Odds"` to the `OPERATIONAL_TABS` tuple. This makes the tab appear in the sidebar and enables slug-based routing (`/brands/wizard-of-odds`).

### 2. `src/lib/tab-configs.ts`

**Column whitelist** (in display order):

| Sheet Column Header      | Display Label  |
|--------------------------|----------------|
| Agent                    | Agent          |
| Account                  | Account        |
| Proxy Used               | Proxy Used     |
| Brand Name               | Brand Name     |
| Wizard of Odds           | WO Date        |
| WoO Review Status        | WO Status      |
| Wizard of OddsScore added| WO Score       |
| Link to the profile      | Link           |

Label overrides go into `COLUMN_LABELS` (global) or `TAB_COLUMN_LABELS["Wizard of Odds"]` (tab-specific). Prefer tab-specific to avoid collisions with other tabs that might have a "Wizard of Odds" column name.

Sensitive columns excluded: Email, Password, User Name, Account Name, Account Surname, Process, Details.

### 3. `src/pages/BrandGroup.tsx`

Extend inline editing to handle the three WO-specific columns using the same pattern as TP/AG/CG columns:

| Column                    | Editor type                                      |
|---------------------------|--------------------------------------------------|
| `Wizard of Odds`          | Date picker (DD/MM/YYYY)                         |
| `WoO Review Status`       | Dropdown: Removed / Not Published / Still Published |
| `Wizard of OddsScore added` | Text input (numeric, e.g. 5 or 4.5)           |

Status colour mapping for `WoO Review Status`:
- **Still Published** → green (same as Live/Published)
- **Removed** → red (same as Removed)
- **Not Published** → amber (same as Pending)

### 4. `src/components/Sidebar.tsx`

Add `"Wizard of Odds"` to `TAB_ICONS` using a star or trophy icon (e.g. Lucide `Star` or `Trophy`).

## Data Flow

No changes to the Edge Function. The import-tabs function already:
- Dumps all sheet tabs via Apps Script
- Upserts rows into `entries` where `tab = 'Wizard of Odds'`
- Stores headers in `tab_schemas`

Once the tab is in `OPERATIONAL_TABS`, the dashboard will display it as soon as a sync has run.

## Out of Scope

- Platform cards (TP/AG/CG summary cards) — WO is a single-platform tab, no cards needed.
- Check-status automation for WO — not requested.
- Any changes to the import-tabs Edge Function or Apps Script.
