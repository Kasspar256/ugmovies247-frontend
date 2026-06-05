# Pending Deploy Items

Keep this list as the holding area for fixes that are ready to ship later. Do not deploy these automatically; deploy only when Kasspar says "let's deploy" or explicitly asks for deployment commands.

## Pending

### Catalog Rendering Performance Refactor

Status: code changed locally, not deployed.

Purpose: remove bottom-nav input delay, stop full catalog pages from rendering the entire library at once, move catalog persistence off synchronous localStorage parsing, and show instant skeleton screens during route transitions.

Files changed:

- `package.json`
- `src/components/MobileBottomNav.tsx`
- `src/components/PublicCatalogHydrator.tsx`
- `src/components/catalog/VirtualizedCatalogGrid.tsx`
- `src/components/catalog/CatalogGridRouteSkeleton.tsx`
- `src/lib/publicMovies.ts`
- `src/app/movies/page.tsx`
- `src/app/series/page.tsx`
- `src/app/category/[id]/page.tsx`
- `src/app/genres/[id]/page.tsx`
- `src/app/movies/loading.tsx`
- `src/app/series/loading.tsx`
- `src/app/category/[id]/loading.tsx`
- `src/app/genres/[id]/loading.tsx`
- `src/app/browse/loading.tsx`
- `src/app/browse/[section]/loading.tsx`

Verification needed before deploy:

- Run `npm install` in the Linux repo so `@tanstack/react-virtual` and `localforage` are installed and the lockfile is refreshed.
- Run `npm run build`.
- Test bottom nav taps between Home, Movies, Series, Search, and Profile on Android; the active icon should update immediately.
- Open `/movies`, `/series`, `/category/{id}`, and `/genres/{id}` with a large catalog and confirm scrolling is smooth with no card overlap.
- Hard refresh the app and confirm the catalog hydrates without a long main-thread freeze.

### P1 Video Player Stability Rewrite

Status: code changed locally, not deployed.

Purpose: stop infinite loading spinners, preserve playback position across mini/full player transitions, and prevent ghost control flicker while a movie is playing.

Files changed:

- `src/components/player/PlaybackProvider.tsx`

Verification needed before deploy:

- Run `npm run build` in the Linux repo.
- Open several MP4/HLS movie and episode URLs, including one on a slower network.
- Confirm a stuck `loadstart`, `waiting`, or `stalled` state retries automatically instead of spinning forever.
- Start a movie, move into mini-player/navigation, return to the full player, and confirm it resumes at the live timestamp.
- Watch for at least five minutes and confirm controls do not flicker unless touched/clicked/moved.

### Seamless Player Lifecycle and Episode Queue

Status: code changed locally, not deployed.

Purpose: remove the extra "Preparing Player" stage, force clean video remounts on episode/source changes, prevent episode timestamp leaks, add next episode/movie queueing, and center the active episode thumbnail in the rail.

Final adjustments included:

- Prevent the false "Video Unavailable" flash while the exact playback source is still hydrating.
- Preserve the same live `<video>` node and buffered stream when expanding from mini/PiP back to the full player page.
- Dock the already-playing mini/PiP video into the movie route loading page instead of showing the old fake skeleton controls.
- Treat the current provider playback session as a valid source while the movie bootstrap is hydrating, so expand cannot clear the live stream.
- Make the movie route bootstrap fail open to the client cache instead of throwing the app into "reconnecting your session".
- Let the app error boundary host the live player if a route fallback ever appears during playback.
- Make the seek bar scrub continuously on drag/touch and keep the runtime label readable in landscape mobile layouts.
- Make the unplayed seek bar track visibly white/grey behind the red played progress in portrait and landscape.
- Replace the default player loader with the premium red-and-white ring spinner used by the page loading state.
- Add a loading watchdog so Android WebView buffering cannot sit on the spinner indefinitely without forcing a source wake-up.
- Queue a related series/movie recommendation when the viewer finishes the absolute last episode of a series.

Files changed:

- `src/components/player/PlaybackProvider.tsx`
- `src/app/movie/[id]/MovieClientPage.tsx`

Verification needed before deploy:

