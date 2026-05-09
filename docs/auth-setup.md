# Auth Setup

This project now uses Firebase Authentication for end-user accounts and Firebase Admin session cookies for secure server-side route protection.

## Required Firebase Setup

In the Firebase console for this project:

1. Enable `Authentication`
2. Turn on the `Email/Password` provider
3. Add your production domain and local dev domain to the authorized domains list
4. If you use Google sign-in in production, configure OAuth branding in Google Cloud so users see the UG Movies 247 app name, support email, privacy policy, and terms links on consent screens.

## Required Environment Variables

These values must exist in `.env.local` for both the Next.js app and server-side API/session routes:

```env
NEXT_PUBLIC_FIREBASE_API_KEY="..."
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="..."
NEXT_PUBLIC_FIREBASE_PROJECT_ID="..."
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="..."
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="..."
NEXT_PUBLIC_FIREBASE_APP_ID="..."

FIREBASE_CLIENT_EMAIL="firebase-adminsdk-...@your-project.iam.gserviceaccount.com"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
ADMIN_EMAILS="admin1@example.com,admin2@example.com"
```

## Google Sign-In Branding and Redirect Domain

This app reads the web auth domain from:

```env
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="..."
```

If that value is still set to the default Firebase project domain such as:

```env
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com"
```

users can see that Firebase-hosted domain during Google OAuth.

### Best production setup

For the most professional Google sign-in flow:

1. Use a branded auth domain such as `auth.ugmovies247.com` or the same custom domain that serves the app.
2. Add that domain to Firebase Authentication > Authorized domains.
3. Add the matching handler URL to Google OAuth redirect settings:

```text
https://auth.ugmovies247.com/__/auth/handler
```

4. Set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to that branded domain in production.
5. Configure Google Auth Platform / OAuth Branding with:
   - app name: `UG Movies 247`
   - support email
   - homepage
   - privacy policy URL
   - terms URL
   - logo

### If you are not hosting the app on Firebase Hosting

Firebase's auth helper still expects the reserved `/__/auth/*` paths. If your app is served from another stack, reverse-proxy:

```text
/__/auth/*
```

to:

```text
https://<firebase-project>.firebaseapp.com/__/auth/*
```

Then point `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to the branded domain that serves that proxied path.

### What cannot be fully hidden

Google controls parts of the Google Account chooser and consent UI. You can brand the app and replace the Firebase redirect domain with a custom auth domain, but you cannot fully redesign Google's own popup/consent chrome.

## How Admin Access Works

- Any authenticated account can use the normal streaming app
- Only accounts whose email appears in `ADMIN_EMAILS` are granted the `admin` role
- The admin role is stored in:
  - Firebase custom claims
  - the Firestore `users` document
  - the secure role cookie used for middleware hints

## Firestore User Records

Users are synced into the `users` collection on successful authenticated session creation.

Each user document includes:

- `id`
- `name`
- `email`
- `authProvider`
- `role`
- `createdAt`
- `updatedAt`
- `lastLoginAt`
- `isActive`
- `avatarUrl`
- `notificationPreferences`

## Protected App Areas

Unauthenticated users are redirected to login before reaching:

- home
- movie pages
- downloads
- watchlist
- profile
- search
- genres
- categories
- VJ pages

Admin routes are additionally role-protected.

## Notes

- The login page supports `Remember me`
  - checked: persistent login
  - unchecked: session-only browser login
- Password reset uses Firebase Auth email reset links
- Server route/API protection relies on the secure Firebase Admin session cookie, not on client-only auth state
