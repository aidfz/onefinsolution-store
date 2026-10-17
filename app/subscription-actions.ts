'use server';

import { currentUser } from '@/lib/session';
import { createSubscriptionHostedCheckout } from '@/lib/hosted-checkout';
import { throttle } from '@/lib/auth-service';

/**
 * Direct subscription payment only (Stripe Hosted Checkout).
 * No SetupIntent, no card-save-before-pay, no separate enrollment setup session.
 */
export async function startHostedSubscriptionCheckout(
  planKey: string,
  mode: 'trial' | 'paid',
) {
  const user = await currentUser();
  if (!user) return { error: 'Please sign in first.' } as const;
  if (!['trial', 'paid'].includes(mode)) {
    return { error: 'Choose trial or subscription.' } as const;
  }
  await throttle(`hosted-sub:${user.id}`, 12);
  try {
    const data = await createSubscriptionHostedCheckout({ planKey, mode });
    return { data } as const;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unable to start secure checkout.',
    } as const;
  }
}

/** @deprecated Use startHostedSubscriptionCheckout — SetupIntent enrollment removed. */
export async function prepareSubscription(_key: string, _mode: 'trial' | 'paid') {
  return {
    error:
      'Card setup before payment was removed. Use Continue to secure checkout to pay for your plan directly.',
  } as const;
}

/** @deprecated Use startHostedSubscriptionCheckout — SetupIntent enrollment removed. */
export async function finishSubscription(_setupId: string, _consent: boolean) {
  return {
    error:
      'Card setup before payment was removed. Start checkout from pricing to subscribe directly.',
  } as const;
}
