# AG/CG Review Link Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the new `AG Review Link` and `CG Review Link` sheet columns as clickable link columns in the dashboard for all 3-platform tabs.

**Architecture:** The data already flows into `entries.data` JSONB via `import-tabs`. The only change is adding the two column names to the whitelist arrays in `tab-configs.ts` and adding display labels. `BrandGroup.tsx` already renders URL-valued cells as `<a target="_blank">` links with no changes needed.

**Tech Stack:** TypeScript, Vite/React (build verification via `npm run build`)

## Global Constraints

- Column names must match the Google Sheet header exactly (case-sensitive): `AG Review Link`, `CG Review Link`
- Verify with `npm run build` (not `tsc --noEmit` — root tsconfig is references-only and checks nothing)
- Only touch `src/lib/tab-configs.ts`

---

### Task 1: Add AG/CG Review Link columns to tab-configs.ts

**Files:**
- Modify: `src/lib/tab-configs.ts`

**Interfaces:**
- Produces: `getTabColumns('Rooster Partners')` (and the other 3 tabs) now includes `'AG Review Link'` and `'CG Review Link'`; `getColLabel('AG Review Link')` returns `'AG Link'`; `getColLabel('CG Review Link')` returns `'CG Link'`

- [ ] **Step 1: Add `'AG Review Link'` and `'CG Review Link'` to Rooster Partners**

In `src/lib/tab-configs.ts`, update the `'Rooster Partners'` entry:

```typescript
  'Rooster Partners': [
    'Account',
    'Proxy Used',
    'Account Name',
    'Agent',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
  ],
```

- [ ] **Step 2: Add the same two columns to `'Hanan'`**

```typescript
  'Hanan': [
    'Account',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
  ],
```

- [ ] **Step 3: Add the same two columns to `'Revolution Casino'`**

```typescript
  'Revolution Casino': [
    'Account',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
  ],
```

- [ ] **Step 4: Add the same two columns to `'SilverPlay'`**

```typescript
  'SilverPlay': [
    'Account',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
  ],
```

- [ ] **Step 5: Add display labels to `COLUMN_LABELS`**

In the `COLUMN_LABELS` object, add after the `'CG Review Status'` entry:

```typescript
  'AG Review Link':                                    'AG Link',
  'CG Review Link':                                    'CG Link',
```

- [ ] **Step 6: Verify build passes**

```bash
npm run build
```

Expected: build succeeds with no TypeScript errors. If it fails, fix errors before committing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tab-configs.ts
git commit -m "Add AG Review Link and CG Review Link columns to 3-platform tabs"
```
