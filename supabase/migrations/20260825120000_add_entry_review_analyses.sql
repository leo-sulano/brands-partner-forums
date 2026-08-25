-- Fixes a real storage bug in the AI Review Removal Assessment feature (Task
-- 225/262/263): entries.ai_review_analysis was a single shared slot per entry
-- row, not one per platform. On a multi-platform tab (Rooster Partners,
-- Revolution Casino, SilverPlay, Hanan), analyzing one platform's review
-- overwrote any other platform's cached analysis for that same entry, and the
-- other platform's section in EditEntryModal showed the wrong cached result
-- mislabeled "Outdated" (a hash mismatch, not "not yet analyzed").
-- docs/superpowers/specs/2026-08-25-review-analysis-per-platform-storage-and-ask-ai-design.md

create table public.entry_review_analyses (
  entry_id     uuid not null references public.entries(id) on delete cascade,
  tab          text not null,
  platform     text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  analysis     jsonb not null,
  evidence     jsonb not null,
  hash         text not null,
  model        text not null,
  analyzed_at  timestamptz not null default now(),
  primary key (entry_id, platform)
);

alter table public.entry_review_analyses enable row level security;

create policy "anyone can read entry_review_analyses"
  on public.entry_review_analyses for select using (true);
create policy "approved users can insert entry_review_analyses"
  on public.entry_review_analyses for insert with check (public.is_approved());
create policy "approved users can update entry_review_analyses"
  on public.entry_review_analyses for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete entry_review_analyses"
  on public.entry_review_analyses for delete using (public.is_approved());

-- Preserve the 9 existing cached analyses on tabs where the platform is
-- unambiguous (these tabs never render an AG/CG section, so the existing
-- single-slot column can only ever have been for 'tp'). The 2 rows on
-- multi-platform tabs (Hanan, Rooster Partners) are genuinely ambiguous —
-- deliberately not migrated, and simply re-analyzable via the existing
-- "Analyze Review" button.
insert into public.entry_review_analyses (entry_id, tab, platform, analysis, evidence, hash, model, analyzed_at)
select id, tab, 'tp',
       ai_review_analysis,
       '{}'::jsonb,
       ai_review_analysis_hash,
       ai_review_analysis_model,
       ai_review_analysis_at
from public.entries
where ai_review_analysis is not null
  and tab in ('TP Brand Injection', 'TP Affiliate');

alter table public.entries
  drop column ai_review_analysis,
  drop column ai_review_analysis_hash,
  drop column ai_review_analysis_model,
  drop column ai_review_analysis_at;
