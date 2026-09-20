# Luce private membership foundation — September 20, 2026

Review entry: https://lucehealing.com/members/review (existing Luce Admin password).
Member account is separate from newsletter/contact/customer records. Only the designated private inbox info@christinaworkman.com can register or receive account emails. No email is sent by deployment, publishing horoscopes, or changing preview state. Signup/resend/reset emails require the reviewer's action.

## Review on iPhone
1. Open the review entry and use the existing Admin password.
2. Create a member login using info@christinaworkman.com and a new password of at least 12 characters. Confirm via the email's button. The confirmation screen requires an explicit tap and grants seven days of free preview access. No billing object is created.
3. Return to Monthly horoscopes. Read all twelve signs in the clearly labeled Demonstration month. Inspect Account and About membership.
4. In the existing Admin → Membership tab, select the demonstration month or create a month. Edit sign text, Save draft, Preview draft, then Publish privately. Saved draft changes do not replace published content until Publish. Unpublish retains the draft. No subscriber email option is present.
5. Test Send password reset, reset the password, and sign in again. Previous sessions and used reset tokens become invalid.
6. In Admin, change the unbilled preview account state to expired or payment problem; member content becomes inaccessible. Restore Preview active to continue reviewing. Account/history remains intact.

## Implemented boundaries
- Public checkout always returns 403; there is no membership checkout creation implementation in stage one.
- Access is enforced server-side using opaque hashed sessions and expiry, account verification, subscription status and period end. Passwords use unique salts and scrypt. Cookies are HttpOnly/Secure/SameSite=Lax. Mutating routes reject cross-site browser requests. Password reset invalidates all member sessions.
- Preview pages return noindex/nofollow and no-store. Source/private files are blocked from static routing. Horoscope data requires verified access. No public navigation, pricing or SEO routes added.
- Existing payment key and payment webhook are untouched. The new membership webhook is separate and accepts signed sandbox events only. Even a mistakenly supplied live key is not used.
- Stripe data uses canonical subscription retrieval for updates/invoices; event IDs deduplicate retries; no membership or customer data is deleted. Cancellation at period end retains access while active through period end. Past-due, unpaid, paused, canceled, incomplete and expired statuses do not grant content. Expiry is checked at every request without a cron dependency. Stale linked subscription data is refreshed on authenticated account/content requests.
- No background job or new paid service. No newsletter tables, archive flags or contact records written by membership code.

## Decisions before launch
- Final two tier names and benefits; confirm which shared horoscope benefits apply to each tier. No additional ritual/crystal/personalized deliverables assumed.
- Final regular/founding prices, billing cadence, founding eligibility/duration and any trial policy. Earlier prices were tentative and are not configured.
- Confirm whether failed-payment access should pause immediately (current conservative preview behavior) or have a grace period.
- Supply actual monthly horoscope copy, replacing/retiring demonstration content.
- Real Stripe sandbox integration: securely configure MEMBERSHIP_STRIPE_TEST_KEY (sk_test_), MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET, and MEMBERSHIP_PORTAL_TEST_CONFIGURATION. Do not paste secrets into chat. Use a separate sandbox webhook at https://lucehealing.com/api/membership/stripe/webhook; subscribe to customer.subscription.created/updated/deleted/paused/resumed, invoice.paid, invoice.payment_failed and invoice.payment_action_required. Portal must allow subscription cancellation at_period_end, disable plan changes, and enable desired payment-method and invoice controls. A sandbox subscription must carry metadata luce_membership=preview and luce_member_id=<actual preview account id>; use test customer/subscription objects only. Existing live Stripe environment values must not change.
- No products/prices or subscriptions created because benefits/prices are unconfirmed. Real portal/cancellation test remains pending sandbox configuration and test-plan decisions. Core webhook, period-end access and portal behavior have been exercised with signed test events and mocked Stripe API responses.
- Final user approval is required before implementing/enabling public membership checkout and production billing. Stage one intentionally cannot activate live charging through an environment flag.

## Focused tests
`NODE_PATH=/workspace/scratch/43e661fb0862/qa/node_modules node --test test/membership.test.js`
Covers private gate, disabled checkout, Admin authentication, designated-recipient enforcement, signup/verification, confirmation replay, password reset and session revocation, cross-site rejection, all twelve signs, draft/published isolation, conflicting edits, unpublish, preview expiry, signed webhook rejection/acceptance, retry deduplication, billing portal binding, cancellation through paid period, payment failure/recovery, canceled suppression, live-event rejection and account preservation. All mail uses an isolated capturing test transport. No real inbox emails were sent by automated tests.
