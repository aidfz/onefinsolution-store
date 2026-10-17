'use client';

import { useMemo, useState, useTransition } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import {
  createSoftwarePaymentIntent,
  confirmSoftwarePaymentWithSavedMethod,
  startSoftwareHostedCheckout,
} from '@/app/software/checkout/actions';

type SavedMethod = { id: string; brand: string; last4: string; isDefault?: boolean };

function PaymentForm({
  purchaseId,
  clientSecret,
  savedMethods,
}: {
  purchaseId: string;
  clientSecret: string;
  savedMethods: SavedMethod[];
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'new' | 'saved'>(savedMethods.length ? 'saved' : 'new');
  const defaultId = savedMethods.find((m) => m.isDefault)?.id || savedMethods[0]?.id || '';
  const [selectedId, setSelectedId] = useState(defaultId);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'saved' && selectedId) {
        const result = await confirmSoftwarePaymentWithSavedMethod({
          purchaseId,
          paymentMethodId: selectedId,
        });
        if (result.error) {
          setError(result.error);
          setBusy(false);
          return;
        }
        if (result.clientSecret && result.requiresAction) {
          const conf = await stripe.confirmCardPayment(result.clientSecret);
          if (conf.error) {
            setError(conf.error.message || 'Authentication failed.');
            setBusy(false);
            return;
          }
        }
        window.location.assign(`/software/checkout/complete?purchase_id=${encodeURIComponent(purchaseId)}`);
        return;
      }

      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/software/checkout/complete?purchase_id=${encodeURIComponent(purchaseId)}`,
        },
        redirect: 'if_required',
      });
      if (result.error) {
        setError(result.error.message || 'Payment failed.');
        setBusy(false);
        return;
      }
      window.location.assign(`/software/checkout/complete?purchase_id=${encodeURIComponent(purchaseId)}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Payment failed.');
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      {savedMethods.length > 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          <label>
            <input
              type="radio"
              name="sw-pay-mode"
              checked={mode === 'saved'}
              onChange={() => setMode('saved')}
              disabled={busy}
            />{' '}
            Use a saved Software card
          </label>
          {mode === 'saved' ? (
            <select
              value={selectedId || defaultId}
              disabled={busy}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {savedMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {(m.brand || 'card').toUpperCase()} ···· {m.last4}
                  {m.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          ) : null}
          <label>
            <input
              type="radio"
              name="sw-pay-mode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
              disabled={busy}
            />{' '}
            Pay with a new card
          </label>
        </div>
      ) : null}
      {mode === 'new' ? <PaymentElement options={{ layout: 'tabs' }} /> : null}
      {error ? (
        <p className="software-checkout-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy || !stripe}>
        {busy ? 'Confirming payment…' : 'Pay now'}
      </button>
      <small>This is the real charge. After it succeeds, the card is kept on your Software account only.</small>
    </form>
  );
}

export function CheckoutForm({
  kind,
  id,
  fullPrice,
  publishableKey,
}: {
  kind: 'template' | 'software';
  id: string;
  fullPrice: number;
  publishableKey: string;
}) {
  const [amount, setAmount] = useState(fullPrice.toFixed(2));
  const [error, setError] = useState('');
  const [payment, setPayment] = useState<{
    clientSecret: string;
    purchaseId: string;
    savedMethods: SavedMethod[];
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isHostedPending, startHostedTransition] = useTransition();
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : Promise.resolve(null)),
    [publishableKey],
  );

  function startOnPageCheckout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const purchaseId = crypto.randomUUID();
    startTransition(async () => {
      // Real charge only; card is saved via setup_future_usage after success.
      const result = await createSoftwarePaymentIntent({
        kind,
        id,
        amount,
        purchaseId,
        savePaymentMethod: true,
      });
      if (result.clientSecret) {
        setPayment({
          clientSecret: result.clientSecret,
          purchaseId,
          savedMethods: Array.isArray(
            (result as { savedMethods?: SavedMethod[] }).savedMethods,
          )
            ? ((result as { savedMethods: SavedMethod[] }).savedMethods || [])
            : [],
        });
        return;
      }
      setError(result.error || 'Unable to prepare secure checkout. Please try again.');
    });
  }

  function startHosted() {
    setError('');
    startHostedTransition(async () => {
      try {
        const cents = Math.round(Number.parseFloat(amount || '0') * 100);
        if (!Number.isFinite(cents) || cents < 500) {
          setError('Enter a valid amount (minimum $5.00).');
          return;
        }
        const result = await startSoftwareHostedCheckout(kind, id, cents);
        if (result.error || !('url' in result) || !result.url) {
          setError(result.error || 'Unable to start secure checkout.');
          return;
        }
        window.location.assign(result.url);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Unable to start secure checkout.');
      }
    });
  }

  if (payment && stripePromise) {
    return (
      <div className="stack">
        <Elements
          stripe={stripePromise}
          options={{ clientSecret: payment.clientSecret, appearance: { theme: 'stripe' } }}
        >
          <PaymentForm
            purchaseId={payment.purchaseId}
            clientSecret={payment.clientSecret}
            savedMethods={payment.savedMethods}
          />
        </Elements>
      </div>
    );
  }

  return (
    <form className="stack software-checkout-form" onSubmit={startOnPageCheckout}>
      <label>
        Amount to pay now (USD)
        <input
          type="number"
          min={5}
          max={fullPrice}
          step="0.01"
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-describedby="software-payment-hint"
        />
      </label>
      <p id="software-payment-hint">
        Minimum $5.00. Full listed price: ${fullPrice.toFixed(2)} USD. No separate card-save step and no
        temporary authorization charge. You pay this amount; after success that card is kept on your
        Software account for future Software payments only.
      </p>
      {error ? (
        <p className="software-checkout-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" disabled={isPending || isHostedPending} onClick={() => void startHosted()}>
        {isHostedPending ? 'Redirecting…' : 'Pay securely'}
      </button>
      <button type="submit" className="software-checkout-cancel" disabled={isPending || isHostedPending}>
        {isPending ? 'Preparing secure payment…' : 'Pay on this page'}
      </button>
      <small>
        Preferred path is Stripe-hosted checkout. Both paths charge the real amount only and save the card after
        success.
      </small>
    </form>
  );
}
