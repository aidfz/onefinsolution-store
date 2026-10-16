import 'server-only';

/**
 * Maps personal subscription Stripe price IDs → plan keys.
 * Prefer env (Railway) over the optional local billing/personal-plan-ids.json
 * artifact so production builds never depend on a gitignored file.
 */
export type PersonalPlanPrices = {
  daily: string;
  weekly: string;
  monthly: string;
  yearly: string;
};

function fromEnv(): PersonalPlanPrices {
  return {
    daily: process.env.STRIPE_PRICE_DAILY?.trim() || '',
    weekly: process.env.STRIPE_PRICE_WEEKLY?.trim() || '',
    monthly: process.env.STRIPE_PRICE_MONTHLY?.trim() || '',
    yearly: process.env.STRIPE_PRICE_YEARLY?.trim() || '',
  };
}

export function personalPlanPrices(): PersonalPlanPrices {
  return fromEnv();
}

/** Reverse lookup: Stripe price id → plan key (daily|weekly|monthly|yearly). */
export function planKeyForPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  const prices = personalPlanPrices();
  const hit = Object.entries(prices).find(([, id]) => id && id === priceId);
  return hit ? hit[0] : null;
}
