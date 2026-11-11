# Membership account repair — 2026-11-11

Status: prepared and tested locally; NOT deployed. Do not report checkout live.

Production: Render My Workspace (`tea-d6it66sr85hc73c5qs2g`), service `srv-d6upv8euk2gs738ceod0`, repository main. Deployed commit observed: `81368d1ef5cca43c09641a05e036cc19f423b12a`.

## Verified facts

- Render saved environment contains `MEMBERSHIP_STRIPE_LIVE_KEY` with correct capitalization, masked. Running process has not loaded it yet. Its account identity remains to be verified after deployment; no secret was displayed.
- Correct account is `acct_1TD7xKLZJAbDgWCX`. Stripe connector verified both active USD recurring prices in this account:
  - Monthly $4.95: `price_1UZebQLZJAbDgWCXKCGKNR6I`.
  - Annual $49.50: `price_1Uah3CLZJAbDgWCXVZNONSn8`.
- Both price environment variables already match those IDs in production.
- Correct account has no webhook endpoints and no billing portal configurations (complete lists, no further pages).
- Existing `MEMBERSHIP_PORTAL_LIVE_CONFIGURATION` is `bpc_1UI3I93UJLd7oGH5mVLFiTjz`; preserve it and `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` for legacy billing and purchased readings.
- Production `luce_complimentary_codes` contains active MEMBER1000 with no redemption limit, duration limit, or expiry. No production redemption performed.

## Prepared implementation

New checkout uses the dedicated credential, verifies the exact account and separate portal configuration before session creation, and stores `stripe_billing_account` with checkout. Untagged existing customer/subscription/checkout IDs remain legacy. Purchased readings and the original webhook remain on the original client. New signed endpoint: `/api/membership/stripe/webhook/live` (covered by the existing raw-body middleware prefix). Reconciliation of new completed checkout validates member and nonce before retrieving subscription and granting access. New-account events cannot mutate legacy billing records.

Required new configuration, without overwriting existing variables:

- `MEMBERSHIP_ACCOUNT_PORTAL_CONFIGURATION`: a new portal in the correct account, cancellation at period end enabled, subscription updates disabled, payment-method updates and invoice history enabled; return URL `https://lucehealing.com/members/account`.
- `MEMBERSHIP_STRIPE_LIVE_WEBHOOK_SECRET`: signing secret for a new correct-account endpoint at `https://lucehealing.com/api/membership/stripe/webhook/live`. Events: checkout.session.completed; customer.subscription.created/updated/deleted/paused/resumed; invoice.paid/payment_failed/payment_action_required. Transfer secret directly into Render without printing it.

## Unavoidable approval blocker

Automatic approval review rejected creation of the separate live billing portal, stating that the user authorized preserving/verifying the existing portal rather than an unvalidated replacement. No portal was created. The proposed portal is separate and leaves the old account untouched, but explicit approval is required to resolve this rejection. An earlier interim redeploy of the currently deployed commit to load the saved key was also rejected because the repair was not yet validated. No deploy occurred.

## Resume after explicit approval

1. Create the separate portal and webhook in the correct account, securely save only the two new variables. Confirm existing settings preserved. Do not request another Stripe login or key.
2. Run PR CI and review diff, merge through repository workflow, deploy exact merged commit.
3. In Render shell, use the saved runtime key to retrieve account ID without printing the key; verify exact account, both prices, portal, webhook configuration.
4. Verify both real site checkout buttons/session creation without paying. Test signed event handling/activation using isolated fixtures, not fabricated live customer subscriptions. Check logs and legacy portal operation. Report what is verified versus simulated; no charge is authorized.

Automated validation uses isolated PGlite, real Stripe signature verification, and mocked Stripe API calls. It covers both prices, wrong-account rejection, duplicate checkout, signed webhook rejection/retry, activation, cancellation/rejoin, return reconciliation, legacy portal routing, cross-account mutation rejection, MEMBER1000 redemption without billing, and entitlement gates. It does not prove live Stripe sessions or webhook delivery.
