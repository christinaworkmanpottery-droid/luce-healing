# Astrology Membership Stripe checkpoint

## Latest stopping point — September 21, 2026, after midnight Pacific

Christina explicitly stopped for the night until she starts writing horoscopes. Do not continue development, deployment, authentication or activation until she resumes. This section supersedes earlier historical next-step instructions below.

- Completed: existing sandbox product, all three recurring prices, webhook, portal, corrected test secret and test flags saved; exact deployed commit 1508206903472f11c2ecc9251de83801da476477, deployment dep-daoe4pjtqb8s73evtje0. Stripe API verified prices and portal. User completed test checkout, portal cancellation and confirmed website access/cancellation display. Do not make her repeat setup or those checks.
- Public membership information page is live. Paid public signup and real membership purchases remain disabled. Draft PR #2 remains unmerged; auto-deploy remains off.
- October 2026 will be the first real horoscope month; skip September. Christina will write all 12 in Admin → Monthly Horoscopes, save drafts, then publish October early for founding-member launch. Do NOT schedule October for October 1 midnight; she explicitly chose early publication instead. Publishing content does not enable purchases.
- Approved exact note: “October’s horoscopes are available early to welcome our founding members. Starting in November, new horoscopes will be published on the 1st of each month, Pacific Time.”
- Note saved in astrology-membership.html on feature/membership-stripe-test-checkout, commit 9402d9cb3d18ec92a07f85581d0d664eea3df16f. Not deployed: text must not claim availability before actual October content exists. User was told it is saved in launch draft.
- Use “Pacific Time” exactly. Existing scheduler uses America/Los_Angeles and handles daylight saving. No new recurring auto-publication behavior or November schedule was created by adding this text; each completed month must be scheduled in Admin.
- At last database check only demonstration month 2099-01 existed. No October content was created by the assistant.
- Remaining technical work after resume: implement production registration/verification/login and payment-gated member access; isolate real vs test members and Stripe objects; inspect/reuse live membership product/prices/portal/webhook configuration; complete remaining focused payment/access/expiry/rejoin checks; publish the approved note with actual October content ready. Request final activation approval only after concrete preparation and verification. Do not enable purchases while paused.
- All repo-backed work and checkpoints are saved to GitHub. No secrets belong in this document. Existing bookings, newsletter, admin and other payment flows must be preserved.

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

## Resumed on iPhone — September 20 late evening Pacific

User resumed manual Stripe configuration in the existing Luce Healing dashboard. Screenshots show Sandbox, one Astrology Membership product and all three correct recurring USD prices, with zero active subscriptions. User copied these exact IDs into chat:

- MEMBERSHIP_TEST_PRICE_FOUNDING=price_1UI0C13UJLd7oGH5bvTKeWi8 ($2.95/month)
- MEMBERSHIP_TEST_PRICE_MONTHLY=price_1UI0Ge3UJLd7oGH5m1kbj41w ($3.95/month)
- MEMBERSHIP_TEST_PRICE_ANNUAL=price_1UI0Hl3UJLd7oGH5p1xZ5sYg ($37.92/year)

These IDs are recorded, not yet configured in Render or verified through the API. Do not recreate the product or prices. No secret was supplied. The sandbox key, membership webhook, portal configuration, controlled deployment and hosted tests remain outstanding. Confirm the key and all objects belong to this same sandbox before testing. Existing live Stripe settings must remain intact. Live membership purchasing remains disabled.

## Updated manual setup checkpoint — September 21, 2026

User resumed and confirmed all six required Render test settings saved with Save only: MEMBERSHIP_STRIPE_TEST_KEY (presence confirmed), all three test price IDs listed above, MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET, and MEMBERSHIP_PORTAL_TEST_CONFIGURATION=bpc_1UI18k3UJLd7oGH5vo3OQIvQ. Values have not been API-validated. No secrets were posted in chat.

Webhook Luce Membership Test is Active in the existing Luce sandbox at https://luce-healing.onrender.com/api/membership/stripe/webhook; Your account, Snapshot, API version 2026-02-25.clover, seven specified events. No delivery test completed.

