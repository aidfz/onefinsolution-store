'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  listWorkspacePaymentMethods,
  removeWorkspacePaymentMethod,
} from '@/app/workspace-actions';

type Method = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

/**
 * Workspace cards — list / remove only.
 * Adding a card happens by buying credits (real payment), not SetupIntent.
 */
export function WorkspacePaymentMethodsPanel() {
  const router = useRouter();
  const [methods, setMethods] = useState<Method[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listWorkspacePaymentMethods();
      if (result.error) {
        setError(result.error);
        setMethods([]);
        return;
      }
      setMethods((result.methods || []) as Method[]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load Workspace cards.');
      setMethods([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onRemove(id: string) {
    if (!window.confirm('Remove this card from your Workspace account?')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await removeWorkspacePaymentMethod(id);
      if (result.error) throw new Error(result.error);
      setNotice(result.message || 'Card removed.');
      await refresh();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to remove card.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h3>Workspace payment methods</h3>
      <p className="muted text-sm" style={{ lineHeight: 1.5 }}>
        Add credits to save a card — there is no separate card-setup session. Cards saved after a
        successful credit purchase can be reused for auto top-up.
      </p>
      {loading ? <p className="muted">Loading…</p> : null}
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="notice success">{notice}</p> : null}
      {!loading && methods.length === 0 ? (
        <p className="muted">No Workspace cards on file yet.</p>
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
                {` · exp ${String(m.expMonth).padStart(2, '0')}/${m.expYear}`}
                {m.isDefault ? ' · default' : ''}
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void onRemove(m.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link className="button" href="/checkout/credits">
          Add credits (saves card after payment)
        </Link>
      </p>
    </div>
  );
}
