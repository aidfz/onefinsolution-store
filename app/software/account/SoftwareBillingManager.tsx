'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  listSoftwarePaymentMethods,
  removeSoftwarePaymentMethod,
  setSoftwareDefaultPaymentMethod,
  updateSoftwareBillingProfile,
} from '../checkout/actions';
import type { SoftwareBillingProfile } from '@/lib/software-billing-profile';
import styles from './software-account.module.css';

type Card = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

function TextField({
  name,
  label,
  value,
  required = false,
}: {
  name: keyof SoftwareBillingProfile;
  label: string;
  value: string;
  required?: boolean;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input name={name} defaultValue={value} maxLength={160} required={required} />
    </label>
  );
}

/**
 * Software billing profile + cards list.
 * Cards are added only by completing a real software payment (full or partial) —
 * no SetupIntent / separate card-setup session.
 */
export function SoftwareBillingManager({
  profile,
  publishableKey: _publishableKey,
}: {
  profile: SoftwareBillingProfile;
  publishableKey: string;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingProfile, startProfileTransition] = useTransition();

  const refreshCards = useCallback(async () => {
    const result = await listSoftwarePaymentMethods();
    if ('error' in result) {
      setError(result.error || 'Unable to load Software payment methods.');
      setCards([]);
    } else {
      setError('');
      setCards(result.methods);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refreshCards();
  }, [refreshCards]);

  function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    const data = new FormData(event.currentTarget);
    startProfileTransition(async () => {
      const result = await updateSoftwareBillingProfile(data);
      if (result.error) setError(result.error);
      else setMessage(result.message || 'Software billing details saved.');
    });
  }

  async function updateCard(id: string, action: 'default' | 'remove') {
    setError('');
    setMessage('');
    if (action === 'remove') {
      if (!window.confirm('Remove this card from your Software account?')) return;
      const result = await removeSoftwarePaymentMethod(id);
      if (result.error) setError(result.error);
      else {
        setMessage('Card removed.');
        await refreshCards();
      }
      return;
    }
    const result = await setSoftwareDefaultPaymentMethod(id);
    if (result.error) setError(result.error);
    else {
      setMessage('Default Software card updated.');
      await refreshCards();
    }
  }

  return (
    <div className={styles.billing}>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className={styles.success}>{message}</p> : null}

      <form className={styles.profileForm} onSubmit={saveProfile}>
        <h2>Software billing details</h2>
        <p className={styles.hint}>
          Used on Software invoices and receipts. Separate from subscription and Workspace billing.
        </p>
        <div className={styles.grid}>
          <TextField name="fullName" label="Full name" value={profile.fullName || ''} />
          <TextField name="company" label="Company" value={profile.company || ''} />
          <TextField name="phone" label="Phone" value={profile.phone || ''} />
          <TextField name="line1" label="Address line 1" value={profile.line1 || ''} />
          <TextField name="line2" label="Address line 2" value={profile.line2 || ''} />
          <TextField name="city" label="City" value={profile.city || ''} />
          <TextField name="state" label="State / province" value={profile.state || ''} />
          <TextField name="postalCode" label="Postal code" value={profile.postalCode || ''} />
          <TextField name="country" label="Country" value={profile.country || ''} />
        </div>
        <button type="submit" disabled={savingProfile}>
          {savingProfile ? 'Saving…' : 'Save Software billing details'}
        </button>
      </form>

      <section className={styles.cards}>
        <div className={styles.cardsHeading}>
          <div>
            <h2>Software payment methods</h2>
            <p>
              Cards are saved only after a successful software payment (full price or partial/installment).
              There is no separate card-setup step.
            </p>
          </div>
          <Link className={styles.primaryLink || undefined} href="/software">
            Pay for software
          </Link>
        </div>
        {loading ? (
          <p>Loading Software cards…</p>
        ) : cards.length === 0 ? (
          <p>No Software payment methods saved yet. Complete a payment to add one.</p>
        ) : (
          <ul>
            {cards.map((card) => (
              <li key={card.id}>
                <span>
                  <strong>
                    {card.brand} ···· {card.last4}
                  </strong>
                  <small>
                    Expires {String(card.expMonth).padStart(2, '0')}/{card.expYear}
                    {card.isDefault ? ' · Default' : ''}
                  </small>
                </span>
                <span className={styles.cardActions}>
                  {!card.isDefault && (
                    <button type="button" onClick={() => void updateCard(card.id, 'default')}>
                      Make default
                    </button>
                  )}
                  <button type="button" onClick={() => void updateCard(card.id, 'remove')}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
