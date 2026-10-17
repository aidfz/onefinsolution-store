import 'server-only';

import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { query } from '@/lib/db';
import { findPlan } from '@/lib/plans';
import { currentUser } from '@/lib/session';
import { getSoftwarePurchaseItem } from '@/lib/software-purchase';
import { softwareCustomer } from '@/lib/software-stripe';
import { verifiedStripe } from '@/lib/stripe';
import { currentCustomer } from '@/lib/stripe-billing';
import { approvedPrice } from '@/lib/subscription-catalog';
import { sitePath } from '@/lib/site-url';
import { resolveWorkspaceCreditPack } from '@/lib/workspace-credit-pack';
import { workspaceCustomer } from '@/lib/workspace-stripe';

const APP = 'chatbot-template';
const SOFTWARE_APP = 'onefin-software-store';

function absoluteOnApex(path: string): string {
  return sitePath(path);
}

/**
 * Hosted Checkout Session creators for all three billing modules.
 *
 * Stripe serves `session.url` on the custom domain pay.onefinsolution.store
 * when that domain is verified in the Dashboard. Our app never hosts pay.* —
 * success/cancel always return to the apex site (onefinsolution.store).
 */

export async function createSubscriptionHostedCheckout(input: {
  planKey: string;
  mode: 'trial' | 'paid';
}): Promise<{ url: string; sessionId: string }> {
  const user = await currentUser();
  if (!user) throw new Error('Please sign in.');

  const plan = findPlan(input.planKey);
  if (plan.key === 'custom') {
    throw new Error('Custom plans are arranged with our team.');
  }

  const stripe = await verifiedStripe();
  const customerId = await currentCustomer(true);
  if (!customerId) throw new Error('Unable to create billing customer.');

  const price = await approvedPrice(stripe, plan.key);
  const enrollmentId = randomUUID();

  // billing_enrollments PK is user_id — one active enrollment row per user
  await query(
    `insert into billing_enrollments(user_id, request_id, plan_key, mode, setup_id)
     values($1,$2,$3,$4,$5)
     on conflict (user_id) do update set
       request_id=excluded.request_id,
       plan_key=excluded.plan_key,
       mode=excluded.mode,
       setup_id=excluded.setup_id`,
    [user.id, enrollmentId, plan.key, input.mode, `hosted:${enrollmentId}`],
  );

  const meta: Record<string, string> = {
    app: APP,
    billing_scope: 'subscription',
    user_id: user.id,
    plan_key: plan.key,
    enrollment_id: enrollmentId,
    enrollment_mode: input.mode,
  };

  const trialDays =
    input.mode === 'trial' && plan.trialDays > 0 ? plan.trialDays : undefined;

  const params: Stripe.Checkout.SessionCreateParams = {
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: absoluteOnApex(
      `/checkout/complete?session_id={CHECKOUT_SESSION_ID}&scope=subscription`,
    ),
    cancel_url: absoluteOnApex(
      `/subscribe?plan=${encodeURIComponent(plan.key)}&mode=${input.mode}&cancelled=1`,
    ),
    client_reference_id: user.id,
    metadata: meta,
    // Card is collected during the real subscription/trial Checkout — no prior SetupIntent.
    payment_method_collection: 'always',
    subscription_data: {
      metadata: meta,
      ...(trialDays ? { trial_period_days: trialDays } : {}),
    },
    payment_method_types: ['card'],
    billing_address_collection: 'auto',
  };

  const session = await stripe.checkout.sessions.create(params);
  if (!session.url) throw new Error('Checkout session missing redirect URL.');
  return { url: session.url, sessionId: session.id };
}