- Run `npm run build` in the Linux repo.
- Open a movie and confirm Play goes straight into the video canvas loading state with no "Preparing Player" box.
- Open a movie from a cold load and confirm "Video Unavailable" does not flash before the source lookup completes.
- While a video is playing in mini/PiP, tap expand and confirm the video resizes into the page without a network reload, black frame, or buffer reset.
- While a video is playing in mini/PiP, tap expand and confirm the old movie skeleton controls never appear.
- Force a slow/failed movie bootstrap and confirm the live player remains docked instead of showing the "reconnecting your session" dead screen.
- Start Episode 1 near the end, switch to Episode 2, and confirm Episode 2 starts at `0:00`.
- Let a series episode end and confirm the 5-second next-episode countdown appears and advances automatically.
- Let the final episode of a series end and confirm the countdown queues a related/new series instead of stopping dead.
- Drag the seek bar thumb forward/backward on Android portrait and landscape and confirm the runtime text remains visible.
- Confirm the unplayed part of the seek bar remains visible over bright and dark scenes.
- Open a slow-loading movie and confirm the player shows the red-and-white ring spinner, then retries/wakes the stream instead of spinning forever.
- Let a movie end with related movies available and confirm the first related title can be skipped to from the player.
- Open a high episode number and confirm the episode rail centers the active episode thumbnail automatically.

### Premium Android Push Notification Visuals

Status: code changed locally, not deployed.

Purpose: replace the generic Android notification square with a branded monochrome clapperboard status icon, and send rich poster/backdrop images so expanded notifications look like premium streaming alerts.

Files changed:

- `capacitor.config.ts`
- `android/app/src/main/res/drawable/ic_notification.xml`
- `src/lib/server/uploadNotifications.ts`
- `src/lib/server/requestNotifications.ts`
- `src/app/api/admin/notifications/route.ts`
- `src/app/admin/notifications/page.tsx`
- `src/components/PushNotificationRegistrar.tsx`

Verification needed before deploy:

- Confirm the Linux Android project contains `android/app/src/main/res/drawable/ic_notification.xml` before `npx cap sync android`.
- Run `npm run build` and `npx cap sync android` in the Linux repo.
- Build/install an Android test AAB or APK, then send a push while the app is backgrounded.
- Confirm the status bar shows the new small clapperboard icon instead of a white square.
- Send a `/movie/{id}` notification and confirm the expanded notification shows the movie backdrop/poster image.

### Instant Native Push Notification Delivery

Status: code changed locally, not deployed.

Purpose: make admin manual notifications and latest-upload notifications deliver through real native/web FCM tokens immediately, instead of silently missing devices or relying on stale one-token records.

Files changed:

- `src/components/PushNotificationRegistrar.tsx`
- `src/lib/auth/client.ts`
- `src/app/api/notifications/register/route.ts`
- `src/app/api/admin/notifications/route.ts`
- `src/app/api/notifications/route.ts`
- `src/lib/userNotifications.ts`
- `src/app/notifications/page.tsx`
- `src/app/admin/notifications/page.tsx`
- `src/components/admin/controlCenterUtils.ts`
- `src/components/admin/AdminControlCenter.tsx`
- `src/lib/server/uploadNotifications.ts`
- `src/lib/server/requestNotifications.ts`
- `src/app/api/admin/movies/route.ts`
- `src/app/api/admin/direct-videos/route.ts`
- `src/app/api/admin/movies/[movieId]/route.ts`

Verification needed before deploy:

- Run `npm run build` in the Linux repo.
- Sign in on at least two phones, open the app once, then send a targeted test from `/admin/notifications`.
- Confirm the admin page reports non-zero `successCount` and both phones receive the OS banner instantly.
- Upload a playable direct movie and confirm the latest-upload push arrives immediately.
- Upload a queued/processing movie and confirm the push arrives only after the worker marks the source playable.

### Admin and Subscriber Premium Access Stabilization

Status: code changed locally, not deployed.

Purpose: stop admin accounts and active paid subscribers from being treated as free users after login, while navigating, or when opening movie playback.

Files changed:

- `src/lib/server/firebaseIdentity.ts`
- `src/app/api/auth/status/route.ts`
- `src/app/api/auth/me/route.ts`
- `src/app/api/subscriptions/me/route.ts`
- `src/lib/auth/status-client.ts`
- `src/lib/auth/client.ts`
- `src/lib/clientAccessState.ts`
- `src/app/movie/[id]/MovieClientPage.tsx`
- `src/app/api/movies/route.ts`
- `src/lib/server/contentAccess.ts`
- `src/lib/publicMovies.ts`
- `src/components/subscribe/SubscribeFlowProvider.tsx`

Verification needed before deploy:

- Run `npm run build` in the Linux repo.
- Test admin login, paid-user login, movie navigation, and opening several premium movies without subscription prompts.
- Confirm expired/free users are still asked to subscribe.
