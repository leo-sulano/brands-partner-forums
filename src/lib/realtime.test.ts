import { describe, it, expect } from 'vitest';
import { dedupePresenceState, type PresenceUser } from './realtime';

function meta(user: PresenceUser) {
  // Supabase decorates each tracked payload with presence_ref/phx_ref metadata;
  // the dedupe logic must not choke on those extra fields.
  return { ...user, presence_ref: Math.random().toString(36) };
}

describe('dedupePresenceState', () => {
  it('returns one entry per account when tracked from a single window', () => {
    const state = {
      'user-1': [meta({ email: 'a@example.com', userId: 'user-1', avatarUrl: null })],
    };
    expect(dedupePresenceState(state)).toEqual([
      { email: 'a@example.com', userId: 'user-1', avatarUrl: null, presence_ref: expect.any(String) },
    ]);
  });

  it('collapses multiple windows/tabs of the same account into a single avatar', () => {
    const user: PresenceUser = { email: 'a@example.com', userId: 'user-1', avatarUrl: null };
    const state = {
      // Same key ('user-1') but 3 separate metas — one per open tab/window.
      'user-1': [meta(user), meta(user), meta(user)],
    };
    expect(dedupePresenceState(state)).toHaveLength(1);
  });

  it('still shows one avatar per distinct account', () => {
    const state = {
      'user-1': [meta({ email: 'a@example.com', userId: 'user-1', avatarUrl: null })],
      'user-2': [
        meta({ email: 'b@example.com', userId: 'user-2', avatarUrl: null }),
        meta({ email: 'b@example.com', userId: 'user-2', avatarUrl: null }),
      ],
    };
    expect(dedupePresenceState(state)).toHaveLength(2);
  });

  it('returns an empty array for an empty state', () => {
    expect(dedupePresenceState({})).toEqual([]);
  });
});