export async function createWorkspaceCreditsHostedCheckout(input: {
  amountUsd?: number | string | null;
  purchaseId?: string | null;
}): Promise<{ url: string; sessionId: string; purchaseId: string }> {
  const user = await currentUser();
  if (!user) throw new Error('Please sign in.');

  const pack = resolveWorkspaceCreditPack(input.amountUsd);
  const stripe = await verifiedStripe();
  const customerId = await workspaceCustomer(user.id, true);
  if (!customerId) throw new Error('Unable to create workspace billing customer.');

  const purchaseId =
    typeof input.purchaseId === 'string' && /^[0-9a-f-]{36}$/i.test(input.purchaseId)
      ? input.purchaseId
      : randomUUID();

  await query(
    `insert into workspace_credit_purchases(id,user_id,amount,credits,status)
     values($1,$2,$3,$4,'pending')
     on conflict (id) do nothing`,
    [purchaseId, user.id, pack.amountCents, pack.credits],
  );

  const meta: Record<string, string> = {
    app: APP,
    billing_scope: 'workspace',
    user_id: user.id,
    purchase_id: purchaseId,
    credits: String(pack.credits),
    amount_cents: String(pack.amountCents),
    pack_id: pack.packId,
  };

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = {
    quantity: 1,
    price_data: {
      currency: 'usd',
      unit_amount: pack.amountCents,
      product_data: {
        name: pack.isDefaultPack
          ? `Workspace credits (${pack.credits})`
          : `Workspace credits — ${pack.amountUsd}`,
        metadata: { billing_scope: 'workspace', pack_id: pack.packId },
      },
    },
  };

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment',
    line_items: [lineItem],
    success_url: absoluteOnApex(
      `/checkout/complete?session_id={CHECKOUT_SESSION_ID}&scope=workspace`,
    ),
    cancel_url: absoluteOnApex('/checkout/credits?cancelled=1'),
    client_reference_id: user.id,
    metadata: meta,
    payment_intent_data: {
      metadata: meta,
      setup_future_usage: 'off_session',
    },
    payment_method_types: ['card'],
    billing_address_collection: 'auto',
  });

  if (!session.url) throw new Error('Checkout session missing redirect URL.');
  return { url: session.url, sessionId: session.id, purchaseId };
}

export async function createSoftwareHostedCheckout(input: {
  kind: string;
  id: string;
  amountCents: number;
  purchaseId?: string | null;
}): Promise<{ url: string; sessionId: string; purchaseId: string }> {
  const user = await currentUser();
  if (!user) throw new Error('Please sign in.');

  const item = getSoftwarePurchaseItem(input.kind, input.id);
  if (!item) throw new Error('Product not found.');

  const amountCents = Math.round(Number(input.amountCents));
  if (!Number.isSafeInteger(amountCents) || amountCents < 500) {
    throw new Error('Invalid payment amount.');
  }
  const agreedPriceCents = item.priceCents;
  if (amountCents > agreedPriceCents) {
    throw new Error('Amount exceeds the product total.');
  }

  const stripe = await verifiedStripe();
  const customerId = await softwareCustomer(user.id, true);
  if (!customerId) throw new Error('Unable to create software billing customer.');

  const purchaseId =
    typeof input.purchaseId === 'string' && /^[0-9a-f-]{36}$/i.test(input.purchaseId)
      ? input.purchaseId
      : randomUUID();

  await query(
    `insert into software_storefront_purchases(
       id,user_id,item_kind,item_id,item_name,customer_email,
       amount_paid_cents,total_price_cents,currency,status,inquiry_status
     ) values($1,$2,$3,$4,$5,$6,0,$7,'usd','pending','inquiry')
     on conflict(id) do update set
       customer_email=excluded.customer_email
     where software_storefront_purchases.user_id=excluded.user_id
       and software_storefront_purchases.status in ('pending','partially_paid','failed')
       and software_storefront_purchases.amount_paid_cents=0`,
    [
      purchaseId,
      user.id,
      item.kind,
      item.id,
      item.name,
      user.email,
      agreedPriceCents,
    ],
  );

  const meta: Record<string, string> = {
    app: SOFTWARE_APP,
    billing_scope: 'software',
    user_id: user.id,
    purchase_id: purchaseId,
    item_id: item.id,
    item_kind: item.kind,
    amount_cents: String(amountCents),
    total_price_cents: String(agreedPriceCents),
  };

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem =
    item.stripePriceId && amountCents === agreedPriceCents
      ? { price: item.stripePriceId, quantity: 1 }
      : {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: item.name,
              metadata: {
                billing_scope: 'software',
                item_id: item.id,
                item_kind: item.kind,
              },
            },
          },
        };

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment',
    line_items: [lineItem],
    success_url: absoluteOnApex(
      `/software/checkout/complete?session_id={CHECKOUT_SESSION_ID}&purchase_id=${purchaseId}`,
    ),
    cancel_url: absoluteOnApex(
      `/software/checkout?kind=${encodeURIComponent(item.kind)}&id=${encodeURIComponent(item.id)}&cancelled=1`,
    ),
    client_reference_id: user.id,
    metadata: meta,
    payment_intent_data: {
      metadata: meta,
      setup_future_usage: 'off_session',
    },
    payment_method_types: ['card'],
    billing_address_collection: 'auto',
  });

  if (!session.url) throw new Error('Checkout session missing redirect URL.');
  return { url: session.url, sessionId: session.id, purchaseId };
}
