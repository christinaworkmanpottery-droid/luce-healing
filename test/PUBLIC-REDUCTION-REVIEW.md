# Public content reduction — September 29, 2026

- Homepage static overview copy reduced from 438 to 337 words (excluding closed details, navigation, scripts, and hidden booking/admin controls).
- One introduction and credential statement; one primary reading presentation; compact reading, membership, personalized reading and support sections.
- Latest blog preview retained. Home shows one review excerpt; full approved reviews and submission moved to Meet Christina.
- Newsletter signup retained once, with its existing preferences and verification. Contact remains email-only on its dedicated page. Detailed FAQs remain on FAQ.
- Removed unrelated pottery links and duplicate footer contact rows. Admin remains in the footer.
- Birth-chart Pricing links now open the selected purchase form. Session deep links initialize the existing booking flow.
- Shared menu overrides old per-page CSS. Supporting text and gold links remain readable within the Luce palette; hero newsletter CTA is secondary.

Verification: 32 existing newsletter, analytics, purchased-reading and navigation tests passed; two membership navigation tests and three reduction/review/contact regression tests passed. Final shared-navigation/reduction rerun passed. WebKit browser QA covered 15 public routes at 390px, plus menus at 320, 430, 768 and 1440px on Home, Sessions and Personalized Monthly Reading. No script errors or horizontal overflow. Newsletter, contact and review submissions used mocked responses; chart purchases and session booking opened correctly. Production charges and real email sends were not performed. Database schemas, customer records, prices and payment handlers were not changed.
