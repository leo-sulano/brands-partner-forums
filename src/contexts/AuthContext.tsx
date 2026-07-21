import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/profile';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  isApproved: boolean;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('Failed to fetch profile:', error.message);
    return null;
  }
  return data as Profile | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let currentUserId: string | undefined;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;
      // TEMP DIAGNOSTIC — remove once auto-logout/relogin bug is root-caused.
      console.log('[auth-debug]', new Date().toISOString(), 'event=', _event, 'userId=', s?.user.id, 'expiresAt=', s?.expires_at);
      setSession(s);

      // Tab regaining focus re-notifies with the same user's session as a
      // routine revalidation (Supabase does this on every visibilitychange,
      // not only when the token is actually refreshed, and reuses the
      // 'SIGNED_IN' event name for it — so the event type alone can't tell
      // a real sign-in from a revalidation). Only re-run the loading/profile
      // dance when the user actually changed.
      const sameUser = !!s && s.user.id === currentUserId;
      currentUserId = s?.user.id;
      if (sameUser) return;

      if (s) {
        // A new session means the previously-fetched profile (if any) is stale
        // until this resolves — without this, a sign-in on an already-mounted
        // AuthProvider (loading already false from an earlier no-session check)
        // renders isApproved=false against the stale profile for the duration
        // of this fetch, flashing "Pending Approval" even for approved users.
        setLoading(true);
        fetchProfile(s.user.id).then((p) => {
          if (!mounted) return;
          setProfile(p);
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (!session) return;
    const p = await fetchProfile(session.user.id);
    setProfile(p);
  }

  const isApproved = profile?.approved === true;
  const isAdmin = isApproved && profile?.role === 'admin';

  return (
    <AuthContext.Provider value={{ session, profile, isApproved, isAdmin, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
