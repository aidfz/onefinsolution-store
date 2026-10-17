'use client';

import { useEffect, useRef } from 'react';
import Intercom from '@intercom/messenger-js-sdk';

/** OneFinSolution Intercom workspace App ID. */
export const INTERCOM_APP_ID = 'adk4uper';

export type IntercomUserPayload = {
  user_id: string;
  email: string;
  name?: string;
  /** Unix timestamp in seconds. */
  created_at?: number;
} | null;

type Props = {
  /** Authenticated user from the server session; null = visitor. */
  user?: IntercomUserPayload;
};

function bootIntercom(user: IntercomUserPayload) {
  const settings: Record<string, string | number | undefined> = {
    app_id: INTERCOM_APP_ID,
  };

  if (user?.user_id) {
    settings.user_id = user.user_id;
    if (user.email) settings.email = user.email;
    if (user.name) settings.name = user.name;
    if (typeof user.created_at === 'number' && Number.isFinite(user.created_at)) {
      settings.created_at = user.created_at;
    }
  }

  Intercom(settings);
}

/**
 * Boots Intercom Messenger site-wide via @intercom/messenger-js-sdk (Next.js / React).
 * - Visitors: app_id only
 * - Logged-in: app_id + user_id, email, name, created_at (Unix seconds)
 *
 * Server passes the session user on first paint; client re-syncs after login/logout
 * via /api/account/session so SPA navigations stay correct.
 */
export function IntercomMessenger({ user = null }: Props) {
  const bootedFor = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const apply = (next: IntercomUserPayload) => {
      const identityKey = next?.user_id ? `user:${next.user_id}` : 'visitor';
      if (bootedFor.current === identityKey) return;

      // Identity changed (login/logout) — restart messenger with the new context.
      if (bootedFor.current && bootedFor.current !== identityKey) {
        try {
          window.Intercom?.('shutdown');
        } catch {
          /* ignore */
        }
      }

      bootedFor.current = identityKey;
      bootIntercom(next);
    };

    apply(user ?? null);

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/account/session', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as {
          user?: {
            id?: string;
            email?: string;
            name?: string | null;
            createdAt?: string | null;
          } | null;
        };
        if (!data.user?.id || !data.user.email) {
          apply(null);
          return;
        }
        apply({
          user_id: data.user.id,
          email: data.user.email,
          name: data.user.name || undefined,
          created_at: data.user.createdAt
            ? Math.floor(new Date(data.user.createdAt).getTime() / 1000)
            : undefined,
        });
      } catch {
        /* keep server-bootstrapped identity */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.user_id, user?.email, user?.name, user?.created_at]);

  return null;
}
