#!/usr/bin/env node

const crypto = require('node:crypto');
const { loadEnvConfig } = require('@next/env');
const admin = require('firebase-admin');
const { Pool } = require('pg');

loadEnvConfig(process.cwd());

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
const EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 768);
const SYNC_LIMIT = Number(process.env.SYNC_AI_CATALOG_LIMIT || 0);
const EMBED_DELAY_MS = Number(process.env.AI_SYNC_EMBED_DELAY_MS || 250);
const CLI_ARGS = new Set(process.argv.slice(2));
const SYNC_MODE = CLI_ARGS.has('--new')
  ? 'new'
  : String(process.env.AI_SYNC_MODE || 'changed').trim().toLowerCase();
const LOG_SKIPPED_MOVIES = String(process.env.AI_SYNC_LOG_SKIPPED || 'true').trim().toLowerCase() !== 'false';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEnvironment(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'production' || normalized === 'prod') {
    return 'production';
  }

  if (normalized === 'staging' || normalized === 'stage') {
    return 'staging';
  }

  return 'development';
}

function getMoviesCollectionName() {
  const namespace = normalizeEnvironment(
    process.env.FIRESTORE_ENV_NAMESPACE ||
      process.env.APP_ENV ||
      process.env.NEXT_PUBLIC_APP_ENV ||
      process.env.NODE_ENV
  );

  return `movies__${namespace}`;
}

function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();

  if (!value) {
    throw new Error(`Missing ${name}.`);
  }

  return value;
}

