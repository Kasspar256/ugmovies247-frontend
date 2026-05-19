# Pending Release - 2026-05-19

Production is live. Earlier fixes from today have already been deployed. Track only new changes from this point forward.

## Ready For Dev Testing

- Dev catalog routing: DEV public catalog must read the same DEV movie collection used by the admin uploader.
- Mobile-first series uploader rebuild: new hub with back navigation, focused details/seasons/episode pages, TMDb series search/prefill, mobile-safe landscape backdrop override picker, landscape-only native backdrops and overrides, draft series shells, episode queue confirmation, and player thumbnail override priority.
- Movie player landscape backdrops: catalog posters stay for browse/search cards, while the movie detail/player now uses `overriddenPlayerBackdrop` first and the official TMDB horizontal backdrop second; Admin Edit Movie has a separate landscape-only "Override Player Backdrop" save action that preserves metadata and video links.
- Player control refresh: mobile player now has standard transport controls, red center play, swipe-up/down side zones for brightness and volume, no extra movie-page nav over the player, top-pinned stable inline positioning while scrolling the movie page, more aggressive landscape orientation locking on fullscreen, surface taps only reveal controls instead of pausing playback, cast/settings/fullscreen, Picture-in-Picture support where the browser allows it, and Media Session controls for Android/browser background playback.

## Already Deployed Today

- Offline downloads: native downloads work, offline playback works, active download progress works, cancel/retry work, and episode download keys are unique per exact episode.
- Offline downloads UI cleanup: keep movie/player page simple, keep active downloads page readable, and avoid multi-download progress fighting.
- Telegram media worker cleanup pause: auto-delete timer is stopped on the Telegram media worker VPS so ready links are not deleted while uploading backlog.

## Production Release Rule

- Only deploy after the dev tunnel/build is checked.
- Include every completed, not-yet-deployed item from this list in the release summary.
- Do not give VPS deploy commands unless production release is explicitly requested.
