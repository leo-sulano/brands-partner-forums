import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchToolbarFilters, fetchArchivedTabs, fetchPausedTabs, fetchTabIconOverrides, fetchHardcodedTabRenames } from '../lib/queries';
import { registerDynamicTabs } from '../lib/dynamicTabRegistry';
import { registerHiddenTabPlatforms, registerToolbarFilters } from '../lib/tab-configs';
import { applyArchivedTabs } from '../lib/archivedTabRegistry';
import { applyPausedTabs } from '../lib/pausedTabRegistry';
import { registerTabIconOverrides } from '../lib/tabIconOverrideRegistry';
import { registerHardcodedTabRenames } from '../lib/hardcodedTabRenameRegistry';
import { renameOperationalTab } from '../lib/tabs';
import type { Profile } from '../types/profile';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  isApproved: boolean;
  // super_admin is a strict superset of admin: isAdmin is true for both roles.
  isAdmin: boolean;
  isSuperAdmin: boolean;
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
        // Intentionally separate from bootstrapTabRegistries
        // (src/lib/tabRegistryBootstrap.ts), which Edge Function isolates use
        // for the same five registries plus this one's extra sixth (toolbar
        // filters, no server-side reader). No resets here -- a fresh page
        // load has nothing stale to clear, unlike a reused Deno isolate. Kept
        // as two hand-written sequences on purpose; check the other one for
        // drift before changing either.
        Promise.all([
          fetchProfile(s.user.id),
          fetchCustomTabs().catch((err) => {
            console.error('Failed to fetch custom tabs:', err);
            return [];
          }),
          fetchHiddenTabPlatforms().catch((err) => {
            console.error('Failed to fetch hidden tab platforms:', err);
            return [];
          }),
          fetchToolbarFilters().catch((err) => {
            console.error('Failed to fetch toolbar filters:', err);
            return [];
          }),
          fetchArchivedTabs().catch((err) => {
            console.error('Failed to fetch archived tabs:', err);
            return [];
          }),
          fetchPausedTabs().catch((err) => {
            console.error('Failed to fetch paused tabs:', err);
            return [];
          }),
          fetchTabIconOverrides().catch((err) => {
            console.error('Failed to fetch tab icon overrides:', err);
            return [];
          }),
          fetchHardcodedTabRenames().catch((err) => {
            console.error('Failed to fetch hardcoded tab renames:', err);
            return [];
          }),
        ]).then(([p, customTabs, hiddenPlatforms, toolbarFilters, archivedTabs, pausedTabs, tabIconOverrides, hardcodedTabRenames]) => {
          if (!mounted) return;
          registerDynamicTabs(customTabs);
          registerHiddenTabPlatforms(hiddenPlatforms);
          registerToolbarFilters(toolbarFilters);
          // Must run after registerDynamicTabs: a dynamic tab archived since
          // its custom_tabs row was created gets registered (added back to
          // OPERATIONAL_TABS) and then immediately archived again (removed)
          // in that order -- reversed, it would incorrectly reappear.
          applyArchivedTabs(archivedTabs);
          // Order relative to applyArchivedTabs doesn't matter here (unlike
          // dynamic tabs vs. archive above): pausing never touches
          // OPERATIONAL_TABS membership, only pausedTabRegistry's own set.
          applyPausedTabs(pausedTabs);
          // Also order-independent: icon overrides apply to hardcoded tabs
          // too, so this never depends on a tab being registered as dynamic.
          registerTabIconOverrides(tabIconOverrides);
          // Order-independent, same reasoning as tabIconOverrides above: a
          // rename applies to hardcoded tabs regardless of dynamic/archive/
          // pause state.
          registerHardcodedTabRenames(hardcodedTabRenames);
          // registerHardcodedTabRenames only populates the resolver's own
          // lookup maps -- OPERATIONAL_TABS itself needs its own splice per
          // row, exactly like a live in-session rename (EditBrandTabModal.tsx)
          // calls renameHardcodedTabLocally and renameOperationalTab as two
          // explicit steps. Without this, a tab renamed in one browser
          // session stays unreachable by its new name/slug in every other
          // session (or after a reload) until this loop runs.
          for (const row of hardcodedTabRenames) {
            renameOperationalTab(row.original_name, row.current_name);
          }
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
  const isSuperAdmin = isApproved && profile?.role === 'super_admin';
  const isAdmin = isApproved && (profile?.role === 'admin' || profile?.role === 'super_admin');

  return (
    <AuthContext.Provider value={{ session, profile, isApproved, isAdmin, isSuperAdmin, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
