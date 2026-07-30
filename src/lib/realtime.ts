import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export interface PresenceUser {
  email: string;
  userId: string;
  avatarUrl: string | null;
}

// A single account tracked from multiple open windows/tabs gets one presence
// "meta" per connection, all under the same key (the user's id). Keep only
// one meta per key so the same account never renders more than one avatar.
export function dedupePresenceState<T>(state: Record<string, T[]>): T[] {
  return Object.values(state)
    .map((presences) => presences[0])
    .filter((p): p is T => p !== undefined);
}

export function usePresence(email: string | null, userId: string | null, avatarUrl: string | null): PresenceUser[] {
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
        const state = channel.presenceState<PresenceUser>();
        setOnline(dedupePresenceState(state));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ email, userId, avatarUrl });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [email, userId, avatarUrl]);

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
