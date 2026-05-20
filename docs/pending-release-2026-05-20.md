# Pending Release - 2026-05-20

Production is live. Keep local/dev fixes batched here until release time.

## Ready For Dev Testing

- Indian movie cleanup: tighten the Indian Movies matcher so plain audio/dub `language` values no longer classify a title as Indian. If a title has a known non-India country, bad old Indian tags are ignored. Otherwise the row uses confirmed India country, TMDB/original Indian language identity, or explicit Indian/Bollywood-style metadata.
- Admin Movies `Repair Regions`: now also cleans wrongly-added `Indian movies` / `Indian` tags from TMDB-linked non-Indian titles and corrects bad India country values when TMDB proves another country.
- Public catalog readiness gate: failed, queued, processing, uploading, or otherwise incomplete movies/parts/episodes are hidden from public catalog APIs and stale browser caches. A title only appears publicly when every required movie part or series episode has a playable source and no unfinished job status.
- Movie detail cache safety: if a user opens a stale cached movie that is no longer ready/public, the player page clears the stale cache and drops to the not-found state instead of showing `Video Unavailable` to users.
- Player frame sizing: movie detail/player page now uses a stable 16:9 inline player instead of viewport-height sizing, clears the fixed desktop header before rendering the player, and re-syncs the fixed playback overlay while scrolling. This removes black empty space on some phones and prevents the desktop player from being hidden/cropped under the header.
- Auth small-device layout: login, signup, forgot password, reset password, verify email, and admin login now use compact tiny-phone typography, inputs, spacing, and buttons below 390px wide while keeping the existing larger look on normal phones/tablets.
- Requests Uploader rebuild: `/admin/requests` now uses a separate mobile-first hub plus isolated movie and series request fulfillment pages. It keeps the standard movie/series uploaders untouched, uses only the existing request APIs, supports TMDB lookup, landscape-only backdrop uploads, one exact series season/episode request job, and optional movie player backdrop override via the existing admin movie patch.
- Requests completion pass: user `/request` now requires Movie vs Series selection and saves `requestType`; the Requests Hub shows live queued/current processing request jobs, plus quick admin actions for alternative VJ notification and unavailable notification. Existing completion notifications keep the fresh request watch link for immediate post-processing playback.
- Requests queue permissions fix: the live queue now reads `request_processing_jobs` through an authenticated admin API backed by Firebase Admin SDK, so the browser no longer needs direct Firestore permission to the worker queue collection.
- Requests queue UX: the request hub now shows a single `Processing Queue` button instead of embedding the full queue; `/admin/requests/queue` shows live stage cards for queued, downloading, inspecting, processing, uploading, ready, and failed jobs with real progress.
- Request series fulfillment: season manager now has explicit `Add Episode` and `Add Season` actions, repeated episode queues reuse the same requested series document, each episode carries its own description instead of inheriting one shared series description, and the episode editor pulls exact TMDb season/episode title, overview, and still image when available.
- Request movie fulfillment: movie request flow now includes an `Override Catalog Poster` upload separate from `Override Player Backdrop`.
- Series backdrop sync: public horizontal series cards now prefer `overriddenBackdrop` before TMDB/native artwork, and request series fulfillment persists both series and episode backdrop override metadata for the request worker.
- Movie creation backdrop upgrade: the standard new movie uploader now supports landscape-only `Override Player Backdrop` upload during initial creation, while preserving the existing edit-page fallback.
- Watch Trailer feature: movies, series, and episodes now support uploaded MP4 trailer assets (`trailerUrl`, `mainSeriesTrailerUrl`, `episodeTrailerUrl`); standard movie create/edit and series details/episode editor can upload trailer videos from device storage; movie detail pages show a conditional `Watch Trailer` button before `Add to My List`, remove the standalone `My List` button, and allow trailer playback for guests/free users while keeping full movie streams locked.
- Request Telegram worker reliability: forwarded Telegram downloads now retry after MTProto `Request was unsuccessful`/connection errors before marking a job failed, and successful links are posted as a fresh newest chat message instead of being edited into the old status reply.

## Production Release Rule

- Do not deploy each small fix.
- Before release, run the dev build and verify the browse Indian Movies row, a failed admin movie URL, movie player sizing on mobile plus desktop, auth pages on a narrow phone viewport, user `/request` Movie/Series submission, the live request queue, the VJ option notification, unavailable notification, standard movie create player backdrop upload, standard movie create/edit trailer upload, series main trailer upload, episode trailer upload/fallback, guest/free-user trailer playback, series override artwork on horizontal browse cards, and the new `/admin/requests` movie plus series request flows.
- After the eventual release, run Admin > Movies > Repair Regions once, clear `.runtime-cache/movies-catalog.*.json`, then restart as part of the normal release flow.
- Include every completed, not-yet-deployed item from this file in the release summary.
