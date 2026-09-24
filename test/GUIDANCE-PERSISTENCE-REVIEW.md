# Special Astrology Guidance persistence — September 24, 2026

## Diagnosis

Production baseline: `8335e7fde0011ed5b45f00b1437be46586e0346e`.
The old editor sends PUT `/horoscopes/<selected month>` for a new collection without a revision. September and October already exist. The backend attempts an update with an absent revision, changes no rows, and returns 409. Publish invokes the same Save function first, so it fails before publication. Reproduced against the original endpoint in automated tests. No request logs exist for the user's attempt, so this is a demonstrated defect consistent with the loss, not proof of the exact historical request.

The old save has two separate writes (content PUT, then metadata PATCH). Errors appear at the top of a long editor. There was no recovery storage or navigation protection. Nothing indicates the public blog and membership used different databases. The live database contained only September Full Moon, October, and demonstration records; Venus public blog id 50 was present. No missing member text was recovered or recreated.

## Changes

- New collections use stable UUID-based keys; existing records retain their keys and contents.
- A transactional endpoint saves complete reading text and metadata together, with revision checks and validation before mutation. Extra saved content keys are preserved.
- Save reads the record back independently with caching disabled, comparing metadata and all 13 reading fields before success.
- Publish saves first, publishes a committed snapshot, and independently reads and checks the published text. Failed publication leaves the server draft intact.
- Browser recovery copies are written on input/change and before navigation, with a recovery chooser on return. Recovery is explicitly distinguished from a server save. Storage failures are surfaced.
- Editor navigation warns about unsaved changes. Requests lock controls to prevent edits being overwritten by returning responses. Errors also appear by the action buttons.
- Saves/publications keep database revision snapshots. Deletion archives the last snapshot before removing a collection; editor deletes require confirmation and read-back verification.
- Cache-busted editor script; old clients receive a specific unsaved-month-conflict error.

## Local verification

20 regression tests passed: persistence, collection management/UI, general readings, membership/security/billing/scheduling, complimentary UI.
New persistence tests use the real Express backend with PostgreSQL-compatible PGlite and the real editor in JSDOM. A roughly 74 KB disposable draft includes General plus all 12 signs, Unicode, line breaks, tips/crystals strings and subtitle. Tests cover save, fresh editor/reopen, publish, member API read-back, personal-reading route, edit/save/reopen, second same-month collection, deletion and unchanged existing row. Failure tests cover network save failure, browser recovery after reopening, read-back failure, stale revision, invalid metadata with no partial content update, and publication network failure preserving the draft.

## Live baseline and outstanding gate

Luce Render service: `srv-d6upv8euk2gs738ceod0`, workspace `tea-d6it66sr85hc73c5qs2g`, database `dpg-d6vo9vh5pdvs738p9kdg-a`.
Before changes:
- September draft/published MD5: `8d8430e898d0f32476bb6e6e29a39c3f`; row `ad70b0e4ae8fcdd0fac0a595bb816de9`.
- October draft/published MD5: `ce72e530775c0483c7defec6ba4292db`; row `22548165236a827a14984ec49a81cdb0`.
- Demonstration row MD5: `809dbe025045d44e6d31d9907df136cb`.
- Member rows: 1, aggregate MD5 `97fa7379bc680127e13c4014f56165cb`.
- Blog rows: 46, content/metadata aggregate MD5 excluding view counts `39d028288ac914e6c5778b9cf7d51c7d`.
- Newsletter campaigns: 9, aggregate MD5 `171e2bdf9330f873a4456dbe6cdf9a24`.

Live browser test remains pending authenticated admin access. Do not claim full verification or recreate Venus until a disposable entry is saved, reopened, published, read by a member, edited, reopened, compared to live database values, and deleted. Recheck baseline fingerprints. Do not create a member or change account access to facilitate testing.
