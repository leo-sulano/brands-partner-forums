# Proxy Filter — Design Spec

**Date:** 2026-05-19  
**Scope:** `src/pages/BrandGroup.tsx`

## Summary

Add a Proxy filter dropdown to the BrandGroup filter bar so users can narrow table rows by `proxy_used` value. The filter follows the existing `agentFilter` pattern exactly.

## State

```ts
const [proxyFilter, setProxyFilter] = useState('');
```

Reset to `''` in the existing `useEffect` that resets all filters on tab change.

## Options Derivation

```ts
const proxyOpts = useMemo(() => {
  const vals = [...new Set(
    rawEntries
      .map(e => e.data['Proxy Used'])
      .filter((v): v is string => !!v)
  )].sort();
  return [{ value: '', label: 'All Proxies' }, ...vals.map(v => ({ value: v, label: v }))];
}, [rawEntries]);
```

## UI

- Render a `BrandFilterDropdown` after the Agent filter in the filter bar.
- Only render when `proxyOpts.length > 1` (at least one non-null `proxy_used` value exists).
- Placeholder / default label: `"All Proxies"`.

## Filter Cascade

Insert after the `agentFilter` step:

```ts
.filter(e => !proxyFilter || e.data['Proxy Used'] === proxyFilter)
```

## Out of Scope

- No "No Proxy" special case for null values.
- No changes to tab-configs, data model, or Supabase queries.
