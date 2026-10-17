'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  listPaymentMethods,
  removePaymentMethod,
  setDefaultPaymentMethod,
} from '@/app/payment-method-actions';

type Method = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
};

/**
 * Subscription billing methods — list / default / remove only.
 * Adding a card is done by completing a real subscription checkout (no SetupIntent).
 */
export function PaymentMethodsPanel() {
  const [methods, setMethods] = useState<Method[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listPaymentMethods();
      if (result.error) {
        setError(result.error);
        setMethods([]);
        return;
      }
      setMethods((result.methods || []) as Method[]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load cards.');
      setMethods([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onDefault(id: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await setDefaultPaymentMethod(id);
      if (result.error) throw new Error(result.error);
      setNotice('Default subscription card updated.');
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to update default card.');
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    if (!window.confirm('Remove this card from your subscription account?')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await removePaymentMethod(id);
      if (result.error) throw new Error(result.error);
      setNotice('Card removed from your subscription account.');
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to remove card.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h3>Subscription payment methods</h3>
      <p className="muted text-sm" style={{ lineHeight: 1.5 }}>
        Cards are added when you complete a real subscription payment — there is no separate card-setup
        step. Manage defaults and removals below.
      </p>
      {loading ? <p className="muted">Loading…</p> : null}
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="notice success">{notice}</p> : null}
      {!loading && methods.length === 0 ? (
        <p className="muted">No subscription cards on file yet.</p>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: 10 }}>
          {methods.map((m) => (
            <li
              key={m.id}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>
                {(m.brand || 'card').toUpperCase()} ···· {m.last4}
                {m.expMonth && m.expYear
                  ? ` · exp ${String(m.expMonth).padStart(2, '0')}/${m.expYear}`
                  : ''}
                {m.isDefault ? ' · default' : ''}
              </span>
              <span style={{ display: 'flex', gap: 8 }}>
                {!m.isDefault ? (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void onDefault(m.id)}
                  >
                    Make default
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void onRemove(m.id)}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link className="button" href="/pricing">
          Pay for a plan (adds or updates card)
        </Link>
      </p>
    </div>
  );
}
