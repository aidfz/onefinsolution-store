# Infrastructure migration — onefinsolution.net

Controlled move of domain and service accounts. Application behavior, schema, pricing logic, and UX stay the same.

## Target

| Item | Value |
| --- | --- |
| Domain | `onefinsolution.net` (apex + `www`) |
| App paths | Existing paths only (`/`, `/dashboard/billing`, `/workspace`, `/software`, …) |
| GitHub | `aidfz/onefinsolution-store` |
| Hosting | Railway (new project/account — configure after cleanup) |
| Payments | One shared Stripe account (new) + one webhook endpoint |
| Email | Resend (new account) — from-addresses on `onefinsolution.net` |

## Architecture (unchanged)

- One main website domain
- Different URL paths for Subscription, Workspace Credits, and Software Purchasing
- One shared Stripe client (`lib/stripe.ts`)
- Three isolated customer mapping tables / payment-method scopes
- Central webhook: `POST /api/stripe/webhook`

## Secrets (never commit)

Configure in Railway variables and local `.env.local` only:

- `DATABASE_URL`
- `SESSION_SECRET`, `WORKSPACE_SIGNING_KEY`
- `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `STRIPE_EXPECTED_ACCOUNT_ID`, `STRIPE_MODE`
- `STRIPE_PRICE_DAILY|WEEKLY|MONTHLY|YEARLY`, `STRIPE_PRICE_CREDITS_50`
- `STRIPE_CREDIT_PLANS`, `STRIPE_SOFTWARE_CATALOG` (JSON from provision scripts)
- `RESEND_API_KEY` and `EMAIL_FROM*`
- Optional: `XAI_API_KEY`

## Provisioning order (new accounts)

1. Create Railway project + Postgres; set `DATABASE_URL` and session secrets.
2. Point custom domain `onefinsolution.net` at Railway.
3. Connect new Stripe account; set secret/publishable keys + `STRIPE_EXPECTED_ACCOUNT_ID`.
4. Run `node scripts/provision-personal-plans.mjs` and `node scripts/provision-software-catalog.mjs` (and credit pack provision if applicable).
5. Copy emitted Price/Product IDs into Railway env (`STRIPE_PRICE_*`, catalogs).
6. Create Stripe webhook → `https://onefinsolution.net/api/stripe/webhook`; set `STRIPE_WEBHOOK_SECRET`.
7. Connect Resend + domain DNS; set `RESEND_API_KEY` / from addresses.
8. Deploy from `aidfz/onefinsolution-store` `main`.
9. Smoke-test: health, signup/login email, subscription checkout, credits, software checkout, webhook ledger.

## Local laptop notes

- Do not use `*.railway.internal` DATABASE_URL from a laptop; use the public proxy URL.
- Keep real keys only in gitignored `.env.local`.
- `billing/personal-plan-ids.json` is a local provision artifact — empty placeholders in repo; regenerate per Stripe account.

## Verification scripts

- `node scripts/verify-deployment.mjs`
- `node scripts/verify-workspace-runtime.mjs`
- `node scripts/verify-resend-setup.mjs`
- `npm run email:test-templates` (requires `EMAIL_TEST_TO`)
