# Per-Account PMS Task Cards — Design

## Context

Reported live (BIT tab, Casino Magius, 2026-09-14): 3 accounts (504/Ireneo/LAI,
506/Mateo/JEN, 512/Toon/ANN) all posted Trustpilot reviews for Casino Magius on the
same day. The Schedule Planner day cell correctly shows one chip with a `×3` badge
(Task 347) and the toolbar total correctly counts all 3 (this session's earlier fix
to `countActivePlatformSlots`). But the PMS board still shows only **one** task card
for that brand+platform+day — the one `ensureWeekGenerated` proactively created when
the slot first became active, before any of these 3 accounts existed. Accounts 506
and 512 never triggered a PMS push at all, because adding a review account manually
(`BrandGroup.tsx`'s Add Review Account flow) only writes to `entries` — it never calls
into the PMS-push code path, which today only fires from the scheduler's own
generation/cell-click flow.

The user wants each account handled by a different agent to get its own PMS task card,
since in practice a different agent worked each one and needs it tracked as their own
piece of work.

**Why this needs care, not a quick patch:** `schedule_pms_links` has a hard
`unique (tab, brand_key, platform, date)` constraint — by design, exactly one PMS task
per brand+platform+day. Every consumer of that table (`pushScheduleToPms`'s
idempotency check, `resolveAndSyncTabStatuses`'s status-sync resolution,
`backfillMissingScheduledLinks`, `computeSchedulePmsParityIssues`,
`cancelScheduleInPms`, `pullScheduleFromPms`) assumes 1 row = 1 combo. This is also the
single most bug-prone subsystem in this project's history (Tasks 267, 287, 292, 294,
302, 319, 320, 325, 341, 342 — roughly a dozen fix cycles), so this spec exists to get
the design right before touching it, per the project's own standing Tier-3 practice.

## Goals

- Each real account (entry) posting for an already-scheduled brand+platform+day gets
  its own PMS task card, assigned to that account's own agent — not the brand-level
  aggregate agent.
- Backfilled now (Casino Magius's 2 missing cards) and self-healing going forward (any
  future multi-account day), via the same mechanism — no separate one-off script.
- Each entry-tied card tracks its own entry's status independently (Removed/Published/
  Pending/Done), not the combo's aggregated status.
- The existing single-task-per-slot model is left completely untouched for the common
  case (1 account per brand+platform+day, the overwhelming majority) — this is
  additive, not a redesign.

**Non-goals:** changing how a slot's *first* task is created (still the existing
proactive `ensureWeekGenerated` → `pushScheduleActivations` path, unchanged); retrying
already-decided old data beyond the current week (same scoping the existing backfill
mechanisms already use); custom platforms (out of scope, same as every other PMS-sync
task to date — no evidence any custom platform combo has ever hit this multi-account
case).

## Design

### Data model

`schedule_pms_links` gains one nullable column:

```sql
alter table public.schedule_pms_links
  add column entry_id uuid references public.entries(id) on delete set null;

-- At most one "generic" (not tied to a specific account) link per combo --
-- Postgres allows multiple NULLs under a plain unique constraint, so this
-- needs a partial index, not a column addition to the existing constraint.
create unique index schedule_pms_links_one_generic_per_combo
  on public.schedule_pms_links (tab, brand_key, platform, date)
  where entry_id is null;

-- Multiple entry-tied links are fine per combo (one per account), but never
-- two for the SAME account.
create unique index schedule_pms_links_one_per_entry
  on public.schedule_pms_links (tab, brand_key, platform, date, entry_id)
  where entry_id is not null;
```

The existing plain `unique (tab, brand_key, platform, date)` constraint is dropped and
replaced by these two partial indexes — everywhere in the codebase that currently reads
`schedule_pms_links` and filters by `(brand_key, platform, date)` to mean "the one link
for this combo" now needs to either filter further by `entry_id is null` (the generic
link) or iterate all matches (entry-tied links). See "Call sites" below for exactly
which functions need which treatment.

`on delete set null` (not cascade): if the underlying `entries` row is ever deleted,
the PMS task and its link both stay — just no longer traceable back to a specific
account. Matches this project's general stance of never silently deleting PMS history.

### `EntryDetails` gains two fields

