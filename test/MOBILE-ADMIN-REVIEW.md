# Mobile admin candidate — October 31, 2026

Prepared from main aa8d38d. Not deployed. Keep this branch separate from the pending security repair branches; do not replace or discard those repairs.

Changes:
- Main admin opens on Dashboard. Subscriber, active membership and today's traffic summaries appear first. Mobile section selector avoids a long navigation list.
- Newsletter subscribers and recent signup dates/status appear before collapsed compose/history/settings controls. Subscriber management and sending retain existing endpoints.
- Membership signup summary and the existing account records precede the existing guidance editor. Billing logic is unchanged; test accounts are excluded from summaries.
- Published blog order uses separate PostgreSQL tables, with up/down and move-to-top controls, automatic save, conflict detection and error feedback. Public API, blog HTML and homepage use that order. New unranked posts follow prioritized posts. Publication dates/content/URLs are not rewritten.
- One-time initialization prioritizes a published November 2026 forecast matching its title/slug, then preserves the previous date ordering. Confirm the actual November post before rollout; this has been tested with fixtures, not the production database.
- Traffic shows unique browsers and filtered views for today, rolling 7/30 days, preceding-period comparisons, article readership, existing source attribution and daily/weekly tables in expandable sections. Today compares with the full previous day and is labeled accordingly. Partial tracking history is labeled. Signup counts are shown without inventing conversion attribution or rates.

Validation: 33 passing tests across admin-mobile, blog-order, analytics, newsletter, collection-ui, membership-live and admin-sessions. JavaScript syntax and git diff whitespace checks pass. Tests use isolated PostgreSQL-compatible PGlite and JSDOM; no live customer data, email sends or billing operations. Newsletter and billing fixtures exercise the existing behavior. No paid services added.

Not yet verified:
- Rendered mobile/browser and physical iPhone Safari usability. Local Playwright browser installation failed because its downloaded archive was invalid; JSDOM is not a layout test.
- Independent production backup, isolated restore and rollback. No recovery operations or production migrations were performed for this candidate.
- Live November forecast match and end-to-end public ordering after deployment.

Deployment remains blocked until recovery safeguards and mobile visual checks pass. Initialization creates only editorial-order tables and metadata; rollback to prior code leaves these tables unused and retains original blog data. This describes the rollback approach, not a verified recovery result.
