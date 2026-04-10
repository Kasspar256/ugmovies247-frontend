# Auth Setup

This project now uses Firebase Authentication for end-user accounts and Firebase Admin session cookies for secure server-side route protection.

## Required Firebase Setup

In the Firebase console for this project:

1. Enable `Authentication`
2. Turn on the `Email/Password` provider
3. Add your production domain and local dev domain to the authorized domains list

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
