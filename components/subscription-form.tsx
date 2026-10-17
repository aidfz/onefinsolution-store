'use client';

import { useMemo, useState } from 'react';
import { startHostedSubscriptionCheckout } from '@/app/subscription-actions';

/**
 * Subscription purchase UI — pay-first via Stripe Hosted Checkout (pay.*).
 * No SetupIntent / save-card step before payment. The card used for the real
 * subscription (or trial signup) is saved on the Subscription Stripe Customer
 * when Checkout completes.
 */
export function SubscriptionForm({
  planKey,
  mode,
  publishableKey: _publishableKey,
  resumeSetup: _resumeSetup,
}: {
  planKey: string;
  mode: 'trial' | 'paid';
  publishableKey: string;
  resumeSetup?: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cancelledUrl = useMemo(
    () => `/pricing?billing=cancelled&plan=${encodeURIComponent(planKey)}`,
    [planKey],
  );

  async function startCheckout() {
    setBusy(true);
    setError('');
    try {
      const result = await startHostedSubscriptionCheckout(planKey, mode);
      if (result.error || !('data' in result) || !result.data?.url) {
        setError(result.error || 'Unable to start secure checkout.');
        setBusy(false);
        return;
      }
      window.location.assign(result.data.url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to start secure checkout.');
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="muted" style={{ lineHeight: 1.5 }}>
        You will pay on Stripe&apos;s secure checkout. There is no separate card-save step and no
        temporary authorization charge. After a successful payment
        {mode === 'trial' ? ' (or trial signup)' : ''}, that card is kept on your subscription account
        for renewals.
      </p>
      <button type="button" className="button" disabled={busy} onClick={() => void startCheckout()}>
        {busy
          ? 'Redirecting to secure checkout…'
          : mode === 'trial'
            ? 'Start trial — continue to secure checkout'
            : 'Subscribe — continue to secure checkout'}
      </button>
      <p>
        <a className="text-link" href={cancelledUrl}>
          Cancel and return to pricing
        </a>
      </p>
    </div>
  );
}
