'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

/**
 * Subscription billing actions — no SetupIntent / card-setup form.
 * Optional publishableKey / email kept for backward-compatible call sites.
 */
export function BillingCard(_props?: {
  publishableKey?: string;
  email?: string;
  hasOutstanding?: boolean;
}) {
  const [notice] = useState('');
  const [, startTransition] = useTransition();

  return (
    <section className="panel stack">
      <h3>Billing actions</h3>
      <p className="muted text-sm" style={{ lineHeight: 1.5 }}>
        Subscribe or change plans with a direct payment. There is no separate card-setup step before
        checkout. Cards used on a successful subscription payment are saved for renewals.
      </p>
      {notice ? <p className="notice success">{notice}</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Link className="button" href="/pricing">
          View plans / subscribe
        </Link>
        <Link className="button secondary" href="/dashboard/billing">
          Open billing
        </Link>
      </div>
    </section>
  );
}
