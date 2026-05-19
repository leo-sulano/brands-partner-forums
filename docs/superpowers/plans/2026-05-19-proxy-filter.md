# Proxy Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Proxy Used" filter dropdown to the BrandGroup filter bar that narrows table rows to a selected proxy value.

**Architecture:** Mirror the existing `agentFilter` pattern in BrandGroup.tsx — add state, derive unique options from raw entries, render a `BrandFilterDropdown` after the agent filter, and splice a filter step into the cascade after `agentFiltered`.

**Tech Stack:** React 19 · TypeScript · Tailwind v4 (no new dependencies)

---

### Task 1: Add `proxyFilter` state and reset

**Files:**
- Modify: `src/pages/BrandGroup.tsx:487` (state declarations)
- Modify: `src/pages/BrandGroup.tsx:505` (tab-change reset effect)

- [ ] **Step 1: Add state declaration after `agentFilter` on line 487**

Find this block:
```ts
  const [agentFilter, setAgentFilter] = useState('');
```
Replace with:
```ts
  const [agentFilter, setAgentFilter] = useState('');
  const [proxyFilter, setProxyFilter] = useState('');
```

- [ ] **Step 2: Add reset in the tab-change useEffect after line 505**

Find this block in the useEffect:
```ts
    setAgentFilter('');
    setDateFrom('');
```
Replace with:
```ts
    setAgentFilter('');
    setProxyFilter('');
    setDateFrom('');
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat(proxy-filter): add proxyFilter state and reset on tab change"
```

---

### Task 2: Derive unique proxy options

**Files:**
- Modify: `src/pages/BrandGroup.tsx:603–606` (after agentCol/uniqueAgents derivation)

- [ ] **Step 1: Add uniqueProxies derivation after uniqueAgents block**

Find this block (around line 603):
```ts
  const agentCol = headers.includes('Agent') ? 'Agent' : null;
  const uniqueAgents = agentCol
    ? [...new Set(entries.map((e) => e.data[agentCol]).filter((v): v is string => !!v && v.trim() !== ''))].sort()
    : [];
```
Replace with:
```ts
  const agentCol = headers.includes('Agent') ? 'Agent' : null;
  const uniqueAgents = agentCol
    ? [...new Set(entries.map((e) => e.data[agentCol]).filter((v): v is string => !!v && v.trim() !== ''))].sort()
    : [];

  const uniqueProxies = headers.includes('Proxy Used')
    ? [...new Set(entries.map((e) => e.data['Proxy Used']).filter((v): v is string => !!v && v.trim() !== ''))].sort()
    : [];
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat(proxy-filter): derive unique proxy options from entries"
```

---

### Task 3: Add proxy step to filter cascade

**Files:**
- Modify: `src/pages/BrandGroup.tsx:621–626` (filter cascade, after agentFiltered)

- [ ] **Step 1: Add proxyFiltered step after agentFiltered**

Find this block (around line 621):
```ts
  const agentFiltered = agentFilter && agentCol
    ? brandFiltered.filter((e) => e.data[agentCol] === agentFilter)
    : brandFiltered;

  // Platform filter only affects visible columns, not row filtering.
  const platformFiltered = agentFiltered;
```
Replace with:
```ts
  const agentFiltered = agentFilter && agentCol
    ? brandFiltered.filter((e) => e.data[agentCol] === agentFilter)
    : brandFiltered;

  const proxyFiltered = proxyFilter
    ? agentFiltered.filter((e) => e.data['Proxy Used'] === proxyFilter)
    : agentFiltered;

  // Platform filter only affects visible columns, not row filtering.
  const platformFiltered = proxyFiltered;
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat(proxy-filter): splice proxy filter step into filter cascade"
```

---

### Task 4: Render proxy filter dropdown in the filter bar

**Files:**
- Modify: `src/pages/BrandGroup.tsx:885–892` (filter bar UI, after agent dropdown)

- [ ] **Step 1: Add BrandFilterDropdown for proxy after the agent dropdown**

Find this block (around line 885):
```tsx
          {uniqueAgents.length > 1 && (
            <BrandFilterDropdown
              noun="agent"
              value={agentFilter}
              onChange={(v) => { setAgentFilter(v); setPage(1); }}
              brands={uniqueAgents}
            />
          )}
```
Replace with:
```tsx
          {uniqueAgents.length > 1 && (
            <BrandFilterDropdown
              noun="agent"
              value={agentFilter}
              onChange={(v) => { setAgentFilter(v); setPage(1); }}
              brands={uniqueAgents}
            />
          )}
          {uniqueProxies.length > 1 && (
            <BrandFilterDropdown
              noun="proxie"
              value={proxyFilter}
              onChange={(v) => { setProxyFilter(v); setPage(1); }}
              brands={uniqueProxies}
            />
          )}
```

- [ ] **Step 2: Verify the app compiles**

```bash
npm run build
```
Expected: build completes with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat(proxy-filter): render proxy dropdown in BrandGroup filter bar"
```
