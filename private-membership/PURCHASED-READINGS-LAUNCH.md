# Personalized Monthly Reading launch checkpoint

Price: USD 12.95, one-time Stripe Checkout payment. Existing member readings remain separate and included. No recurring subscription is created by this product.

## Implementation

- Reuses Luce accounts, email verification, sessions, chart engine, Stripe client and signed production webhook, and the locked-natal reading provider.
- `luce_purchased_readings` stores immutable recipient, calculated chart, published source context, purchaser, checkout/payment, generation claim and saved reading.
- Unique purchaser/fingerprint, row-locked checkout creation and Stripe idempotency prevent repeated taps from creating duplicate purchases. Expired unpaid sessions use a new checkout version; paid sessions never return to payment.
- Signed webhook and server-side checkout reconciliation both validate live mode, product, purchase ID, amount, currency and payment status. A browser cannot declare payment successful.
- Durable queued jobs, claimed generation, startup recovery and a ten-minute lease recover interrupted work. Retry only changes the generation state, never payment. The existing generation provider checks natal consistency and source grounding.
- Private account access does not depend on membership status. Saved member readings and purchased readings are stored separately.
- Share links contain 256-bit random tokens stored only as hashes. Links are read-only and revocable, including all links for a purchase. Response allowlists exclude account IDs, Stripe IDs, sources, provider metadata and raw birth details. Shared pages include only recipient name, reading month, reliable natal-placement summary, finished reading and attribution.
- The purchaser sees the full birth detail header. Email/Text use device composers; copy uses clipboard with manual fallback. Browser print supports Save as PDF. The print version carries Luce attribution.
- Private/shared pages have no-store, noindex/nofollow/noarchive and no-referrer headers. No private information appears in document titles or metadata.
- The homepage adds the one-time offer alongside the unchanged $33 Ask One Question and Astrology Membership promotions.

## Automated verification

Full existing suite passed (73 tests at the first complete regression run). All nine expanded purchase tests passed in a subsequent focused run. Expanded purchase tests additionally cover signup/verification, logout/login, concurrent checkout and generation, source/profile changes, membership transitions, member purchases for another person, privacy, attribution, iPhone SMS format, clipboard and print invocation. These use isolated PostgreSQL-compatible PGlite data, synthetic recipients, mocked Stripe and mocked generation; no real customers are charged or modified.

Run: `node --test --test-concurrency=1 test/*.test.js`

## Production checkpoint and verification still required

- The core implementation was observed live at commit `3b291cc92b2152049639344789be530deb37cd39` on Render. This does not establish a verified end-to-end paid transaction.
- Authenticated Render console: verify the real provider with published October content and a synthetic chart, without storing a reading on a customer's account.
- Verify Stripe test-mode payment completion and webhook/return behavior with supported test credentials; no live customer charge is authorized by this checkpoint.
- Browser review of public entry, purchaser and shared reading, and print layout. The local browser could not reach the executor's loopback preview.
- Verify the final production main commit, Render service `srv-d6upv8euk2gs738ceod0`, the live homepage and signed-in purchase paths, and runtime errors.

Do not describe this checkpoint as a completed live launch until those checks are recorded.
