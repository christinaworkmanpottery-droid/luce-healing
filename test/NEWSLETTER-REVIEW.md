# Luce Healing newsletter system — private review

This branch is based on production SEO commit `4295ec9a28b09f36cdaed83e43319050927ffe30`. It is not approved for production deployment. No production subscribers were queried, changed, or emailed during development. No paid membership system was added.

## What changes

- Turnstile server verification checks success, allowed hostname, action, and token length. Cloudflare controls token expiration and single-use. Missing keys, service failures, invalid tokens and production dummy keys fail closed. Signup forms use the configured Managed widget with interaction-only appearance, a honeypot, and database-backed hourly IP/daily email limits.
- Verification tokens are random, stored only as SHA-256 hashes, valid for 24 hours, single-use, and subject to a ten-minute resend cooldown. The public signup form is also the resend flow. A confirmation page requires an explicit button press so email link scanners do not activate subscriptions.
- Migration adds fields and tables without deleting historical subscribers or customer data. Historical active records become `legacy_unverified`; historical inactive records become `unsubscribed`. Their original active flag, name, source, date and email remain intact. Marketing eligibility additionally requires verified status, verification timestamp, active flag and the chosen preference. Legacy data is never silently treated as verified.
- Separate newsletter/blog preferences; confirmation, management, ordinary unsubscribe and provider one-click unsubscribe routes. Marketing links do not expose addresses. Unsubscribing keeps customer history and invalidates outstanding confirmation links.
- Standalone plain-text newsletter composer with paragraphs, sandboxed branded preview, drafts, send-now, scheduling, editing, cancellation and recipient results. Both existing Admin entry points use the shared component. Draft saves pause an existing schedule; saving and scheduling again is explicit.
- Blog editor gains optional future publication and an unchecked blog-email choice. Published article content is sent as readable text paragraphs with a permanent article link. Auto-publication email uses a unique delivery key, so resaving a published article does not repeat its original email.
- Persistent campaigns and per-recipient ledger. Atomic claims, revision checks, current preference checks, normalized-address deduplication, and restart recovery. Never-attempted recipients of an interrupted campaign can be explicitly resumed; accepted/uncertain results are not resent automatically. Explicit permanent SMTP recipient rejections are suppressed as bounced. An SMTP acceptance is not reported as inbox delivery.
- Existing Luce SMTP configuration is reused. Sender must match `NEWSLETTER_FROM` and be the known Luce Gmail address or a lucehealing.com address. No other business is used as a fallback.

## Configuration before launch

1. Create a **Managed** Cloudflare Turnstile widget for `lucehealing.com` and `www.lucehealing.com`. Add `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to the existing Render service. Never use Cloudflare testing keys on production. Optional `TURNSTILE_HOSTNAMES` defaults to those two hostnames.
2. Confirm existing Admin email settings use `lucehealing13@gmail.com` and its working Gmail App Password. That is the default permitted sender. If deliberately using an authenticated `@lucehealing.com` address instead, set matching `NEWSLETTER_FROM`.
3. Set `NEWSLETTER_TRUST_PROXY_HOPS` to the verified proxy-hop count. For a confirmed single trusted Render proxy, use `1`. Default `0` ignores forwarded headers safely, but can group users behind the proxy for rate limits. Do not trust all forwarded addresses.
4. After private review and explicit launch approval, enable `NEWSLETTER_WORKER_ENABLED=true`. Without this, no worker runs and manual queue endpoints refuse sends. Default links use `https://lucehealing.com`; `NEWSLETTER_BASE_URL` is only needed for an intentionally separate staging origin.
5. The worker runs in the existing web service every 30 seconds. Work survives restarts and catches up after downtime. A sleeping/unavailable service cannot deliver at an exact wall-clock time; an always-running service is needed for punctual scheduling. No extra paid worker was provisioned.
6. Perform a real confirmation-email and newsletter inbox test to a Christina-controlled address after credentials and keys are installed. Cloudflare and SMTP responses were mocked/captured in the isolated tests; no claim of actual inbox placement is made.

No bulk reconfirmation emails are sent by migration. Older contacts remain available for review. Resubscribing through the protected signup form verifies ownership and records explicit preferences. Later SMTP bounces or spam complaints are not automatically available through this Gmail transport; only synchronous permanent recipient rejection is suppressed here.

## Focused tests

Run `npm ci` followed by `npm run test:newsletter`.

Seven isolated PostgreSQL-compatible integration tests cover: nondestructive/idempotent migration, Admin authorization and token privacy; missing/forged/replayed/wrong-host/wrong-action Turnstile tokens and rate limiting; verification expiry/resend/replay and preferences; drafts/preview/send-now/audience separation/unverified exclusion/deduplication/unsubscribe headers; schedule edit/cancel/service restart/last-minute unsubscribe; publish-only and scheduled blog emails plus duplicate-publication prevention; SMTP failures, uncertain outcomes, permanent bounces and sender mismatch.

An additional private application fixture loads the current 43 published articles and asserts preservation of their titles, content, excerpts, slugs and publication flags after migration. Local DOM integration exercises the actual Admin JavaScript against the isolated API. The cloud browser could not access the local preview, so visual mobile review remains a launch gate; mobile CSS uses scoped styles, wrapping controls and 44px touch targets. The separate sample-data HTML preview is a UI demonstration, not a deployed backend and cannot send real mail.

