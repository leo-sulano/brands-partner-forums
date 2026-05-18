import { supabase } from './supabase';

// Returns an unsubscribe function. Call it in a useEffect cleanup.
export function subscribeEntries(onChange: () => void): () => void {
  const channel = supabase
    .channel('entries-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeSyncRuns(onChange: () => void): () => void {
  const channel = supabase
    .channel('sync-runs-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_runs' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
