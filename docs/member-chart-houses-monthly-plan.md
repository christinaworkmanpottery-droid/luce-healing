# Luce Healing — member natal houses and monthly readings

Status: approved product requirements; implementation in progress. This document is NOT a deployed feature.

## Preserve existing functionality
- Keep published General and all 12 sign horoscopes available to members.
- Preserve saved birth profiles, published editorial content, personal-reading history, subscriptions, Stripe behavior, and member privacy.
- Reuse `private-membership/chart.js`, `personal-reading.js`, and `service.js` rather than creating a second membership stack.

## Natal chart
- Calculate Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto, Ascendant and Midheaven where supported.
- Show signs, degrees, twelve house cusps, house occupancy, house rulers, and major aspects with orb.
- Select and disclose a house system; do not infer houses when birth time/location is missing, ambiguous, or polar calculation is unreliable.
- Validate house angles and timezone conversions against independent chart fixtures before exposing as fact.
- Add a readable chart wheel and text breakdown accessible on mobile.

## Monthly member experience
- Three tabs: Personal Monthly Reading, All 12 Horoscopes, My Birth Chart.
- Personal reading combines published General and relevant sign readings with verified natal data, house placements and independently computed transits; never infer houses/transits from sign-based horoscope copy.
- Save exactly one versioned generated reading per member per calendar month; preserve history.
- Schedule from the first day of each month in America/Los_Angeles, only after that month's horoscopes are published. Idempotent per-member-month claims; retry failures without duplicate billing or records.
- Eligible verified active paid members only; handle cancellation/renewal and chart edits explicitly.
- Generation uses the existing OpenAI provider. Owner has accepted API usage costs. Keep bounded retries, logging of usage, and no unnecessary regeneration.
- Keep birth data and account identifiers out of AI requests; send only minimal verified placements and relevant source text.

## Implementation gates
1. Add reliable ephemeris/house calculations with fixture tests and missing-time handling.
2. Extend stored chart schema and migration without overwriting saved profiles.
3. Extend reading context and validation to allow only independently calculated house/transit facts.
4. Implement idempotent monthly scheduling and access-controlled history.
5. Add responsive members-only UI, keep all 12 horoscopes accessible.
6. Test DST, missing birth time, chart revisions, unpublished month, inactive member, duplicate scheduler ticks, AI failures, and no accidental production sends.
7. Review and test in a separate branch before merging/deploying. Never auto-deploy from this planning document.
