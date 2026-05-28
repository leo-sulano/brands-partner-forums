import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export interface PresenceUser {
  email: string;
  userId: string;
}

export function usePresence(email: string | null, userId: string | null): PresenceUser[] {
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!email || !userId) return;

    const channel = supabase.channel('dashboard-presence', {
      config: { presence: { key: userId } },
    });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ email: string; userId: string }>();
        const users = Object.values(state).flatMap((presences) => presences);
        setOnline(users);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ email, userId });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [email, userId]);

  return online;
}

// deno-lint-ignore-file no-explicit-any
// Returns an unsubscribe function. Call it in a useEffect cleanup.
// The callback receives the Postgres change payload so the caller can merge
// the updated row directly into local state instead of re-fetching the table.
export function subscribeEntries(
  onChange: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: any; old: any }) => void,
): () => void {
  const channel = supabase
    .channel(`entries-realtime-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, (payload) => {
      onChange(payload as unknown as { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: any; old: any });
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeSyncRuns(onChange: () => void): () => void {
  const channel = supabase
    .channel(`sync-runs-realtime-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_runs' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
