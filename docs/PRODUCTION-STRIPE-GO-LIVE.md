# Production Stripe go-live checklist

**Site:** https://onefinsolution.store  
**Webhook:** https://onefinsolution.store/api/stripe/webhook  
**Checkout custom domain (optional branding):** pay.onefinsolution.store  

This document contains **no secrets**. Live values were generated into gitignored files:

- `.env.stripe-live-generated` — Stripe live keys + catalog IDs  
- `.env.production.local` — merged production snapshot for Railway  

## Done in this setup pass

1. **Live webhook endpoint verified**
   - ID: `we_1URXoeQBwgSkmtZFW6uc3IPR`
   - URL: `https://onefinsolution.store/api/stripe/webhook`
   - Status: enabled
   - Events (13):  
     `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`,  
     `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`,  
     `checkout.session.completed`, `checkout.session.async_payment_succeeded`,  
     `customer.subscription.created`, `customer.subscription.updated`,  
     `customer.subscription.deleted`, `customer.subscription.trial_will_end`,  
     `charge.refunded`

2. **Live catalog provisioned** (account `acct_1UR9HQQBwgSkmtZF`)
   - Subscription product + daily/weekly/monthly/yearly prices  
   - Workspace credit packs: 50 / 100 / 250 / 500  
   - Software storefront: 54 products/prices  

3. **Credentials file deleted**
   - `stripe-sec-keys.txt` permanently removed from the workspace after import  

4. **Production app health**
   - `GET https://onefinsolution.store/api/health` → ok, `db: "ok"`  

## Blockers (must finish before real charges)

### A. Stripe account still cannot charge

Live account `acct_1UR9HQQBwgSkmtZF` currently reports:

- `charges_enabled: false`
- `payouts_enabled: false`
- `disabled_reason: null` (account still not activated for live charges)

**Action:** Open [Stripe Dashboard → Live mode](https://dashboard.stripe.com) and complete business verification / bank details until **Charges** and **Payouts** show enabled. Until then, live checkouts will fail even with correct API keys.

### B. Railway production env not updated from this machine

The Railway CLI user session is logged in as `onefinsolution`, but:

- `RAILWAY_TOKEN` in `.env.local` returns **Unauthorized** for project APIs  
- `railway link` to the production project IDs fails  

So live Stripe variables were **prepared locally** but **not pushed** to Railway.

**Action (pick one):**

1. **Dashboard (fastest):** Railway → production service → Variables → set/update the keys listed below from `.env.stripe-live-generated` / `.env.production.local`, then redeploy.  
2. **CLI:** Create a new Railway account token with access to the production project, put it in `.env.local` as `RAILWAY_TOKEN`, then run:

```bash
node scripts/configure-railway.mjs --apply
```

(or paste variables manually).

### C. Required Railway variables (live)

Set these on the **production** service (values live in gitignored env files):

| Key | Notes |
| --- | --- |
| `STRIPE_MODE` | `live` |
| `STRIPE_SECRET_KEY` | `sk_live_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from destination `we_1URXoeQBwgSkmtZFW6uc3IPR` |
| `STRIPE_EXPECTED_ACCOUNT_ID` | `acct_1UR9HQQBwgSkmtZF` |
| `NEXT_PUBLIC_SITE_URL` | `https://onefinsolution.store` |
| `STRIPE_CHECKOUT_DOMAIN` | `pay.onefinsolution.store` |
| `NEXT_PUBLIC_STRIPE_CHECKOUT_DOMAIN` | `pay.onefinsolution.store` |
| `STRIPE_PRICE_DAILY` / `_WEEKLY` / `_MONTHLY` / `_YEARLY` | live price IDs |
| `STRIPE_PRODUCT_SUBSCRIPTION` | live product ID |
| `STRIPE_PRODUCT_CREDITS` | live product ID |
| `STRIPE_PRICE_CREDITS_50` / `_100` / `_250` / `_500` | live price IDs |
| `STRIPE_CREDIT_PLANS` | JSON map `price_id → {credits, kind}` |
| `STRIPE_SOFTWARE_CATALOG` | JSON map `kind:code → {productId, priceId, priceUsd, …}` |
| `NODE_ENV` | `production` |
| `BILLING_PROVIDER` | `stripe` |
| `DATABASE_URL` | keep existing Railway Postgres (do not overwrite blindly) |
| Session / email / model secrets | keep existing production values |

After saving variables: **Redeploy** the service.

## Post-deploy verification

1. Stripe Dashboard → Developers → Webhooks → `onefinsolution-store` → confirm recent deliveries **2xx**.  
2. Send a **live mode** test payment with a real card (small amount) on:
   - Subscription checkout  
   - Credit pack purchase  
   - Software checkout  
3. Confirm webhook fulfillment wrote DB rows (subscription / credits / software purchase).  
4. Confirm no `pk_test_` / `sk_test_` remain in production env.  

## Security notes

- Never commit `.env.stripe-live-generated`, `.env.production.local`, or any `stripe-sec-keys*` file.  
- Rotate keys if the credentials text file was shared outside this machine.  
- Cloudflare sits in front of production; Stripe webhook IPs are allowlisted by Stripe’s own delivery (browser-like probes from random clients may get CF 403).  

## Architecture reminder

- One domain: `onefinsolution.store`  
- One webhook path: `/api/stripe/webhook`  
- Three payment modules, one shared Stripe account/client  
- `pay.onefinsolution.store` is Checkout domain branding only — **not** a second webhook host  
