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
