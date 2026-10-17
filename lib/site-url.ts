export function siteUrl(): string {
  const value = process.env.NEXT_PUBLIC_SITE_URL;
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NEXT_PUBLIC_SITE_URL is required in production');
    }
    return 'http://localhost:3000';
  }
  return value.replace(/\/$/, '');
}

/** Canonical public origin (no trailing slash). Prefer NEXT_PUBLIC_SITE_URL. */
export function publicSiteUrl(): string {
  return siteUrl();
}

/**
 * Absolute URL on the public site origin.
 * Accepts paths with or without a leading slash.
 */
export function publicSitePath(path = '/'): string {
  const base = publicSiteUrl();
  if (!path || path === '/') return `${base}/`;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

/**
 * Absolute URL helper (same as publicSitePath).
 * Kept for callers that historically used sitePath.
 */
export function sitePath(path = '/'): string {
  return publicSitePath(path);
}

/**
 * Brand domain used for Stripe-hosted Checkout / Customer Portal return URLs.
 * Falls back to the public site origin when unset.
 */
/**
 * Stripe Dashboard custom domain for hosted Checkout (pay.onefinsolution.store).
 * Stripe serves session.url on this host automatically once verified — our app
 * does not bind routes here. success/cancel still use siteUrl() (apex).
 */
export function stripeCheckoutDomain(): string {
  const raw =
    process.env.STRIPE_CHECKOUT_DOMAIN?.trim() ||
    process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_DOMAIN?.trim() ||
    'pay.onefinsolution.store';
  return raw.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
}

/** Alias used by payment architecture docs. */
export function stripeHostedPayDomain(): string {
  return stripeCheckoutDomain();
}

export function stripeHostedPayOrigin(): string {
  const domain = stripeCheckoutDomain();
  if (domain.startsWith('localhost') || domain.startsWith('127.0.0.1')) {
    return `http://${domain}`;
  }
  return `https://${domain}`;
}

export function stripeHostedPayPath(path = '/'): string {
  const base = stripeHostedPayOrigin();
  if (!path || path === '/') return `${base}/`;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}
