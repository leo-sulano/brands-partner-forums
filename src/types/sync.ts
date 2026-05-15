export type SyncRunStatus = 'running' | 'success' | 'error';

export interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  rows_seen: number;
  rows_upserted: number;
  rows_skipped: number;
  error_message: string | null;
  status: SyncRunStatus;
}
