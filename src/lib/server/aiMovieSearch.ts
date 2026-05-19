import { adminDb } from '@/lib/firebaseAdmin';
import { isAppInReview } from '@/lib/appReview';
import { AUTO_HOME_ROW_CONFIG, HOME_PAGE_CATEGORY_CONFIG } from '@/lib/homeCategories';
import { VJ_DIRECTORY } from '@/config/constants';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import { isIndianCatalogMovie } from '@/lib/regionalCatalog';
import { createGeminiEmbedding, getGeminiEmbeddingDimensions } from '@/lib/server/aiGemini';
import type { AuthSession } from '@/lib/auth/server';
import type { Movie } from '@/types/movie';
import type { SubscriptionSnapshot } from '@/types/subscriptions';

type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

type PgModule = {
  Pool?: new (config: Record<string, unknown>) => PgPool;
  default?: {
    Pool?: new (config: Record<string, unknown>) => PgPool;
  };
};

export type AiMovieCandidate = {
  id: string;
  title: string;
  description: string;
  genres: string[];
  category: string[];
  poster: string;
  release_date: string;
  vj: string;
  country?: string;
  isTrendingTikTok?: boolean;
  score?: number;
  playCount?: number;
  trendingRank?: number;
};

export type AiTrendingVj = {
  name: string;
  route: string;
  trendingRank: number;
  movieSamples: Array<{
    movieID: string;
    title: string;
  }>;
};

export type AiTrendingHomeCategory = {
  title: string;
  categoryKey: string;
  route: string;
  movies: Array<{
    movieID: string;
    title: string;
    vj: string;
    genres: string[];
  }>;
};

type NormalizedTrendingVj = AiTrendingVj & {
  totalPlays: number;
};

export type AiUserProfileContext =
  | {
      signedIn: true;
      email: string;
      name: string;
      role: string;
      joinedAt: string;
      emailVerified: boolean;
      firebaseAuth?: {
        email: string;
        emailVerified: boolean;
        disabled: boolean;
        metadata: {
          creationTime: string;
          lastSignInTime: string;
          lastRefreshTime: string;
        };
        providerIds: string[];
      };
      subscription: {
        isActive: boolean;
        status: string;
        planName: string;
        expiresAt: string;
      };
    }
  | {
      signedIn: false;
    };

declare global {
  // eslint-disable-next-line no-var
  var __ugmoviesAiPgPool: PgPool | undefined;
}

let ensuredRuntimeSchema = false;

async function ensureAiCatalogRuntimeSchema(pool: PgPool) {
  if (ensuredRuntimeSchema) {
    return;
  }

  await pool.query('alter table ai_movie_embeddings add column if not exists play_count integer not null default 0');
  await pool.query("alter table ai_movie_embeddings add column if not exists category text[] not null default '{}'");
  await pool.query('alter table ai_movie_embeddings add column if not exists country text');
  await pool.query('alter table ai_movie_embeddings add column if not exists is_trending_tiktok boolean not null default false');
  await pool.query('create index if not exists ai_movie_embeddings_play_count_idx on ai_movie_embeddings (play_count desc)');
  ensuredRuntimeSchema = true;
}

function getNeonDatabaseUrl() {
  return String(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '').trim();
}

async function loadPgPoolConstructor() {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<PgModule>;
  const pgModule = await dynamicImport('pg');
  const PoolConstructor = pgModule.Pool || pgModule.default?.Pool;

  if (!PoolConstructor) {
    throw new Error('The pg package is installed but did not expose Pool.');
  }

  return PoolConstructor;
}

async function getPool() {
  const connectionString = getNeonDatabaseUrl();

  if (!connectionString) {
    return null;
  }

  if (!globalThis.__ugmoviesAiPgPool) {
    const PoolConstructor = await loadPgPoolConstructor();
    globalThis.__ugmoviesAiPgPool = new PoolConstructor({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: connectionString.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
    });
  }

  return globalThis.__ugmoviesAiPgPool;
}

