# Astrology Membership Stripe checkpoint

This branch reuses the existing Stripe client passed by server.js. It adds private test Checkout only. No real purchasing or public member registration is enabled, and no live credentials or existing payment routes are replaced.

## Configuration required for hosted testing

Inspect existing settings before adding anything. Do not expose secret values. Use test mode in the existing Luce Stripe account, not a new Stripe account.

- MEMBERSHIP_STRIPE_TEST_KEY: a test secret from the existing account, only needed if the site's existing STRIPE_SECRET_KEY is live. Never replace the site's live STRIPE_SECRET_KEY to run membership tests.
- MEMBERSHIP_TEST_PRICE_FOUNDING: USD 295 cents / month.
- MEMBERSHIP_TEST_PRICE_MONTHLY: USD 395 cents / month.
- MEMBERSHIP_TEST_PRICE_ANNUAL: USD 3792 cents / year.
- Each test price must be active, per-unit, licensed, interval_count 1. Reuse matching existing test prices when available.
- MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET: signing secret for /api/membership/stripe/webhook. Subscribe to checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid/payment_failed/payment_action_required.
- MEMBERSHIP_PORTAL_TEST_CONFIGURATION: test billing portal configuration with subscription cancellation enabled at period end and subscription plan updates disabled.
- MEMBERSHIP_TEST_CHECKOUT_ENABLED=true permits only the confirmed designated test member to open a test checkout. Defaults off. Live keys/prices/events remain rejected.
- MEMBERSHIP_FOUNDING_OFFER_OPEN=true offers founding monthly pricing; false offers regular monthly pricing for new subscriptions. Existing subscriptions keep their original Stripe recurring price. Annual is always $37.92.

## Completed locally

`node --test test/membership.test.js test/membership-navigation.test.js`

Tests use a real local PostgreSQL-compatible database, real webhook signature verification, and simulated Stripe API responses. They do not prove hosted Stripe Checkout, webhook delivery, or the Stripe portal works.

Account verification currently provides the existing seven-day admin preview. This is preview-only behavior, not the eventual paid signup flow. Test Join buttons are on the private account page. Public Join/purchasing remains disabled.

## Still required before launch approval

1. Confirm the Render workspace containing Luce Healing, inspect configuration presence without disclosing secrets, and fill only missing same-account test settings.
2. Deploy this branch to the controlled preview and complete actual Stripe test-mode signup, checkout, webhook activation, sign-out/sign-in, portal cancellation, paid-period expiry and rejoin tests. Use Stripe test cards only.
3. Adapt the public registration/login/email flow so verification alone grants no paid access, remove the designated-test-email restriction only for production accounts, and make the public Join buttons use that flow. Keep a separate default-off live purchase gate.
4. Reuse the existing Stripe account's live client and webhook setup; verify live recurring price IDs, portal cancellation configuration, production event routing and isolation from preview/test members. These are not configured in this branch.
5. Verify launch gates and present results for explicit approval before enabling live purchasing.

Current blocker: Render connector requires a user-confirmed workspace; available names are My Workspace and The potters mud room. No Render settings, Stripe objects, real customer data or production deployment were changed in this checkpoint.
