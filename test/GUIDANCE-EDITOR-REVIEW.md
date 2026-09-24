# Simplified guidance admin editor — September 24, 2026

The saved-guidance list and editor now occupy separate views. Cards show title, status and publication date, sorted newest publication/save first. The dropdown is removed. Edit loads the selected card's record and shows its title. New guidance clears the month, title, subtitle, content, publication time, status, flags and record identity.

General Guidance and all 12 signs remain. Pacific scheduling has one date/time field with the existing daylight-saving ambiguity controls. Scheduling, preview, display-only updates, unpublishing, deletion, featured monthly readings, internal test flags and browser recovery remain available. Secondary tools are above the two primary bottom actions, Save Draft and Publish. Success messages are timestamped in Pacific Time after independent backend read-back verification. No backend, member rendering or production data changes.

Validation: all 10 focused tests pass across guidance persistence, collection UI and collection management. Tests exercise the real Express endpoints with PostgreSQL-compatible PGlite, including save/reopen/publish, network and verification failures, stale revisions, blank new guidance, record isolation, correct month hydration, Pacific scheduling and schedule cancellation on draft save. Syntax and diff checks pass.

A mobile WebKit visual check was attempted but its browser binary could not be downloaded successfully. Live iPhone Safari review remains outstanding. These changes are for review; do not describe them as deployed or live-tested.
