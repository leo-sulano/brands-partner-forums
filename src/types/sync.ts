export type SyncRunStatus = 'running' | 'success' | 'error' | 'skipped';
export type SyncDirection = 'sheet_to_db' | 'db_to_sheet' | 'initial_import' | 'status_check';

export interface SyncRun {
  id: string;
  direction: SyncDirection;
  tab: string | null;
  started_at: string;
  finished_at: string | null;
  rows_seen: number | null;
  rows_upserted: number | null;
  rows_skipped: number | null;
  status: SyncRunStatus;
  error_message: string | null;
  payload_ref: string | null;
}
