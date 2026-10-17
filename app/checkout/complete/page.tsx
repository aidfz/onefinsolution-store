import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { verifiedStripe } from '@/lib/stripe';
import { stripeObjectMatchesMode } from '@/lib/billing-environment';

export const metadata: Metadata = {
  title: 'Payment complete',
  description: 'Your secure payment result.',
};

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function CheckoutCompletePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/checkout/complete');

  const params = await searchParams;
  const sessionId = first(params.session_id);
  const scopeHint = first(params.scope);

  let title = 'Payment received';
  let body =
    'Thanks — if your payment succeeded, access updates within a few moments. You can safely close this page or continue below.';
  let primaryHref = '/dashboard';
  let primaryLabel = 'Open dashboard';
  let secondaryHref = '/pricing';
  let secondaryLabel = 'View plans';
  let statusLine: string | null = null;

  if (sessionId && sessionId.startsWith('cs_')) {
    try {
      const stripe = await verifiedStripe();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (!stripeObjectMatchesMode(session.livemode)) {
        redirect('/dashboard');
      }
      if (session.client_reference_id && session.client_reference_id !== user.id) {
        redirect('/dashboard');
      }

      const scope = session.metadata?.billing_scope || scopeHint || '';
      const paid =
        session.payment_status === 'paid' ||
        session.status === 'complete' ||
        (session.mode === 'subscription' &&
          (session.status === 'complete' || session.payment_status === 'no_payment_required'));

      if (scope === 'workspace') {
        primaryHref = '/workspace';
        primaryLabel = 'Open workspace';
        secondaryHref = '/checkout/credits';
        secondaryLabel = 'Buy more credits';
        title = paid ? 'Credits purchase complete' : 'Credits payment processing';
        body = paid
          ? 'Your workspace credits are being applied. Open the workspace to use your balance.'
          : 'We are confirming your payment. Credits appear as soon as the bank confirms the charge.';
      } else if (scope === 'subscription' || session.mode === 'subscription') {
        primaryHref = '/dashboard/billing';
        primaryLabel = 'Open billing';
        secondaryHref = '/pricing';
        secondaryLabel = 'View plans';
        title = paid ? 'Subscription checkout complete' : 'Subscription processing';
        body = paid
          ? 'Your plan is activating. Billing details and invoices appear on your account shortly.'
          : 'We are confirming your subscription. This usually finishes within a minute.';
      } else if (scope === 'software') {
        primaryHref = '/software/account';
        primaryLabel = 'Software account';
        secondaryHref = '/software';
        secondaryLabel = 'Back to software';
        title = paid ? 'Software payment complete' : 'Software payment processing';
        body = paid
          ? 'Your software payment was received. Track balance and downloads from your software account.'
          : 'We are confirming your software payment.';
      }

      statusLine =
        session.payment_status === 'paid'
          ? 'Status: paid'
          : session.payment_status === 'no_payment_required'
            ? 'Status: no charge required (trial or $0)'
            : session.payment_status
              ? `Status: ${session.payment_status}`
              : null;
    } catch {
      body =
        'We could not load this checkout session yet. If you were charged, your account will update from the payment confirmation email and webhooks shortly.';
    }
  }

  return (
    <div className="page-shell" style={{ maxWidth: 640, margin: '48px auto', padding: '0 16px' }}>
      <section className="panel" style={{ padding: 28 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>
          Secure checkout
        </p>
        <h1 style={{ marginTop: 0 }}>{title}</h1>
        <p style={{ lineHeight: 1.6 }}>{body}</p>
        {statusLine ? (
          <p style={{ color: 'var(--muted, #64748b)', fontSize: 14 }}>{statusLine}</p>
        ) : null}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 24 }}>
          <Link className="button" href={primaryHref}>
            {primaryLabel}
          </Link>
          <Link className="button-secondary" href={secondaryHref}>
            {secondaryLabel}
          </Link>
        </div>
        <p style={{ marginTop: 28, fontSize: 13, color: 'var(--muted, #64748b)' }}>
          Payments are processed by Stripe on the secure pay domain. This site never stores full card
          numbers.
        </p>
      </section>
    </div>
  );
}