SEO titles/descriptions/canonicals/schema, blog routing/sitemap, payments, gift logic, bookings and customer storage are not modified. Signup preference controls and the newsletter/Admin publishing controls are the only intended visible changes.

## Prepared no-additional-cost controlled deployment (awaiting Christina's approval)

Use the existing Luce Render service, domain, Turnstile widget and authenticated Gmail sender. No additional service or paid plan. This is a real deployment of the reviewed code to the live service, with general newsletter activation held back.

Preparation complete: added server-enforced `NEWSLETTER_DELIVERY_MODE` (`locked` by default; explicit `test` or `live` only), a fixed test recipient `info@christinaworkman.com`, and durable `test_only` campaign flags. All nine isolated tests passed, including two new restriction tests. No live configuration, code deployment or mail was changed by this preparation.

Before the explicitly approved deployment:
- Record current SEO deployment `4295ec9a28b09f36cdaed83e43319050927ffe30` as the rollback target and check for intervening source changes.
- Record subscriber counts/status and published article count without exporting private contact data. The existing migration preserves historical records and marks unverifiable legacy subscriptions, rather than deleting or mailing them.
- Save `NEWSLETTER_DELIVERY_MODE=test`, `NEWSLETTER_WORKER_ENABLED=false`, and `NEWSLETTER_FROM=lucehealing13@gmail.com` on the existing service using Save only. Preserve existing environment variables. Confirm existing Turnstile keys, allowed hostnames, and sender; do not expose secrets.
- Deploy the exact approved review commit only after approval. Immediately verify authenticated newsletter status reports test mode, the fixed recipient, and worker disabled. If not, stop before any test signup/send. Missing or invalid mode defaults to fully locked.

Enforced safeguards:
- Confirmation/resend mail and campaign mail pass a final transport guard. Only the exact test address is permitted in test mode; CC, BCC and custom envelopes are prohibited. Other signups receive a temporary-pause response before subscriber records are created/modified.
- Normal Admin send/schedule/resume actions are disabled. An authenticated queue request must explicitly contain `controlled_test:true`, permanently marking that campaign `test_only`.
- No automatic worker runs in test mode, even if the worker flag is accidentally true. Only authenticated POST `/api/admin/newsletter/controlled-test/tick` executes due test campaigns. It ignores normal campaigns and does not auto-publish blogs.
- Audience selection and each delivery both enforce the test recipient, plus normal verified/active/preference/unsubscribe rules. Historical and pending subscribers remain excluded. Existing pending ledger entries cannot bypass the recipient guard.
- Later live-mode operation cannot execute, resume, or convert a test-only campaign into a general campaign.
- These restrictions apply only to newsletter mail. Existing booking/purchase/contact transactional functionality is preserved.

Controlled test sequence after approval:
1. Use actual signup on lucehealing.com with Managed Turnstile and the designated test address. Confirm Cloudflare hostname/action validation and pending/inactive storage.
2. Queue an explicitly marked test newsletter before verification; execute the test runner and confirm zero marketing recipients.
3. Christina opens the genuine verification email link and presses Confirm; verify activation and single-use token behavior. No real Cloudflare success is mocked or bypassed.
4. Send one explicitly marked newsletter to the verified test address; confirm arrival and Luce branding. Use an existing published article for a test blog campaign; do not publish or edit a test article on the public blog.
5. Open the actual preferences link, disable blog delivery while retaining newsletters; confirm blog test is suppressed. Enable blog preference, then confirm a test blog email arrives only at the designated inbox.
6. Open the actual unsubscribe link and confirm. Execute subsequent newsletter and blog test campaigns; both must produce zero recipients and no SMTP attempts. Confirm retained subscriber history.
7. Check honeypot and missing/invalid-token rejection without creating records or emails. Exercise rate limiting last so the test does not block earlier signup steps. No bulk reconfirmation or other subscriber mail.
8. Cancel any remaining test campaigns and leave test mode/worker-off restrictions in place. Report results and await a separate explicit approval before setting `NEWSLETTER_DELIVERY_MODE=live` and enabling the worker.

Customer-visible limitation: ordinary newsletter signup is temporarily paused during the controlled test window. The website otherwise uses its existing design and functionality. Passing these isolated tests does not yet establish real Cloudflare success or real clickable-link behavior; those remain the controlled post-deployment gate.

## Final production activation approval

Christina explicitly approved general activation after the real verification/confirmation, newsletter and blog inbox delivery, preference update/blog suppression, unsubscribe link/suppression, honeypot, invalid-token and rate-limit checks. Only info@christinaworkman.com was emailed during controlled tests; both campaign emails were confirmed received.

Activation configuration: NEWSLETTER_DELIVERY_MODE=live, NEWSLETTER_WORKER_ENABLED=true. Production Turnstile keys and the approved Luce Gmail credentials are preserved. No paid service was created. Before activation, the database contained 51 subscriber records, 43 published articles, two attempted deliveries (both the designated test inbox), zero queued general campaigns, and zero scheduled blog publications.

Cleanup retains test campaign/delivery records for history and permanent send exclusion, but hides test campaigns from the production Admin campaign and legacy send-history lists. Any unfinished test campaigns are canceled. General campaigns require a deliberate future Admin send/schedule action; activation does not queue one. Missing/invalid delivery mode still fails closed. The focused test for controlled recipient isolation, future-live exclusion and production-list hiding passed before release.
