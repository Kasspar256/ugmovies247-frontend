# Pending Deploy Items

Keep this list as the holding area for fixes that are ready to ship later. Do not deploy these automatically; deploy only when Kasspar says "let's deploy" or explicitly asks for deployment commands.

## Pending

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
