# 2026-09-23 — Brand Rename + Editable Brand Links (Task 353)

## What shipped
- Spec: `docs/superpowers/specs/2026-09-23-brand-rename-and-links-design.md`; plan: `docs/superpowers/plans/2026-09-23-brand-rename-and-links.md`.
- Live migrations: `20260923120000_add_rename_brand_functions.sql`, `20260923130000_harden_rename_brand_functions.sql`, `20260923140000_rename_brand_all_matching_keys.sql` (effective definitions = latest). RPCs: `rename_brand(p_old,p_new,p_link_fills)`, `set_brand_links(p_brand,p_writes)`, `count_brand_usage(p_name)`; all `is_approved()`-gated, anon revoked.
- Rename is GLOBAL (every tab), blocked if the new name already exists (case/whitespace-only allowed). Rewrites every matching BRAND_COLS key in entries.data + every public table with a `brand` column except history tables; stamps last_edited_*/updated_at; one edit_log row per entry.
- UI: `src/components/TabBrandsSection.tsx` (Brands list in Edit Brand Tab), `BrandRenameDialog.tsx` (shared confirm), Edit Entry Brand Name pencil. Pure helpers in `src/lib/brandRename.ts`.
- Link columns: TP → `getBrandLinkCol(tab)`, AG/CG → `AG/CG Review Link`, WO → `Link to the profile` ONLY on the Wizard of Odds tab (on dynamic tabs that column is TP's per-review profile link).

## Verified
- `npm run build` clean; full vitest 3686/0.
- Live RPC checks on scratch brands/entries (rename, collision, case-only, multi-key row, allowlist, anon revoke); all scratch rows cleaned (0 remaining).
- Live UI E2E on SilverPlay with scratch brand "ZZ E2E Brand": add → rename + link edit → confirm dialog → collision error; cleaned.

## Open / pending
- **3 stray PMS cards** created by the E2E (Schedule Planner auto-sync) for "ZZ E2E Brand 2" (SilverPlay, TP/AG/CG, 9/22–9/25/2026): ids `cmue430g8000d04kxq2z3diz8`, `cmue43151000g04kxiyemwi71`, `cmue431qw000j04kxh8otxzl0`. PMS API was unreachable from the sandbox — delete manually. Local schedule rows already removed so they won't be recreated.
- **EC2 pending manual step:** `scripts/check_brand_page_removed.py` reads TP URLs only from the name-keyed map; a renamed brand without an entry-level TP link falls into `no_url` (skips page-removed check). Needs a fallback to the entry's brand-link column / `brand_catalog.link` + EC2 deploy.
- Accepted side effects: existing PMS card titles keep the old name; EC2 rotation-group hash may move a renamed brand to a different week; history tables keep old names; localStorage brand filters with the old name stop matching.
- Deferred minors (non-blocking): duplicate edit_log rows when a fill + rename hit the same entry; pre-existing Edit Entry diff keys off `fields[brandCol]` so re-picking a different brand and saving can flag/email the picked brand (predates this work — worth its own task); narrow in-flight reload race after Edit Entry rename (self-heals); no UI tests (repo has no DOM test env).
- No real brand has been renamed yet — the first real rename is the user's.
