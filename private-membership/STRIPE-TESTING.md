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

1. Render workspace and existing setting names are now confirmed below. Fill only the missing same-account Stripe test settings; do not repeat workspace discovery.
2. Deploy this branch to the controlled preview and complete actual Stripe test-mode signup, checkout, webhook activation, sign-out/sign-in, portal cancellation, paid-period expiry and rejoin tests. Use Stripe test cards only.
3. Adapt the public registration/login/email flow so verification alone grants no paid access, remove the designated-test-email restriction only for production accounts, and make the public Join buttons use that flow. Keep a separate default-off live purchase gate.
4. Reuse the existing Stripe account's live client and webhook setup; verify live recurring price IDs, portal cancellation configuration, production event routing and isolation from preview/test members. These are not configured in this branch.
5. Verify launch gates and present results for explicit approval before enabling live purchasing.

## Saved stopping point — September 20, 2026 Pacific / September 21 UTC

User explicitly paused work until tomorrow after more than six hours. Do not perform further setup, deployment or authentication until they resume. All implementation work is saved in draft PR #2:
https://github.com/christinaworkmanpottery-droid/luce-healing/pull/2

- Branch: feature/membership-stripe-test-checkout. Implementation commit on GitHub: 07016f5410a02c131ec3044917b047ae04df3ebf.
- Local checkout (if still available): /workspace/scratch/5511c2dcf007/luce-healing. Local equivalent implementation commit fd31911. GitHub connector performed upload because command-line git push lacked credentials.
- All 10 membership/navigation tests passed after npm ci; Stripe API calls were simulated. No real Stripe Checkout, webhook delivery or portal test has completed.
- User confirmed Render workspace My Workspace, ID tea-d6it66sr85hc73c5qs2g. Service luce-healing, ID srv-d6upv8euk2gs738ceod0, matches this repository. Do not confuse it with luce-app or The Potter's Mud Room.
- Render browser sign-in succeeded. The live service was on main commit 9e83b5804d9b100842fb9e275369c8a2d93c42a4, with auto-deploy off. PR #2 remains unmerged and undeployed.
- Render Environment UI showed existing STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. Only names were inspected; secrets were not revealed. No MEMBERSHIP_* variables were present, and no linked environment group was listed. Therefore the test key, three test price IDs, test webhook secret, test portal configuration and test-enable/offer controls listed above still need setup. Existing Stripe product inventory could not be inspected.
- Google sign-in and phone approval succeeded for the Stripe login, but Stripe itself then required passkey verification. Cloud browser does not support passkeys. Try another way led to a backup-code recovery form that explicitly says it temporarily removes two-step authentication. No backup code was requested or entered, and security settings were not changed.
- The prior automatic sign-in metadata rejection was resolved by a user-authorized secure retry; the current blocker is Stripe's own passkey requirement, not Render workspace selection or an incorrect password.
- No Render settings, Stripe objects, real customer data, payment credentials or production deployment were changed. No real charges or customer emails were sent in this work.

## Resume without repeating work

Read this file and PR #2 first. Keep the approved prices: founding $2.95/month while continuously active, regular $3.95/month, annual $37.92/year. Cancellation preserves access through the paid period; rejoining after the founding offer ends uses the then-current regular price. Reuse the existing Luce Stripe account and payment integration. No new paid services, duplicate Stripe account or unrelated site changes.

The last user-facing next step was to open the existing Stripe dashboard on their own iPhone and provide a screenshot of the account/menu area with keys and codes hidden. Guide the Stripe-side test configuration there if cloud authentication remains unavailable. Signing in on the user's own phone does not authenticate the cloud browser. Do not repeat the same Google/passkey loop, request recovery codes to remove two-step verification, or ask for passwords/API secrets in chat. Secret settings must go directly into the appropriate secure service UI.

Once access/configuration is resolved, complete the outstanding implementation and hosted tests above, then report exact results and remaining launch steps. A separate explicit approval is still required before enabling real membership purchases. The broad permission to continue setup/testing did not enable live purchasing.
