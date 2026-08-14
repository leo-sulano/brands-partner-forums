-- supabase/migrations/20260814150000_add_ai_review_analysis.sql
-- AI Review Removal Assessment: caches the structured AI analysis of a
-- single TP/WO review's content + behavioral evidence. Strictly 1:1 with
-- one entries row (same shape as last_edited_by/last_sync_tag), not a side
-- table — no RLS change needed, existing entries policies already cover
-- reads/writes to these columns.
alter table public.entries
  add column ai_review_analysis jsonb,
  add column ai_review_analysis_hash text,
  add column ai_review_analysis_model text,
  add column ai_review_analysis_at timestamptz;