`src/lib/scheduler/scheduleUtils.ts`'s `EntryDetails` (already touched twice this
session — `agent` was added earlier today) gains:
- `id: string` — the underlying `entries.id`, needed to set `entry_id` on a new link.
- `kind: DateEvidenceKind` — which of the four evidence categories *this specific
  entry* landed in (`buildDateStatusIndex` already computes this per-entry before
  merging into the combo-level Sets; it's currently discarded). Needed so an
  entry-tied link's status can be resolved directly from its own entry, without
  re-deriving the combo's aggregate precedence.

Both are populated in the same loop iteration that already builds `entries` (Task 347),
so they can never disagree with what's already indexed.

### New push mechanism: `backfillMissingEntryLinks`

A new function in `pmsSync.ts`, sibling to (not a modification of)
`backfillMissingScheduledLinks` — deliberately separate because its trigger condition
is fundamentally different (real evidence, not the plan):

```
for each (tab, brand_key, platform, date) combo with dateStatusIndex.entries.get(key)
  non-empty:
    entryList = getEntryList(...)                      // every real entry, in order
    existingLinks = links for this combo (generic + entry-tied)
    linkedEntryIds = { l.entry_id for l in existingLinks if l.entry_id != null }
    genericCoverage = 1 if any(l.entry_id == null for l in existingLinks) else 0
    // Position-based, not count-based: entryList[0] is covered by the
    // pre-existing generic link (if one exists) FOREVER, regardless of how
    // many entry-tied links get created in later backfill runs -- this must
    // stay purely a function of (genericCoverage, entry's own id), never of
    // how many *other* entries currently have their own link, or a second
    // backfill run would incorrectly stop skipping entryList[0].
    unlinkedEntries = [
      entry for i, entry in enumerate(entryList)
      if entry.id not in linkedEntryIds and i >= genericCoverage
    ]
    for each entry in unlinkedEntries:
      create a new PMS task, title "<tabLabel> | <brand> — <entry.account>",
      description = buildTaskDescription(entry) (already exists, unmodified),
      assignee = resolveAssigneeId(entry.agent, teamMembers) (existing helper,
      fed the entry's own agent instead of the combo-level one),
      column = whatever the existing link(s) for this combo are currently in
      (so a new card lands in "Removed"/"Done"/wherever the slot already is,
      not always fresh in To Do),
      then insertSchedulePmsLink(..., entry_id = entry.id)
```

Wired into the same two places `backfillMissingScheduledLinks` already runs from
(`sync-schedule-pms/index.ts`'s `backfillActiveTabs`, called from both the 1-minute
cron and the daily audit) — same self-healing shape, same weekStart scoping (current
week only). This is what makes "backfill now" and "self-heals going forward" the exact
same code path, per the approved design.

### Status sync: `resolveAndSyncTabStatuses`

For each link:
- `entry_id == null` (generic): **unchanged** — still resolves via the existing
  `resolvePmsSyncStatus(brandKey, platform, date, dateStatusIndex, isPaused)`
  combo-aggregate precedence (removed > confirmed > pending > done > paused > active).
- `entry_id != null` (entry-tied): new `resolveEntryPmsStatus(kind: DateEvidenceKind):
  PmsSyncStatus` — a straight 1:1 map (removed→removed, confirmed→published,
  pending→pending, done→done). No `isPaused` branch: an entry-tied link only ever
  exists because that specific entry already has real evidence, so it can never be in
  a "paused" or "active" (not-yet-decided) state — those are plan-level concepts that
  don't apply to a settled account.

Everything else in `resolveAndSyncTabStatuses` (removed-page-card parking, tab-pause
force-pause, cancellation-detection for a day with no schedule row at all) stays
generic-link-only — an entry-tied link represents settled history for one specific
account, not a currently-scheduled slot, so none of those "is this day still supposed
to be happening" checks apply to it. Entry-tied links are filtered out of those
branches entirely (left untouched, same as an already-excluded hidden/restricted
combo is today).

### Call sites NOT changed

- `pushScheduleToPms` (the proactive activation-time push): unchanged. Its
  `alreadyLinked` check ("does any link exist for this combo") still means "does the
  generic link exist" for its purposes — the first click/generation on a slot still
  creates exactly the one generic card it always has, regardless of whether entry-tied
  cards exist alongside it later.
- `computeSchedulePmsParityIssues`: unchanged. It already excludes any day with real
  evidence from its comparison (evidence always outranks the plan) — a multi-account
  day is, by definition, a day with evidence, so it was never going to be checked by
  this function either way.
- `cancelScheduleInPms` / `pullScheduleFromPms`: unchanged for now. A cancelled/deleted
  day only ever applies to the generic (plan-level) link; an entry-tied link represents
  real historical evidence that already happened and isn't "cancellable" the way a
  future plan slot is.

## Testing plan

- Unit tests for `EntryDetails.id`/`.kind` population in `buildDateStatusIndex`.
- Unit tests for `backfillMissingEntryLinks`: creates the right number of new links for
  a multi-entry combo with a pre-existing generic link; creates links for ALL entries
  when no generic link exists yet; is a no-op when every entry already has a link;
  respects the "first entry rides the generic link" rule.
- Unit tests for `resolveEntryPmsStatus`'s 1:1 mapping.
- Full suite + build + `deno check` on both edge functions, same as every prior task
  this session.
- Live verification against the real Casino Magius case: run the backfill, confirm 2
  new PMS cards appear (titled with 506/Mateo and 512/Toon's accounts, assigned JEN and
  ANN respectively), confirm the pre-existing card is untouched, confirm all 3 show
  "Done" in PMS (matching today's real entry status).

## Open risk, accepted

`unlinkedEntries`'s "first entry rides the generic link" rule is positional (encounter
order in `entries`, which itself follows raw entry array order — not creation time or
any other meaningful ordering). Which real account ends up "represented" by the
pre-existing generic card is therefore somewhat arbitrary. Accepted because: (a) the
generic card's title/description were never account-specific to begin with (today it's
just `"<tab> | <brand>"`, no account info) — so no existing information is
attributed to the "wrong" account by this; (b) the entry-tied cards created going
forward always resolve correctly by explicit `entry_id`, so this ambiguity is a one-time
artifact of the transition, not a recurring class of bug.