function toVectorLiteral(values: number[]) {
  return `[${values.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function normalizeMovieCandidate(raw: Record<string, unknown>): AiMovieCandidate {
  return {
    id: String(raw.movie_id || raw.movieID || raw.movieId || raw.id || '').trim(),
    title: String(raw.title || raw.name || 'Untitled movie').trim(),
    description: String(raw.description || raw.overview || '').trim().slice(0, 900),
    genres: normalizeStringArray(raw.genres || raw.category).slice(0, 6),
    category: normalizeStringArray(raw.category).slice(0, 10),
    poster: String(raw.poster || '').trim(),
    release_date: String(raw.release_date || '').trim(),
    vj: String(raw.vj || '').trim(),
    country: String(raw.country || '').trim(),
    isTrendingTikTok: raw.is_trending_tiktok === true || raw.isTrendingTikTok === true,
    score: typeof raw.score === 'number' ? raw.score : undefined,
    playCount: Number.isFinite(Number(raw.play_count || raw.playCount))
      ? Number(raw.play_count || raw.playCount)
      : 0,
    trendingRank: Number.isFinite(Number(raw.trending_rank || raw.trendingRank))
      ? Number(raw.trending_rank || raw.trendingRank)
      : undefined,
  };
}

function normalizeVjKey(value: string) {
  return value
    .toLowerCase()
    .replace(/^vj\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugifyHomeSection(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeCatalogLabel(value: string) {
  return slugifyHomeSection(String(value || '').trim());
}

function getMovieMetadataLabels(movie: AiMovieCandidate) {
  return new Set(
    [...(movie.category || []), ...(movie.genres || [])]
      .map((entry) => normalizeCatalogLabel(entry))
      .filter(Boolean)
  );
}

function hasCatalogLabel(movie: AiMovieCandidate, ...labels: string[]) {
  const metadataLabels = getMovieMetadataLabels(movie);

  return labels.some((label) => metadataLabels.has(normalizeCatalogLabel(label)));
}

function hasHomeCategory(movie: AiMovieCandidate, category: string) {
  return (movie.category || []).some(
    (entry) => normalizeCatalogLabel(entry) === normalizeCatalogLabel(category)
  );
}

function hasVj(movie: AiMovieCandidate, ...names: string[]) {
  const normalizedVj = (movie.vj || '').toLowerCase();

  return names.some((name) => normalizedVj.includes(name.toLowerCase()));
}

function matchesAutoHomeRow(movie: AiMovieCandidate, rowKey: string) {
  switch (rowKey) {
    case 'vj-junior':
      return hasVj(movie, 'junior');
    case 'vj-emmy':
      return hasVj(movie, 'emmy');
    case 'vj-ulio':
      return hasVj(movie, 'ulio');
    case 'vj-soul':
      return hasVj(movie, 'soul');
    case 'vj-jingo':
      return hasVj(movie, 'jingo');
    case 'omutaka-ice-p':
      return hasVj(movie, 'ice p', 'omutaka ice p');
    case 'animations':
      return hasCatalogLabel(movie, 'animation', 'animations');
    case 'action-thriller':
      return hasCatalogLabel(movie, 'action', 'thriller', 'crime', 'detective', 'mystery');
    case 'romance':
      return hasCatalogLabel(movie, 'romance');
    case 'comedy':
      return hasCatalogLabel(movie, 'comedy');
    case 'horror':
      return hasCatalogLabel(movie, 'horror');
    case 'adventure':
      return hasCatalogLabel(movie, 'adventure');
    case 'indian-movies':
      return isIndianCatalogMovie(movie);
    default:
      return false;
  }
}

function buildTrendingHomeCategoriesFromMovies(movies: AiMovieCandidate[], rowsLimit: number, moviesPerRow: number) {
  const manualRows = HOME_PAGE_CATEGORY_CONFIG.map((category) => {
    const categoryKey = slugifyHomeSection(category.name);
    const rowMovies =
      category.name.toLowerCase() === 'trending on tiktok'
        ? movies.filter((movie) => movie.isTrendingTikTok || hasHomeCategory(movie, category.name))
        : movies.filter((movie) => hasHomeCategory(movie, category.name));

    return {
      title: category.displayLabel,
      categoryKey,
      route: `/browse/${categoryKey}`,
      sortOrder: category.homeOrder,
      movies: rowMovies.slice(0, moviesPerRow),
    };
  });
  const autoRows = AUTO_HOME_ROW_CONFIG.map((row) => {
    const categoryKey = slugifyHomeSection(row.title);

    return {
      title: row.title,
      categoryKey,
      route: `/browse/${categoryKey}`,
      sortOrder: row.order,
      movies: movies.filter((movie) => matchesAutoHomeRow(movie, categoryKey)).slice(0, moviesPerRow),
    };
  });

  return [...manualRows, ...autoRows]
    .filter((row) => row.movies.length > 0)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .slice(0, rowsLimit)
    .map((row) => ({
      title: row.title,
      categoryKey: row.categoryKey,
      route: row.route,
      movies: row.movies.map((movie) => ({
        movieID: movie.id,
        title: movie.title,
        vj: movie.vj,
        genres: movie.genres,
      })),
    }));
}

function resolveVjRoute(name: string) {
  const key = normalizeVjKey(name);
  const match = VJ_DIRECTORY.find((vj) => normalizeVjKey(vj.name) === key);

  return match ? `/vjs/${match.id}` : '/vjs';
}

function normalizeTrendingVj(raw: Record<string, unknown>): NormalizedTrendingVj | null {
  const name = String(raw.vj || raw.name || '').trim();

  if (!name) {
    return null;
  }

  const sampleCandidates = raw.movie_samples || raw.movieSamples;
  const rawSamples: unknown[] = Array.isArray(sampleCandidates) ? sampleCandidates : [];

  return {
    name: /^vj\s+/i.test(name) ? name : `VJ ${name}`,
    route: resolveVjRoute(name),
    totalPlays: Number.isFinite(Number(raw.total_plays || raw.totalPlays))
      ? Number(raw.total_plays || raw.totalPlays)
      : 0,
    trendingRank: Number.isFinite(Number(raw.trending_rank || raw.trendingRank))
      ? Number(raw.trending_rank || raw.trendingRank)
      : 0,
    movieSamples: rawSamples
      .map((sample) => {
        const item = sample as Record<string, unknown>;

        return {
          movieID: String(item.movieID || item.movie_id || item.movieId || '').trim(),
          title: String(item.title || '').trim(),
        };
      })
      .filter((sample) => sample.movieID && sample.title)
      .slice(0, 3),
  };
}

function mergeTrendingVjs(vjs: NormalizedTrendingVj[], limit: number): AiTrendingVj[] {
  const merged = new Map<string, NormalizedTrendingVj>();

  for (const vj of vjs) {
    const key = normalizeVjKey(vj.name);
    const current = merged.get(key);

    if (!current) {
      merged.set(key, { ...vj, movieSamples: [...vj.movieSamples] });
      continue;
    }

    current.totalPlays += vj.totalPlays;

    for (const sample of vj.movieSamples) {
      if (
        current.movieSamples.length < 3 &&
        !current.movieSamples.some((existing) => existing.movieID === sample.movieID)
      ) {
        current.movieSamples.push(sample);
      }
    }
  }

  return Array.from(merged.values())
    .sort((left, right) => right.totalPlays - left.totalPlays)
    .slice(0, limit)
    .map((vj, index) => ({
      name: vj.name,
      route: vj.route,
      trendingRank: index + 1,
      movieSamples: vj.movieSamples,
    }));
}

export function buildMovieEmbeddingDocument(movie: Pick<Movie, 'title' | 'description' | 'overview' | 'genres' | 'vj' | 'release_date'>) {
  return [
    `title: ${movie.title || 'none'}`,
    `text: ${movie.description || movie.overview || 'No description available.'}`,
    movie.genres?.length ? `genres: ${movie.genres.join(', ')}` : '',
    movie.vj ? `vj: ${movie.vj}` : '',
    movie.release_date ? `release date: ${movie.release_date}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

async function searchNeonMovies(query: string, limit: number) {
  const pool = await getPool();

  if (!pool) {
    return [];
  }

  await ensureAiCatalogRuntimeSchema(pool);

  const embedding = await createGeminiEmbedding(query, 'query');

  if (!embedding?.length) {
    return [];
  }

  const result = await pool.query(
    `
      select
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
        play_count,
        1 - (embedding <=> $1::vector) as score
      from ai_movie_embeddings
      where embedding_dimensions = $3
      order by embedding <=> $1::vector
      limit $2
    `,
    [toVectorLiteral(embedding), limit, getGeminiEmbeddingDimensions()]
  );

  return result.rows.map((row) => normalizeMovieCandidate(row)).filter((movie) => movie.id);
}

async function getTrendingNeonMovies(limit: number) {
  const pool = await getPool();

  if (!pool) {
    return [];
  }

  await ensureAiCatalogRuntimeSchema(pool);

  const result = await pool.query(
    `
      select
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
        play_count,
        row_number() over (order by play_count desc, updated_at desc) as trending_rank
      from ai_movie_embeddings
      where play_count > 0
      order by play_count desc, updated_at desc
      limit $1
    `,
    [limit]
  );

  return result.rows.map((row) => normalizeMovieCandidate(row)).filter((movie) => movie.id);
}

async function getStaticNeonCatalogMovies(limit: number) {
  const pool = await getPool();

  if (!pool) {
    return [];
  }

  await ensureAiCatalogRuntimeSchema(pool);

  const result = await pool.query(
    `
      select
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
        play_count,
        row_number() over (order by play_count desc, updated_at desc) as trending_rank
      from ai_movie_embeddings
      order by play_count desc, updated_at desc
      limit $1
    `,
    [limit]
  );

  return result.rows.map((row) => normalizeMovieCandidate(row)).filter((movie) => movie.id);
}

async function getTrendingNeonHomeCategories(rowsLimit: number, moviesPerRow: number) {
  const pool = await getPool();

  if (!pool) {
    return [];
  }

  await ensureAiCatalogRuntimeSchema(pool);

  const result = await pool.query(
    `
      select
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
        play_count
      from ai_movie_embeddings
      where play_count > 0
      order by play_count desc, updated_at desc
      limit $1
    `,
    [Math.max(rowsLimit * moviesPerRow * 8, 180)]
  );
  const movies = result.rows.map((row) => normalizeMovieCandidate(row)).filter((movie) => movie.id);

  return buildTrendingHomeCategoriesFromMovies(movies, rowsLimit, moviesPerRow);
}

async function getTrendingNeonVjs(limit: number) {
  const pool = await getPool();

  if (!pool) {
    return [];
  }

  await ensureAiCatalogRuntimeSchema(pool);

  const result = await pool.query(
    `
      with vj_rankings as (
        select
          trim(vj) as vj,
          sum(play_count) as total_plays,
          max(updated_at) as last_activity,
          jsonb_agg(
            jsonb_build_object(
              'movieID', movie_id,
              'title', title
            )
            order by play_count desc, updated_at desc
          ) as movie_samples
        from ai_movie_embeddings
        where play_count > 0
          and nullif(trim(vj), '') is not null
        group by trim(vj)
      )
      select
        vj,
        total_plays,
        movie_samples,
        row_number() over (order by total_plays desc, last_activity desc) as trending_rank
      from vj_rankings
      order by total_plays desc, last_activity desc
      limit $1
    `,
    [Math.max(limit * 5, 25)]
  );

  return mergeTrendingVjs(
    result.rows
      .map((row) => normalizeTrendingVj(row))
      .filter(Boolean) as NormalizedTrendingVj[],
    limit
  );
}

export async function recordAiMoviePlay(movieId: string) {
  const normalizedMovieId = movieId.trim();

  if (!normalizedMovieId || isAppInReview) {
    return;
  }

  const pool = await getPool();

  if (!pool) {
    return;
  }

  await ensureAiCatalogRuntimeSchema(pool);
  await pool.query(
    `
      update ai_movie_embeddings
      set play_count = play_count + 1,
          updated_at = now()
      where movie_id = $1
    `,
    [normalizedMovieId]
  );
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function scoreMovie(query: string, movie: AiMovieCandidate) {
  const queryTokens = tokenize(query);
  const haystack = [
    movie.title,
    movie.description,
    movie.genres.join(' '),
    movie.vj,
    movie.release_date,
  ]
    .join(' ')
    .toLowerCase();

  if (!queryTokens.length) {
    return 0;
  }

  return queryTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

async function searchFirestoreMovies(query: string, limit: number) {
  const collection = adminDb.collection(MOVIES_COLLECTION);
  const snapshot = await (isAppInReview
    ? collection.where('is_for_review', '==', true).limit(180).get()
    : collection.limit(250).get());
  const movies = snapshot.docs
    .map((doc) => normalizeMovieCandidate({ id: doc.id, ...doc.data() }))
    .filter((movie) => movie.id);
  const scoredMovies = movies
    .map((movie) => ({ ...movie, score: scoreMovie(query, movie) }))
    .sort((left, right) => (right.score || 0) - (left.score || 0));
  const matches = scoredMovies.filter((movie) => (movie.score || 0) > 0);

  return (matches.length ? matches : scoredMovies).slice(0, limit);
}

async function getTrendingFirestoreMovies(limit: number) {
  const collection = adminDb.collection(MOVIES_COLLECTION);
  const snapshot = await (isAppInReview
    ? collection.where('is_for_review', '==', true).limit(180).get()
    : collection.limit(250).get());

  return snapshot.docs
    .map((doc) => normalizeMovieCandidate({ id: doc.id, ...doc.data() }))
    .filter((movie) => movie.id)
    .sort((left, right) => (right.playCount || 0) - (left.playCount || 0))
    .slice(0, limit)
    .map((movie, index) => ({
      ...movie,
      trendingRank: index + 1,
    }));
}

async function getStaticFirestoreCatalogMovies(limit: number) {
  const collection = adminDb.collection(MOVIES_COLLECTION);
  const snapshot = await (isAppInReview
    ? collection.where('is_for_review', '==', true).limit(Math.min(limit, 250)).get()
    : collection.limit(Math.min(limit, 500)).get());

  return snapshot.docs
    .map((doc) => normalizeMovieCandidate({ id: doc.id, ...doc.data() }))
    .filter((movie) => movie.id)
    .sort((left, right) => (right.playCount || 0) - (left.playCount || 0))
    .slice(0, limit)
    .map((movie, index) => ({
      ...movie,
      trendingRank: index + 1,
    }));
}

async function getTrendingFirestoreVjs(limit: number) {
  const movies = await getTrendingFirestoreMovies(250);
  const vjMap = new Map<
    string,
    {
      name: string;
      total: number;
      movieSamples: AiTrendingVj['movieSamples'];
    }
  >();

  for (const movie of movies) {
    if (!movie.vj) {
      continue;
    }

    const key = normalizeVjKey(movie.vj);
    const current = vjMap.get(key) || {
      name: /^vj\s+/i.test(movie.vj) ? movie.vj : `VJ ${movie.vj}`,
      total: 0,
      movieSamples: [],
    };

    current.total += movie.playCount || 0;

    if (current.movieSamples.length < 3) {
      current.movieSamples.push({
        movieID: movie.id,
        title: movie.title,
      });
    }

    vjMap.set(key, current);
  }

  return Array.from(vjMap.values())
    .filter((vj) => vj.total > 0)
    .sort((left, right) => right.total - left.total)
    .slice(0, limit)
    .map((vj, index) => ({
      name: vj.name,
      route: resolveVjRoute(vj.name),
      trendingRank: index + 1,
      movieSamples: vj.movieSamples,
    }));
}

async function getTrendingFirestoreHomeCategories(rowsLimit: number, moviesPerRow: number) {
  const movies = await getTrendingFirestoreMovies(Math.max(rowsLimit * moviesPerRow * 8, 180));

  return buildTrendingHomeCategoriesFromMovies(movies, rowsLimit, moviesPerRow);
}

export async function getAiMovieCandidates(query: string, limit = 8) {
  if (isAppInReview) {
    return searchFirestoreMovies(query, limit);
  }

  try {
    const neonMovies = await searchNeonMovies(query, limit);

    if (neonMovies.length) {
      return neonMovies;
    }
  } catch (error) {
    console.warn('[ai-chat] Neon movie search failed, falling back to Firestore', error);
  }

  return searchFirestoreMovies(query, limit);
}

export async function getAiTrendingMovieCandidates(limit = 6) {
  if (isAppInReview) {
    return getTrendingFirestoreMovies(limit);
  }

  try {
    const neonMovies = await getTrendingNeonMovies(limit);

    if (neonMovies.length) {
      return neonMovies;
    }
  } catch (error) {
    console.warn('[ai-chat] Neon trending movie read failed, falling back to Firestore', error);
  }

  return getTrendingFirestoreMovies(limit);
}

export async function getAiStaticCatalogCandidates(limit = Number(process.env.GEMINI_STATIC_CATALOG_LIMIT || 250)) {
  const normalizedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 600) : 250;

  if (isAppInReview) {
    return getStaticFirestoreCatalogMovies(normalizedLimit);
  }

  try {
    const neonMovies = await getStaticNeonCatalogMovies(normalizedLimit);

    if (neonMovies.length) {
      return neonMovies;
    }
  } catch (error) {
    console.warn('[ai-chat] Neon static catalog read failed, falling back to Firestore', error);
  }

  return getStaticFirestoreCatalogMovies(normalizedLimit);
}

export async function getAiTrendingVjCandidates(limit = 6) {
  if (isAppInReview) {
    return getTrendingFirestoreVjs(limit);
  }

  try {
    const neonVjs = await getTrendingNeonVjs(limit);

    if (neonVjs.length) {
      return neonVjs;
    }
  } catch (error) {
    console.warn('[ai-chat] Neon trending VJ read failed, falling back to Firestore', error);
  }

  return getTrendingFirestoreVjs(limit);
}

export async function getAiTrendingHomeCategoryCandidates(rowsLimit = 10, moviesPerRow = 3) {
  if (isAppInReview) {
    return getTrendingFirestoreHomeCategories(rowsLimit, moviesPerRow);
  }

  try {
    const neonRows = await getTrendingNeonHomeCategories(rowsLimit, moviesPerRow);

    if (neonRows.length) {
      return neonRows;
    }
  } catch (error) {
    console.warn('[ai-chat] Neon trending home category read failed, falling back to Firestore', error);
  }

  return getTrendingFirestoreHomeCategories(rowsLimit, moviesPerRow);
}

export function buildAiUserProfileContext(
  session: AuthSession | null,
  subscriptionSnapshot?: SubscriptionSnapshot | null,
  firebaseAuthUser?: {
    email?: string;
    emailVerified?: boolean;
    disabled?: boolean;
    metadata?: {
      creationTime?: string | null;
      lastSignInTime?: string | null;
      lastRefreshTime?: string | null;
    };
    providerData?: Array<{ providerId?: string }>;
  } | null
): AiUserProfileContext {
  if (!session) {
    return { signedIn: false };
  }

  const subscription = subscriptionSnapshot || session.userRecord.subscription;

  return {
    signedIn: true,
    email: session.email,
    name: session.name || session.userRecord.name,
    role: session.role,
    joinedAt: session.userRecord.createdAt,
    emailVerified:
      firebaseAuthUser?.emailVerified === true || session.userRecord.emailVerified === true,
    firebaseAuth: {
      email: firebaseAuthUser?.email || session.email,
      emailVerified:
        firebaseAuthUser?.emailVerified === true || session.userRecord.emailVerified === true,
      disabled: firebaseAuthUser?.disabled === true,
      metadata: {
        creationTime: String(firebaseAuthUser?.metadata?.creationTime || session.userRecord.createdAt || ''),
        lastSignInTime: String(firebaseAuthUser?.metadata?.lastSignInTime || session.userRecord.lastLoginAt || ''),
        lastRefreshTime: String(firebaseAuthUser?.metadata?.lastRefreshTime || ''),
      },
      providerIds: Array.isArray(firebaseAuthUser?.providerData)
        ? firebaseAuthUser.providerData
            .map((provider) => String(provider.providerId || '').trim())
            .filter(Boolean)
        : [],
    },
    subscription: {
      isActive: subscription?.isActive === true,
      status: String(subscription?.status || 'free'),
      planName: String(subscription?.planName || ''),
      expiresAt: String(subscription?.expiresAt || ''),
    },
  };
}
