import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { query } from '@/lib/db';
import type Stripe from 'stripe';
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

async function fulfillFromPaymentIntent(stripe: Stripe, intent: Stripe.PaymentIntent): Promise<void> {
  if (intent.status !== 'succeeded' && intent.status !== 'canceled') return;
  await fulfillSoftwareStorefrontPayment(stripe, {
    id: 'software-purchase-return:' + intent.id,
    type: intent.status === 'succeeded' ? 'payment_intent.succeeded' : 'payment_intent.canceled',
    livemode: intent.livemode,
    data: { object: intent },
  } as unknown as Stripe.Event);
}

function assertSoftwareIntentOwnership(
  intent: Stripe.PaymentIntent,
  userId: string,
  purchaseId?: string,
): void {
  if (
    intent.metadata?.app !== 'onefin-software-store' ||
    intent.metadata?.billing_scope !== 'software' ||
    intent.metadata?.user_id !== userId ||
    (purchaseId && intent.metadata?.purchase_id && intent.metadata.purchase_id !== purchaseId) ||
    !stripeObjectMatchesMode(intent.livemode)
  ) {
    notFound();
  }
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
  const q = nextQuery.toString();
  const nextPath = '/software/checkout/complete' + (q ? '?' + q : '');

  if (!user) redirect('/sign-in?next=' + encodeURIComponent(nextPath));

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
      assertSoftwareIntentOwnership(intent, user.id, purchaseId);
      try {
        await fulfillFromPaymentIntent(stripe, intent);
      } catch (error) {
        console.error('Unable to fulfill software purchase from Checkout Session return', error);
        confirmationIssue = true;
      }
    }
  } else if (paymentIntentParam) {
    // Explicit payment_intent query (Elements / legacy return).
    if (!paymentIntentParam.startsWith('pi_')) notFound();
    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentParam);
      assertSoftwareIntentOwnership(intent, user.id, purchaseId || undefined);
      if (intent.metadata?.purchase_id) {
        if (purchaseId && purchaseId !== intent.metadata.purchase_id) notFound();
        purchaseId = intent.metadata.purchase_id;
      }
      try {
        await fulfillFromPaymentIntent(stripe, intent);
      } catch (error) {
        console.error('Unable to fulfill software purchase from payment_intent return', error);
        confirmationIssue = true;
      }
    } catch (error) {
      console.error('Unable to retrieve payment_intent on software return', error);
      confirmationIssue = true;
    }
  }

  if (!purchaseId || !UUID_RE.test(purchaseId)) notFound();

  let purchase = await loadPurchase(purchaseId, user.id);
  if (!purchase) notFound();

  // Existing path: confirm pending purchase via stored PaymentIntent id.
  if (!sessionId && !paymentIntentParam && purchase.stripe_payment_intent_id && purchase.status === 'pending') {
    try {
      const intent = await stripe.paymentIntents.retrieve(purchase.stripe_payment_intent_id);
      assertSoftwareIntentOwnership(intent, user.id, purchaseId);
      if (intent.status === 'succeeded' || intent.status === 'canceled') {
        try {
          await fulfillFromPaymentIntent(stripe, intent);
        } catch (error) {
          console.error('Unable to fulfill Software payment return:', error);
          confirmationIssue = true;
        }
      }
    } catch (error) {
      console.error('Unable to retrieve stored PaymentIntent on software return', error);
      confirmationIssue = true;
    }
  }

  // Refresh after any fulfill path.
  purchase = (await loadPurchase(purchaseId, user.id)) ?? purchase;

  const paidAmount = Math.max(0, purchase.amount_paid_cents || 0);
  const agreedTotal = Math.max(0, purchase.total_price_cents || 0);
  const remainingBalance = Math.max(0, agreedTotal - paidAmount);
  const fullyPaid = purchase.status === 'paid' && remainingBalance === 0;
  const partiallyPaid =
    purchase.status === 'partially_paid' || (paidAmount > 0 && remainingBalance > 0 && purchase.status !== 'paid');
  const failed = purchase.status === 'failed';

  const money = (cents: number) => '$' + (cents / 100).toFixed(2);
  const currency = purchase.currency.toUpperCase();

  const title = fullyPaid
    ? 'Payment complete'
    : partiallyPaid
      ? 'Partial payment received'
      : failed
        ? 'Payment failed'
        : confirmationIssue
          ? 'Payment needs review'
          : 'Payment pending';

  const eyebrow = fullyPaid
    ? 'Software storefront'
    : partiallyPaid
      ? 'Deposit applied'
      : failed
        ? 'No charge applied'
        : 'Awaiting confirmation';

  const intro = fullyPaid
    ? 'Full payment of ' + money(paidAmount) + ' ' + currency + ' was applied to ' + purchase.item_name + '. Remaining balance is $0.00.'
    : partiallyPaid
      ? 'A payment of ' + money(paidAmount) + ' ' + currency + ' was applied to ' + purchase.item_name + '. Remaining balance: ' + money(remainingBalance) + '. This deposit is not full payment.'
      : failed
        ? 'The payment for ' + purchase.item_name + ' did not complete. No successful payment was applied to the balance.'
        : confirmationIssue
          ? 'Stripe returned a payment status for ' + purchase.item_name + ', but we could not finish processing. Please contact support with reference ' + purchaseId + '.'
          : 'The payment for ' + purchase.item_name + ' is still being confirmed. Only verified successful payments reduce the remaining balance.';

  return (
    <div className={styles.shell}>
      <section className={styles.card} aria-live="polite">
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1>{title}</h1>
        <p className={styles.intro}>{intro}</p>
        <div className={styles.summary}>
          <span>Software purchase</span>
          <strong>{purchase.item_name}</strong>
          <div>
            <span>Agreed total</span>
            <b>{money(agreedTotal) + ' USD'}</b>
          </div>
          <div>
            <span>Total paid</span>
            <b>{money(paidAmount) + ' USD'}</b>
          </div>
          <div>
            <span>Remaining</span>
            <b>{money(remainingBalance) + ' USD'}</b>
          </div>
          <div>
            <span>Payment status</span>
            <b>{purchase.status}</b>
          </div>
          <div>
            <span>Project status</span>
            <b>{purchase.inquiry_status || 'inquiry'}</b>
          </div>
        </div>
        <div className="button-row">
          <Link className={styles.back} href="/software/account">
            Open Software account
          </Link>
          <Link className={styles.back} href="/software">
            Return to software catalog
          </Link>
        </div>
      </section>
    </div>
  );
}
