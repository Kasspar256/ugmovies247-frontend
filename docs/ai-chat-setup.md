# Unified AI Chat Setup

This integration keeps the Gemini API key on the server. The live app calls the secure Next.js server route at `/api/ai/chat`; the route uses Gemini 3.1 Flash-Lite, Neon pgvector when configured, and Firestore fallback search if Neon is unavailable.

## Required Environment

Add these to `.env.local` for dev and `.env.production` on the VPS:

```bash
GEMINI_API_KEY="your-gemini-api-key"
GEMINI_CHAT_MODEL="gemini-3.1-flash-lite"
GEMINI_EMBEDDING_MODEL="gemini-embedding-2"
GEMINI_EMBEDDING_DIMENSIONS="768"
NEON_DATABASE_URL="postgresql://user:password@ep-example.neon.tech/dbname?sslmode=require"
```

## Neon RAG Setup

The sync script creates the `vector` extension, creates `ai_movie_embeddings`, embeds Firestore movies, and upserts changed rows.

```bash
npm install
npm run ai:sync-movies
```

The script reads the same Firebase Admin env vars used by the app and syncs the current `movies__<environment>` collection.

To limit a first test run:

```bash
SYNC_AI_CATALOG_LIMIT=10 npm run ai:sync-movies
```

## Deployment

After the code is committed and pushed:

```bash
cd /home/ugmovies247/app
git pull --ff-only origin main
npm install
npm run ai:sync-movies
rm -rf .next
npm run build
pm2 restart ugmovies247-web --update-env
pm2 save
```

## Firebase Cloud Functions Note

The current production app is served from the VPS, so the working secure backend is the Next.js server route. If you later want Gemini traffic moved fully to Firebase Cloud Functions, use the same request/response contract from `/api/ai/chat` and deploy it as an HTTPS callable or request function. The UI will only need the endpoint URL swapped.

