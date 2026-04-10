# Firebase Dev / Prod Setup

This project is now ready to use two separate Firebase projects without changing the app architecture.

## What stays the same

- Same Next.js project
- Same routes and UI
- Same HLS pipeline
- Same direct upload pipeline
- Same Firestore structure

Only the environment values change.

## Practical model

- `development` app environment -> points to your **dev Firebase project**
- `production` app environment -> points to your **prod Firebase project**

That means:

- if dev gets throttled, prod users are still safe
- test data stays in dev
- real user data stays in prod

## How to tell which app you are looking at

The app now shows a small badge in non-production environments:

- `DEV your-dev-project`
- `STAGING your-staging-project`

Production can hide that badge.

## Step 1: Create the dev Firebase project

Create a second Firebase project, for example:

- `ugmovies247-dev`

In that dev project:

1. Enable **Authentication**
   - Email/Password
2. Create **Cloud Firestore**
3. Create the **Web App** config
4. Generate a **Service Account** key for server/admin routes
5. Apply the same Firestore rules
6. Apply the same Firestore indexes

## Step 2: Put dev config in `.env.local`

Copy values from `.env.dev.example` into your local `.env.local`.

Your local machine should point to the dev Firebase project.

## Step 3: Keep production envs separate

Your live server/domain should use the production Firebase values from `.env.prod.example`.

Do not copy dev Firebase values into production.

## Step 4: Restart after env changes

After changing env values:

1. stop the app
2. restart the Next.js server
3. restart the video worker if you use it

## Recommended separation

### Firebase

- local development -> dev Firebase
- live site -> prod Firebase

### R2

Safest:

- separate dev and prod buckets

Acceptable early-stage option:

- same bucket, different projects

If you keep one shared bucket, be careful with admin uploads and cleanup.

## What does not sync automatically

These do **not** automatically move from dev to prod:

- Firebase Auth users
- Firestore documents
- downloads/watchlist/likes data
- queued jobs

Code changes move when you deploy code.
Data stays inside the Firebase project where it was created.

## Safe workflow

1. Build and test in dev
2. Confirm login, uploads, playback, rules, and admin flows in dev
3. Deploy the same code to prod
4. Production uses production env values

## Why this is recommended

Without separation:

- testing can consume the same auth quota as real users
- test data mixes with live data
- risky rule/index experiments can affect everyone

With separation:

- dev can break without hurting users
- production stays cleaner and safer

## Minimum checklist for the new dev project

- Authentication enabled
- Firestore created
- Firestore rules applied
- Firestore indexes applied
- admin service account generated
- `.env.local` updated to dev values
- local app restarted

## Optional improvement later

If you want to go one step further later, use:

- `dev.yourdomain.com` -> dev deployment
- `yourdomain.com` -> production deployment

That makes the separation even clearer.
