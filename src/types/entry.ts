export interface Entry {
  id: string;
  tab: string;
  sheet_row_id: string;
  data: Record<string, string | null>;
  updated_at: string;
  last_edited_by: 'dashboard' | 'sheet';
  last_sync_tag: string | null;
  ai_review_analysis?: Record<string, unknown> | null;
  ai_review_analysis_hash?: string | null;
  ai_review_analysis_model?: string | null;
  ai_review_analysis_at?: string | null;
}

export type EntryData = Record<string, string | null>;
