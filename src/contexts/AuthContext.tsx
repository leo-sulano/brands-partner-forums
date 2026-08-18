import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { fetchCustomTabs } from '../lib/queries';
import { registerDynamicTabs } from '../lib/dynamicTabRegistry';
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

const PROFILE_FETCH_ATTEMPTS = 3;
const PROFILE_FETCH_RETRY_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries on query error (network blip, transient Supabase failure) so a
// one-off hiccup doesn't get treated the same as "profile not approved" —
// `maybeSingle()` already returns error:null for a genuinely missing row,
// so only real failures land here.
export async function fetchProfile(userId: string): Promise<Profile | null> {
  let lastErrorMessage: string | undefined;
  for (let attempt = 1; attempt <= PROFILE_FETCH_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (!error) return data as Profile | null;
    lastErrorMessage = error.message;
    if (attempt < PROFILE_FETCH_ATTEMPTS) {
      await delay(PROFILE_FETCH_RETRY_DELAY_MS * attempt);
    }
  }
  console.error('Failed to fetch profile after retries:', lastErrorMessage);
  return null;
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
        Promise.all([fetchProfile(s.user.id), fetchCustomTabs()]).then(([p, customTabs]) => {
          if (!mounted) return;
          registerDynamicTabs(customTabs);
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