function initializeFirebaseAdmin() {
  if (admin.apps.length) {
    return;
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: getRequiredEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: getRequiredEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function normalizeUniqueArray(...values) {
  const seen = new Set();
  const normalized = [];

  for (const value of values.flatMap((entry) => normalizeArray(entry))) {
    const key = value.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(value);
  }

  return normalized;
}

function toVectorLiteral(values) {
  return `[${values.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}

function buildEmbeddingDocument(movie) {
  return [
    `title: ${movie.title || 'none'}`,
    `text: ${movie.description || movie.overview || 'No description available.'}`,
    movie.genres.length ? `genres: ${movie.genres.join(', ')}` : '',
    movie.vj ? `vj: ${movie.vj}` : '',
    movie.release_date ? `release date: ${movie.release_date}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

function sourceHash(movie) {
  return crypto.createHash('sha256').update(JSON.stringify(movie)).digest('hex');
}

function normalizeMovie(doc) {
  const data = doc.data() || {};

  return {
    movie_id: doc.id,
    title: String(data.title || data.name || 'Untitled movie').trim(),
    description: String(data.description || data.overview || '').trim(),
    genres: normalizeUniqueArray(data.genres, data.category).slice(0, 12),
    category: normalizeArray(data.category).slice(0, 12),
    poster: String(data.poster || '').trim(),
    release_date: String(data.release_date || '').trim(),
    vj: String(data.vj || '').trim(),
    country: String(data.country || '').trim(),
    is_trending_tiktok: data.is_trending_tiktok === true,
  };
}

async function createSchema(pool) {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`
    create table if not exists ai_movie_embeddings (
      movie_id text primary key,
      title text not null,
      description text,
      genres text[] not null default '{}',
      category text[] not null default '{}',
      poster text,
      release_date text,
      vj text,
      country text,
      is_trending_tiktok boolean not null default false,
      play_count integer not null default 0,
      source_hash text not null,
      embedding vector(${EMBEDDING_DIMENSIONS}) not null,
      embedding_dimensions integer not null default ${EMBEDDING_DIMENSIONS},
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query('alter table ai_movie_embeddings add column if not exists play_count integer not null default 0');
  await pool.query("alter table ai_movie_embeddings add column if not exists category text[] not null default '{}'");
  await pool.query('alter table ai_movie_embeddings add column if not exists country text');
  await pool.query('alter table ai_movie_embeddings add column if not exists is_trending_tiktok boolean not null default false');
  await pool.query(`
    create index if not exists ai_movie_embeddings_embedding_idx
      on ai_movie_embeddings
      using ivfflat (embedding vector_cosine_ops)
      with (lists = 100)
  `);
  await pool.query(`
    create index if not exists ai_movie_embeddings_play_count_idx
      on ai_movie_embeddings (play_count desc)
  `);
}

async function readExistingHashes(pool) {
  const result = await pool.query('select movie_id, source_hash from ai_movie_embeddings');
  return new Map(result.rows.map((row) => [row.movie_id, row.source_hash]));
}

async function readExistingMovieIds(pool) {
  const result = await pool.query('select movie_id from ai_movie_embeddings');
  return new Set(result.rows.map((row) => String(row.movie_id || '').trim()).filter(Boolean));
}

async function embedMovie(movie) {
  const apiKey = getRequiredEnv('GEMINI_API_KEY');
  const documentText = buildEmbeddingDocument(movie);
  const body =
    EMBEDDING_MODEL === 'gemini-embedding-2'
      ? {
          model: `models/${EMBEDDING_MODEL}`,
          content: {
            parts: [{ text: documentText }],
          },
          output_dimensionality: EMBEDDING_DIMENSIONS,
        }
      : {
          taskType: 'RETRIEVAL_DOCUMENT',
          content: {
            parts: [{ text: documentText }],
          },
          output_dimensionality: EMBEDDING_DIMENSIONS,
        };

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`${GEMINI_API_BASE_URL}/${EMBEDDING_MODEL}:embedContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));

    if (response.ok) {
      const values = payload.embedding?.values || payload.embeddings?.[0]?.values;

      if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Unexpected embedding dimensions for ${movie.movie_id}.`);
      }

      return values;
    }

    if (response.status === 429 && attempt < 4) {
      await sleep(1000 * attempt);
      continue;
    }

    throw new Error(payload.error?.message || `Embedding failed for ${movie.movie_id}.`);
  }

  throw new Error(`Embedding failed for ${movie.movie_id}.`);
}

async function upsertMovie(pool, movie, embedding, hash) {
  await pool.query(
    `
      insert into ai_movie_embeddings (
        movie_id,
        title,
        description,
        genres,
        category,
        poster,
        release_date,
        vj,
        country,
        is_trending_tiktok,
        source_hash,
        embedding,
        embedding_dimensions,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::vector, $13, now())
      on conflict (movie_id) do update set
        title = excluded.title,
        description = excluded.description,
        genres = excluded.genres,
        category = excluded.category,
        poster = excluded.poster,
        release_date = excluded.release_date,
        vj = excluded.vj,
        country = excluded.country,
        is_trending_tiktok = excluded.is_trending_tiktok,
        source_hash = excluded.source_hash,
        embedding = excluded.embedding,
        embedding_dimensions = excluded.embedding_dimensions,
        updated_at = now()
    `,
    [
      movie.movie_id,
      movie.title,
      movie.description,
      movie.genres,
      movie.category,
      movie.poster,
      movie.release_date,
      movie.vj,
      movie.country,
      movie.is_trending_tiktok,
      hash,
      toVectorLiteral(embedding),
      EMBEDDING_DIMENSIONS,
    ]
  );
}

async function main() {
  getRequiredEnv('NEON_DATABASE_URL');
  getRequiredEnv('GEMINI_API_KEY');
  initializeFirebaseAdmin();

  const pool = new Pool({
    connectionString: process.env.NEON_DATABASE_URL,
    max: 3,
    ssl: String(process.env.NEON_DATABASE_URL).includes('sslmode=disable')
      ? undefined
      : { rejectUnauthorized: false },
  });

  try {
    await createSchema(pool);
    console.log(`[ai-sync] mode=${SYNC_MODE === 'new' ? 'new-only' : 'changed-or-new'}`);
    console.log(`[ai-sync] embedding model=${EMBEDDING_MODEL}, dimensions=${EMBEDDING_DIMENSIONS}`);
    const existingHashes = await readExistingHashes(pool);
    const existingMovieIds = await readExistingMovieIds(pool);
    const snapshot = await admin.firestore().collection(getMoviesCollectionName()).get();
    const movies = snapshot.docs.map(normalizeMovie).filter((movie) => movie.title && movie.movie_id);
    const selectedMovies = SYNC_LIMIT > 0 ? movies.slice(0, SYNC_LIMIT) : movies;
    let synced = 0;
    let skipped = 0;

    for (const movie of selectedMovies) {
      if (SYNC_MODE === 'new' && existingMovieIds.has(movie.movie_id)) {
        skipped += 1;

        if (LOG_SKIPPED_MOVIES) {
          console.log(`[ai-sync] Skipping ${movie.movie_id} - already synced`);
        }

        continue;
      }

      const hash = sourceHash(movie);

      if (existingHashes.get(movie.movie_id) === hash) {
        skipped += 1;

        if (LOG_SKIPPED_MOVIES) {
          console.log(`[ai-sync] Skipping ${movie.movie_id} - already synced`);
        }

        continue;
      }

      const embedding = await embedMovie(movie);
      await upsertMovie(pool, movie, embedding, hash);
      existingMovieIds.add(movie.movie_id);
      existingHashes.set(movie.movie_id, hash);
      synced += 1;
      console.log(`[ai-sync] synced ${movie.movie_id}: ${movie.title}`);
      await sleep(EMBED_DELAY_MS);
    }

    console.log(`[ai-sync] complete. Synced ${synced}, skipped ${skipped}, scanned ${selectedMovies.length}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[ai-sync] failed', error);
  process.exit(1);
});
