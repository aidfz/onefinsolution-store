'use client';

import { useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import {
  confirmWorkspaceCreditWithSavedMethod,
  createWorkspaceCreditPaymentIntent,
  startWorkspaceHostedCheckout,
  workspaceCreditPurchaseStatus,
} from '@/app/workspace-actions';
import { publicSitePath } from '@/lib/site-url';
import {
  WORKSPACE_CREDIT_AMOUNT_PRESETS_USD,
  WORKSPACE_CREDIT_DEFAULT_AMOUNT_CENTS,
  WORKSPACE_CREDIT_MAX_AMOUNT_CENTS,
  WORKSPACE_CREDIT_MIN_AMOUNT_CENTS,
  WORKSPACE_CREDITS_PER_USD,
  creditsFromAmountCents,
  formatWorkspaceCreditUsd,
} from '@/lib/workspace-credit-limits';

type SavedMethod = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

function CreditPaymentForm({
  purchaseId,
  clientSecret,
  amountLabel,
  credits,
  savedMethods,
}: {
  purchaseId: string;
  clientSecret: string;
  amountLabel: string;
  credits: number;
  savedMethods: SavedMethod[];
}) {
  const stripe = useStripe();
  const elements = useElements();
  const defaultId = savedMethods.find((m) => m.isDefault)?.id || savedMethods[0]?.id || '';
  const [mode, setMode] = useState<'saved' | 'new'>(savedMethods.length ? 'saved' : 'new');
  const [selectedId, setSelectedId] = useState(defaultId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const successUrl = publicSitePath(
    `/workspace?purchase=${encodeURIComponent(purchaseId)}&billing=success`,
  );
  const failedUrl = '/workspace?billing=failed';
  const cancelledUrl = '/workspace?billing=cancelled';

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe) return;
    setBusy(true);
    setError('');
    try {
      const existing = await stripe.retrievePaymentIntent(clientSecret);
      if (existing.paymentIntent?.status === 'succeeded') {
        await workspaceCreditPurchaseStatus(purchaseId);
        location.assign(successUrl);
        return;
      }

      if (mode === 'saved' && selectedId) {
        const confirmed = await confirmWorkspaceCreditWithSavedMethod(purchaseId, selectedId);
        if (confirmed.error === 'additional_action_required' && confirmed.clientSecret) {
          const next = await stripe.handleNextAction({ clientSecret: confirmed.clientSecret });
          if (next.error) throw new Error(next.error.message || 'Authentication failed.');
        } else if (confirmed.error) {
          throw new Error(confirmed.error);
        }
        await workspaceCreditPurchaseStatus(purchaseId);
        location.assign(successUrl);
        return;
      }

      if (!elements) throw new Error('Payment form is still loading.');
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: successUrl },
        redirect: 'if_required',
      });
      if (result.error) {
        setError(result.error.message || 'Payment failed.');
        return;
      }
      if (result.paymentIntent?.status === 'succeeded') {
        await workspaceCreditPurchaseStatus(purchaseId);
        location.assign(successUrl);
        return;
      }
      location.assign(failedUrl);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to complete payment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void onSubmit(e)}>
      <p>
        Pay <strong>{amountLabel}</strong> for <strong>{credits.toLocaleString()} credits</strong>.
        This is the real charge — no temporary hold. After success the card stays on your Workspace
        billing account only.
      </p>
      {savedMethods.length > 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={mode === 'saved' ? 'button' : 'button secondary'}
              disabled={busy}
              onClick={() => setMode('saved')}
            >
              Use a saved card
            </button>
            <button
              type="button"
              className={mode === 'new' ? 'button' : 'button secondary'}
              disabled={busy}
              onClick={() => setMode('new')}
            >
              Use a new card
            </button>
          </div>
          {mode === 'saved' ? (
            <label className="stack" style={{ gap: 6 }}>
              <span>Workspace payment method</span>
              <select
                value={selectedId || defaultId}
                disabled={busy}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {savedMethods.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.brand.toUpperCase()} ···· {card.last4}
                    {` · exp ${String(card.expMonth).padStart(2, '0')}/${card.expYear}`}
                    {card.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      {mode === 'new' || savedMethods.length === 0 ? <PaymentElement /> : null}
      {error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : null}
      <button className="button" disabled={!stripe || busy} type="submit">
        {busy ? 'Processing…' : `Pay ${amountLabel}`}
      </button>
      <p>
        <a className="text-link" href={cancelledUrl}>
          Cancel and return to Workspace
        </a>
      </p>
    </form>
  );
}

/**
 * Workspace credits purchase UI.
 * Pay-first only — no SetupIntent / separate save-card step and no $1/$2 auth hold.
 * Card is saved on the Workspace Stripe Customer after a successful real payment
 * via PaymentIntent/Checkout Session setup_future_usage.
 */
export function WorkspaceCreditCheckout({
  mode,
  purchaseId,
  publishableKey,
  returnPath = '/workspace',
}: {
  mode: 'credits' | 'card';
  purchaseId?: string;
  publishableKey: string;
  returnPath?: string;
}) {
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );
  const cancelledUrl = returnPath;

  const [busy, setBusy] = useState(false);
  const [hostedBusy, setHostedBusy] = useState(false);
  const [error, setError] = useState('');
  const [amountUsd, setAmountUsd] = useState(String(WORKSPACE_CREDIT_DEFAULT_AMOUNT_CENTS / 100));
  const [payment, setPayment] = useState<{
    clientSecret: string;
    purchaseId: string;
    amountCents: number;
    credits: number;
    amountLabel: string;
    savedMethods: SavedMethod[];
  } | null>(null);

  const parsedAmountCents = (() => {
    const n = Number(amountUsd);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  })();
  const previewCredits =
    parsedAmountCents != null &&
    parsedAmountCents >= WORKSPACE_CREDIT_MIN_AMOUNT_CENTS &&
    parsedAmountCents <= WORKSPACE_CREDIT_MAX_AMOUNT_CENTS
      ? creditsFromAmountCents(parsedAmountCents)
      : null;

  async function startHostedCredits() {
    setHostedBusy(true);
    setError('');
    try {
      const result = await startWorkspaceHostedCheckout(amountUsd);
      if ('error' in result && result.error) throw new Error(result.error);
      if (!('url' in result) || !result.url) throw new Error('Unable to start secure checkout.');
      window.location.assign(result.url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to start secure checkout.');
      setHostedBusy(false);
    }
  }

  async function startCredits() {
    setBusy(true);
    setError('');
    try {
      const result = await createWorkspaceCreditPaymentIntent(purchaseId || null, amountUsd);
      if ('error' in result && result.error) throw new Error(result.error);
      if (!('clientSecret' in result) || !result.clientSecret) {
        throw new Error('Unable to start checkout.');
      }
      const amountCents =
        'amountCents' in result && typeof result.amountCents === 'number'
          ? result.amountCents
          : WORKSPACE_CREDIT_DEFAULT_AMOUNT_CENTS;
      const credits =
        'credits' in result && typeof result.credits === 'number'
          ? result.credits
          : creditsFromAmountCents(amountCents);
      const amountLabel =
        'amountLabel' in result && typeof result.amountLabel === 'string'
          ? result.amountLabel
          : formatWorkspaceCreditUsd(amountCents);
      const savedMethods =
        'savedMethods' in result && Array.isArray(result.savedMethods)
          ? (result.savedMethods as SavedMethod[])
          : [];
      setPayment({
        purchaseId:
          'purchaseId' in result && typeof result.purchaseId === 'string' && result.purchaseId
            ? result.purchaseId
            : purchaseId || '',
        clientSecret: result.clientSecret,
        amountCents,
        credits,
        amountLabel,
        savedMethods,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to start credit checkout.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'card') {
    return (
      <div className="stack">
        <p className="muted" style={{ lineHeight: 1.5 }}>
          Cards are saved only after a successful credit purchase. There is no separate save-card step
          and no temporary authorization charge.
        </p>
        <p>
          <a className="button" href="/checkout/credits">
            Buy credits to add a payment method
          </a>
        </p>
        <p>
          <a className="text-link" href={cancelledUrl}>
            Cancel and return to Workspace
          </a>
        </p>
      </div>
    );
  }

  if (payment && stripePromise) {
    return (
      <div className="stack">
        <Elements stripe={stripePromise} options={{ clientSecret: payment.clientSecret }}>
          <CreditPaymentForm
            purchaseId={payment.purchaseId}
            clientSecret={payment.clientSecret}
            amountLabel={payment.amountLabel}
            credits={payment.credits}
            savedMethods={payment.savedMethods}
          />
        </Elements>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="stack" style={{ gap: 12 }}>
        <div>
          <label className="stack" style={{ gap: 6 }}>
            <span>Amount (USD)</span>
            <input
              type="number"
              min={WORKSPACE_CREDIT_MIN_AMOUNT_CENTS / 100}
              max={WORKSPACE_CREDIT_MAX_AMOUNT_CENTS / 100}
              step="1"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              disabled={busy || hostedBusy}
            />
          </label>
          <p className="muted" style={{ fontSize: 13 }}>
            ${WORKSPACE_CREDIT_MIN_AMOUNT_CENTS / 100}–${WORKSPACE_CREDIT_MAX_AMOUNT_CENTS / 100}.{' '}
            {WORKSPACE_CREDITS_PER_USD} credits per $1.
            {previewCredits != null
              ? ` ≈ ${previewCredits.toLocaleString()} credits.`
              : ''}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {WORKSPACE_CREDIT_AMOUNT_PRESETS_USD.map((preset) => (
              <button
                key={preset}
                type="button"
                className="button secondary"
                disabled={busy || hostedBusy}
                onClick={() => setAmountUsd(String(preset))}
              >
                ${preset}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : null}

      <p className="muted" style={{ lineHeight: 1.5 }}>
        Pay the credit amount directly. No temporary $1/$2 hold. After a successful payment, that card
        is kept on your Workspace billing account for optional auto top-up.
      </p>
      <button
        className="button"
        type="button"
        disabled={hostedBusy || busy || previewCredits == null}
        onClick={() => void startHostedCredits()}
      >
        {hostedBusy
          ? 'Redirecting…'
          : previewCredits != null
            ? `Pay securely · ${formatWorkspaceCreditUsd(parsedAmountCents!)} / ${previewCredits.toLocaleString()} credits`
            : 'Enter a valid amount'}
      </button>
      <button
        className="button secondary"
        type="button"
        disabled={busy || hostedBusy || previewCredits == null}
        onClick={() => void startCredits()}
      >
        {busy ? 'Preparing…' : 'Pay on this page'}
      </button>
      <p>
        <a className="text-link" href={cancelledUrl}>
          Cancel and return to Workspace
        </a>
      </p>
    </div>
  );
}