Default test portal saved: cancellations at billing-period end enabled, plan switching and quantity changes off. Payment-method updates instructed before save; verify configuration through API. No no-code portal link needed.

Test-checkout enable and founding-offer controls are still unset. Draft implementation remains unmerged/undeployed. Next: check compatibility with configured API version, verify saved environment and sandbox objects, enable controlled test checkout only, deploy controlled draft and perform hosted checkout/webhook/portal tests. Public registration adaptation and real-purchase approval remain outstanding. Existing live Stripe configuration must remain unchanged.

A previous checkpoint write failed due to Work credit approval failure. User has now reloaded credits and asked to continue. Do not repeat manual Stripe setup.

## Controlled deployment completed — September 21 07:24 UTC

Render authenticated again through secure Google sign-in. Browser verified all six MEMBERSHIP setting names. Added MEMBERSHIP_TEST_CHECKOUT_ENABLED=true and MEMBERSHIP_FOUNDING_OFFER_OPEN=true using Save only, preserving existing variables. Deployed exact commit 1508206903472f11c2ecc9251de83801da476477 from draft branch via Render specific-commit deployment. Render deployment dep-daodmvoae00c73c4a4l0 reports live, finished 2026-09-21T07:24:20Z. Auto-deploy remains off; PR unmerged. Local 10 membership/navigation tests passed again. Code supports subscription-item billing periods and invoice parent subscription details.

Hosted /members opened with private preview gate already satisfied but member login absent. Secure member sign-in request was rejected by automatic browser review because login form was below visible viewport (account creation visible). No credential prompt was shown or submitted. Attempt to scroll to login timed out. Actual hosted checkout, webhook delivery, cancellation and rejoin remain untested. Do not claim end-to-end success. Real purchasing remains disabled.

## Sandbox key corrected and validated — September 21 07:54 UTC

The previously saved MEMBERSHIP_STRIPE_TEST_KEY did not have the required sk_test_ prefix. User replaced it and resolved a duplicate environment row. Redeployed the same controlled commit 1508206903472f11c2ecc9251de83801da476477; deployment dep-daoe4pjtqb8s73evtje0 became live at 07:53:35 UTC. Safe runtime checks confirm test key prefix valid, test-checkout flag true, webhook and portal settings present. Read-only Stripe API calls using the runtime secret confirmed all three saved prices active, livemode false, USD 295/month, 395/month, 3792/year, interval_count 1 and licensed. Portal is active and test-only, cancellation enabled at_period_end, subscription updates disabled, payment-method updates enabled. Secrets were never printed. Hosted member login remains on user's phone; next refresh /members/account and select Test Join founding under Private payment test. Actual checkout completion, webhook delivery and cancellation/rejoin remain unverified. Real purchasing remains disabled.

## User completed hosted sandbox checks; launch content blocker — September 21

User reported everything works and supplied Stripe Test mode portal screenshot: Astrology Membership $2.95/month, cancellation at October 21, 2026, with option to undo cancellation. After being asked to return to Luce and confirm access through period end and pending cancellation, user replied yes/all good. These are user-confirmed hosted checkout/portal/account checks; automated end-to-end and expiry/rejoin checks have not been completed.

User urgently wants launch before bed. Focused read-only runtime checks found existing STRIPE_SECRET_KEY has live prefix and existing webhook secret present. No MEMBERSHIP_LIVE_PRICE_FOUNDING/MONTHLY/ANNUAL values are configured (these are proposed production names, not yet supported by code). Actual live Stripe inventory has not been checked; do not assume objects need recreation.

CRITICAL CONTENT BLOCKER: luce_horoscopes contains exactly one row, 2099-01, published_demo=true, published=true, scheduled_at=null. No real monthly horoscope drafts or published readings exist in the membership database. Do not sell access to demonstration-only content without addressing this with Christina. Do not invent forecasts or migrate unrelated blog text as paid readings.

Code remains test-only: designated inbox, preview gate, preview verification access, sandbox Stripe client and webhook. Public paid signup/payment-gated access and separate production Stripe routing still require implementation and validation. No launch code or live Stripe objects were changed this turn. Keep purchasing disabled pending prepared reviewable launch and explicit activation approval. Resume from completed configuration; no more key setup or repeating screenshots required.
