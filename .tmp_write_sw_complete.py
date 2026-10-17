from pathlib import Path

content = r'''import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type Stripe from 'stripe';
import { currentUser } from '@/lib/session';
import { query } from '@/lib/db';
import { verifiedStripe } from '@/lib/stripe';
import { fulfillSoftwareStorefrontPayment } from '@/lib/software-storefront-fulfillment';
import { stripeObjectMatchesMode } from '@/lib/billing-environment';
import styles from '../checkout.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Software payment status',
  description: 'Check the status of your software inquiry payment.',
};

type PurchaseRow = {
  stripe_payment_intent_id: string | null;
  item_name: string;
  amount_paid_cents: number;
  currency: string;
  status: 'pending' | 'partially_paid' | 'paid' | 'failed';
  total_price_cents: number;
  inquiry_status: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstString(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
}

async function loadPurchase(purchaseId: string, userId: string): Promise<PurchaseRow | null> {
  const [record] = await query<PurchaseRow>(
    `select stripe_payment_intent_id,item_name,amount_paid_cents,total_price_cents,currency,status,inquiry_status
     from software_storefront_purchases where id=$1 and user_id=$2`,
    [purchaseId, userId],
  );
  return record ?? null;
}

async function fulfillSucceededPaymentIntent(
  stripe: Stripe,
  intent: Stripe.PaymentIntent,
): Promise<void> {
  if (intent.status !== 'succeeded' && intent.status !== 'canceled') return;
  await fulfillSoftwareStorefrontPayment(stripe, {
    id: `software-purchase-return:${intent.id}`,
    type: intent.status === 'succeeded' ? 'payment_intent.succeeded' : 'payment_intent.canceled',
    livemode: intent.livemode,
    data: { object: intent },
  } as unknown as Stripe.Event);
}

export default async function SoftwareCheckoutCompletePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  const sessionId = firstString(params.session_id);
  let purchaseId = firstString(params.purchase_id);
  const paymentIntentParam = firstString(params.payment_intent);

  const nextQuery = new URLSearchParams();
  if (purchaseId) nextQuery.set('purchase_id', purchaseId);
  if (sessionId) nextQuery.set('session_id', sessionId);
  if (paymentIntentParam) nextQuery.set('payment_intent', paymentIntentParam);
  const nextPath = `/software/checkout/complete${nextQuery.toString() ? `?${nextQuery}` : ''}`;

  if (!user) redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);

  let confirmationIssue = false;
  const stripe = await verifiedStripe();

  // Hosted Checkout return: ?session_id=cs_...
  if (sessionId) {
    if (!sessionId.startsWith('cs_')) notFound();
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent'],
      });
    } catch (error) {
      console.error('Unable to retrieve Checkout Session on software return', error);
      notFound();
    }

    if (!stripeObjectMatchesMode(session.livemode)) notFound();

    const metaUser =
      (typeof session.metadata?.user_id === 'string' && session.metadata.user_id) ||
      (typeof session.client_reference_id === 'string' && session.client_reference_id) ||
      '';
    if (!metaUser || metaUser !== user.id) notFound();

    const metaPurchase =
      (typeof session.metadata?.purchase_id === 'string' && session.metadata.purchase_id) || '';
    if (metaPurchase) {
      if (purchaseId && purchaseId !== metaPurchase) notFound();
      purchaseId = metaPurchase;
    }

    if (!purchaseId || !UUID_RE.test(purchaseId)) notFound();

    const expandedPi = session.payment_intent;
    let intent: Stripe.PaymentIntent | null = null;
    if (
      expandedPi &&
      typeof expandedPi === 'object' &&
      'object' in expandedPi &&
      expandedPi.object === 'payment_intent'
    ) {
      intent = expandedPi as Stripe.PaymentIntent;
    } else {
      const piId = stripeId(expandedPi);
      if (piId) {
        try {
          intent = await stripe.paymentIntents.retrieve(piId);
        } catch (error) {
          console.error('Unable to retrieve PaymentIntent from Checkout Session', error);
          confirmationIssue = true;
        }
      }
    }

    if (intent) {
      if (
        intent.metadata?.app !== 'onefin-software-store' ||
        intent.metadata?.billing_scope !== 'software' ||
        intent.metadata?.user_id !== user.id ||
        (intent.metadata?.purchase_id && intent.metadata.purchase_id !== purchaseId) ||
        !stripeObjectMatchesMode(intent.livemode)
      ) {
        notFound();
      }
      if (intent.status === 'succeeded' || intent.status === 'canceled') {
        try {
          await fulfillSucceededPaymentIntent(stripe, intent);
        } catch (error) {
          console.error('Unable to fulfill software purchase from Checkout Session return', error);
          confirmationIssue = true;
        }
      }
    }
  } else if (paymentIntentParam) {
    // Explicit payment_intent query (Elements / legacy return).
    if (!paymentIntentParam.startsWith('pi_')) notFound();
    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentParam);
      if (
        intent.metadata?.app !== 'onefin-software-store' ||
        intent.metadata?.billing_scope !== 'software' ||
        intent.metadata?.user_id !== user.id ||
        !stripeObjectMatchesMode(intent.livemode)
      ) {
        notFound();
      }
      if (intent.metadata?.purchase_id) {
        if (purchaseId && purchaseId !== intent.metadata.purchase_id) notFound();
        purchaseId = intent.metadata.purchase_id;
      }
      if (intent.status === 'succeeded' || intent.status === 'canceled') {
        try {
          await fulfillSucceededPaymentIntent(stripe, intent);
        } catch (error) {
          console.error('Unable to fulfill software purchase from payment_intent return', error);
          confirmationIssue = true;
        }
      }
    } catch (error) {
      console.error('Unable to retrieve payment_intent on software return', error);
      confirmationIssue = true;
    }
  }

  if (!purchaseId || !UUID_RE.test(purchaseId)) notFound();

  let purchase = await loadPurchase(purchaseId, user.id);
  if (!purchase) notFound();

  // Existing payment_intent path: confirm pending purchase via stored PI id.
  if (!sessionId && !paymentIntentParam && purchase.stripe_payment_intent_id && purchase.status === 'pending') {
    try {
      const intent = await stripe.paymentIntents.retrieve(purchase.stripe_payment_intent_id);
      if (
        intent.metadata?.app !== 'onefin-software-store' ||
        intent.metadata?.billing_scope !== 'software' ||
        intent.metadata?.user_id !== user.id ||
        intent.metadata?.purchase_id !== purchaseId ||
        !stripeObjectMatchesMode(intent.livemode)
      ) {
        notFound();
      }
      if (intent.status === 'succeeded' || intent.status === 'canceled') {
        try {
          await fulfillSucceededPaymentIntent(stripe, intent);
        } catch (error) {
          console.error('Unable to fulfill Software storefront payment on return', error);
          confirmationIssue = true;
        }
      }
    } catch (error) {
      console.error('Unable to retrieve stored PaymentIntent on software ret
