#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');
const admin = require('firebase-admin');

loadEnvConfig(process.cwd());

const APPLY = process.argv.includes('--apply');
const MATURE_CATEGORY = 'Mature Exclusives (18+)';
const CONVERTED_STATUS = 'converted_to_series';
const TARGETS = [
  { title: 'Tubero', keys: ['tubero'] },
  { title: 'Home Service', keys: ['home service', 'homeservice'] },
  { title: 'Panibugho', keys: ['panibugho'] },
  { title: 'Taboo', keys: ['taboo'] },
];

function normalizeEnvironment(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'production' || normalized === 'prod') return 'production';
  if (normalized === 'staging' || normalized === 'stage') return 'staging';

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
  if (admin.apps.length) return;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: getRequiredEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: getRequiredEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

function isoNow() {
  return new Date().toISOString();
}

function normalizeComparableTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasMatureCategory(movie) {
  return Array.isArray(movie.category) &&
    movie.category.some(
      (category) => String(category || '').trim().toLowerCase() === MATURE_CATEGORY.toLowerCase()
    );
}

function getTargetForTitle(title) {
  const normalized = normalizeComparableTitle(title);

  for (const target of TARGETS) {
    for (const key of target.keys) {
      const normalizedKey = normalizeComparableTitle(key);

      if (normalized === normalizedKey) {
        return target;
      }

      if (normalized.startsWith(`${normalizedKey} `)) {
        const remainder = normalized.slice(normalizedKey.length).trim();

        if (/^(?:s\d+\s*)?(?:ep|episode|part)?\s*\d+\b/.test(remainder) || /^\d+\b/.test(remainder)) {
          return target;
        }
      }
    }
  }

  return null;
}

function getEpisodeNumber(title, fallback) {
  const rawTitle = String(title || '');
  const markerMatch = rawTitle.match(/\b(?:s\d+\s*)?(?:ep|episode|part)\s*(\d+)\b/i);

  if (markerMatch) {
    return Math.max(1, Math.round(Number(markerMatch[1]) || fallback));
  }

  const trailingMatch = rawTitle.match(/(\d+)\s*$/);

  if (trailingMatch) {
    return Math.max(1, Math.round(Number(trailingMatch[1]) || fallback));
  }

  return fallback;
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.toDate === 'function') {
    const parsed = value.toDate().getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

function stringifyForBackup(value) {
  return JSON.stringify(
    value,
    (_key, nestedValue) => {
      if (nestedValue && typeof nestedValue.toDate === 'function') {
        return nestedValue.toDate().toISOString();
      }

      return nestedValue;
    },
    2
  );
}

function uniqueStrings(...values) {
  const seen = new Set();
  const result = [];

  for (const value of values.flat()) {
    const text = String(value || '').trim();
    const key = text.toLowerCase();

    if (!text || seen.has(key)) continue;

    seen.add(key);
    result.push(text);
  }

  return result;
}

function toEpisode(movie, episodeNumber, fallbackTitle) {
  const videoUrl = String(movie.video_url || movie.sourceUrl || '').trim();
  const sourceUrl = String(movie.sourceUrl || movie.video_url || '').trim();
  const poster = String(movie.poster || movie.heroPoster || movie.overriddenPlayerBackdrop || '').trim();
  const description = String(movie.description || movie.overview || '').trim();

  return {
    episodeNumber,
    title: String(movie.title || fallbackTitle || `Episode ${episodeNumber}`),
    description,
    overview: description,
    video_url: videoUrl,
    poster,
    thumbnail: String(movie.thumbnail || poster || '').trim(),
    overriddenBackdrop: String(
      movie.overriddenBackdrop || movie.overriddenPlayerBackdrop || poster || ''
    ).trim(),
    episodeTrailerUrl: String(movie.trailerUrl || movie.trailer_url || '').trim(),
    sourceType: movie.sourceType || 'direct_upload',
    sourcePipeline: movie.sourcePipeline || 'direct_upload',
    sourceFileName:
      String(movie.sourceFileName || movie.file_name || '').trim() ||
      sourceUrl.split('/').pop() ||
      videoUrl.split('/').pop() ||
      '',
    sourceUrl: sourceUrl || videoUrl,
    jobStatus: movie.jobStatus || (videoUrl || sourceUrl ? 'ready' : 'failed'),
    processingProgress:
      typeof movie.processingProgress === 'number'
        ? movie.processingProgress
        : videoUrl || sourceUrl
          ? 100
          : 0,
    errorMessage: String(movie.errorMessage || ''),
    playbackType: movie.playbackType || 'mp4',
    masterPlaylistUrl: String(movie.masterPlaylistUrl || ''),
    availableRenditions: Array.isArray(movie.availableRenditions)
      ? movie.availableRenditions
      : [],
    durationSeconds:
      typeof movie.durationSeconds === 'number' && Number.isFinite(movie.durationSeconds)
        ? movie.durationSeconds
        : 0,
    videoResolution: movie.videoResolution || null,
    fileSizeBytes:
      typeof movie.fileSizeBytes === 'number' && Number.isFinite(movie.fileSizeBytes)
        ? movie.fileSizeBytes
        : 0,
    processedAt: String(movie.processedAt || ''),
    createdAt: String(movie.createdAt || movie.date_added || isoNow()),
    updatedAt: String(movie.updatedAt || isoNow()),
    accessTier: movie.accessTier === 'free' ? 'free' : 'premium',
    subscriptionRequired: movie.subscriptionRequired !== false,
    isLocked: movie.isLocked === true,
  };
}

function buildSeriesPayload({ group, existingSeries, seriesId, timestamp }) {
  const sortedEntries = [...group.entries].sort((left, right) => {
    if (left.episodeNumber !== right.episodeNumber) {
      return left.episodeNumber - right.episodeNumber;
    }

    return timestampMs(left.movie.createdAt || left.movie.date_added) -
      timestampMs(right.movie.createdAt || right.movie.date_added);
  });
  const primary = sortedEntries[0]?.movie || {};
  const episodesByNumber = new Map();

  for (const entry of sortedEntries) {
    episodesByNumber.set(
      entry.episodeNumber,
      toEpisode(entry.movie, entry.episodeNumber, `${group.title} ${entry.episodeNumber}`)
    );
  }

  const existingSeason = (existingSeries?.seasons || []).find(
    (season) => Number(season.seasonNumber) === 1
  );
  const existingOtherSeasons = (existingSeries?.seasons || []).filter(
    (season) => Number(season.seasonNumber) !== 1
  );
  const existingSeasonEpisodes = Array.isArray(existingSeason?.episodes)
    ? existingSeason.episodes.filter(
        (episode) => !episodesByNumber.has(Number(episode.episodeNumber))
      )
    : [];
  const episodes = [...existingSeasonEpisodes, ...episodesByNumber.values()].sort(
    (left, right) => Number(left.episodeNumber) - Number(right.episodeNumber)
  );
  const poster = String(existingSeries?.poster || primary.poster || primary.heroPoster || '').trim();
  const backdrop = String(
    existingSeries?.overriddenPlayerBackdrop ||
      existingSeries?.overriddenBackdrop ||
      primary.overriddenPlayerBackdrop ||
      primary.overriddenBackdrop ||
      poster ||
      ''
  ).trim();

  return {
    ...(existingSeries || {}),
    movieId: seriesId,
    contentType: 'series',
    title: group.title,
    original_title: String(existingSeries?.original_title || primary.original_title || group.title),
    name: group.title,
    overview: String(existingSeries?.overview || primary.overview || primary.description || ''),
    description: String(existingSeries?.description || primary.description || primary.overview || ''),
    language: String(existingSeries?.language || primary.language || ''),
    releaseYear:
      typeof existingSeries?.releaseYear === 'number'
        ? existingSeries.releaseYear
        : typeof primary.releaseYear === 'number'
          ? primary.releaseYear
          : null,
    tags: uniqueStrings(existingSeries?.tags || [], primary.tags || []),
    cast: uniqueStrings(existingSeries?.cast || [], primary.cast || []),
    poster,
    heroPoster: String(existingSeries?.heroPoster || primary.heroPoster || ''),
    overriddenBackdrop: String(existingSeries?.overriddenBackdrop || backdrop || ''),
    overriddenPlayerBackdrop: String(existingSeries?.overriddenPlayerBackdrop || backdrop || ''),
    genres: uniqueStrings(existingSeries?.genres || [], primary.genres || []),
    category: [MATURE_CATEGORY],
    vj: String(existingSeries?.vj || primary.vj || 'Unknown'),
    video_url: '',
    trailerUrl: String(existingSeries?.trailerUrl || primary.trailerUrl || ''),
    mainSeriesTrailerUrl: String(existingSeries?.mainSeriesTrailerUrl || primary.mainSeriesTrailerUrl || ''),
    trailer_url: String(existingSeries?.trailer_url || primary.trailer_url || ''),
    release_date: String(existingSeries?.release_date || primary.release_date || ''),
    date_added: String(existingSeries?.date_added || primary.date_added || primary.createdAt || timestamp),
    country: String(existingSeries?.country || primary.country || 'Unknown'),
    tmdb_id:
      typeof existingSeries?.tmdb_id === 'number'
        ? existingSeries.tmdb_id
        : typeof primary.tmdb_id === 'number'
          ? primary.tmdb_id
          : null,
    file_name: String(existingSeries?.file_name || ''),
    status: 'published',
    is_for_review: existingSeries?.is_for_review === true || primary.is_for_review === true,
    is_trending_tiktok:
      existingSeries?.is_trending_tiktok === true || primary.is_trending_tiktok === true,
    accessTier: primary.accessTier === 'free' ? 'free' : 'premium',
    subscriptionRequired: primary.subscriptionRequired !== false,
    isLocked: false,
    sourceType: 'direct_upload',
    sourcePipeline: 'direct_upload',
    sourceFileName: '',
    sourceUrl: '',
    jobStatus: episodes.length ? 'ready' : 'failed',
    processingProgress: episodes.length ? 100 : 0,
    errorMessage: '',
    playbackType: 'mp4',
    masterPlaylistUrl: '',
    availableRenditions: [],
    durationSeconds: 0,
    videoResolution: null,
    fileSizeBytes: 0,
    processedAt: String(existingSeries?.processedAt || ''),
    createdAt: String(existingSeries?.createdAt || timestamp),
    updatedAt: timestamp,
    seasons: [
      ...existingOtherSeasons,
      {
        seasonNumber: 1,
        title: existingSeason?.title || 'Season 1',
        overview: existingSeason?.overview || '',
        poster: existingSeason?.poster || poster,
        overriddenBackdrop: existingSeason?.overriddenBackdrop || backdrop || poster,
        tmdb_id: existingSeason?.tmdb_id || null,
        episodes,
      },
    ].sort((left, right) => Number(left.seasonNumber) - Number(right.seasonNumber)),
    matureSeriesRepair: {
      repairedAt: timestamp,
      repairedBy: 'scripts/repair-mature-split-series.js',
      baseTitle: group.title,
      sourceMovieIds: sortedEntries.map((entry) => entry.id),
    },
  };
}

function buildConvertedMovieUpdate(movie, seriesId, episodeNumber, timestamp) {
  const categories = Array.isArray(movie.category)
    ? movie.category.filter(
        (category) => String(category || '').trim().toLowerCase() !== MATURE_CATEGORY.toLowerCase()
      )
    : [];

  return {
    category: categories,
    status: CONVERTED_STATUS,
    convertedToSeriesId: seriesId,
    convertedEpisodeNumber: episodeNumber,
    convertedAt: timestamp,
    updatedAt: timestamp,
  };
}

async function writeBackup(payload) {
  const backupDirectory = path.join(process.cwd(), '.runtime-cache');
  const backupPath = path.join(
    backupDirectory,
    `mature-series-repair-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  await fs.mkdir(backupDirectory, { recursive: true });
  await fs.writeFile(backupPath, stringifyForBackup(payload), 'utf8');

  return backupPath;
}

async function updateRuntimeCache({ collectionName, seriesPayloads, convertedUpdates }) {
  const namespace = collectionName.replace(/^movies__/, '');
  const cachePath = path.join(process.cwd(), '.runtime-cache', `movies-catalog.${namespace}.json`);

  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const cache = JSON.parse(raw);
    const movies = Array.isArray(cache.movies) ? cache.movies : [];
    const convertedById = new Map(convertedUpdates.map((entry) => [entry.id, entry.update]));
    const seriesById = new Map(seriesPayloads.map((entry) => [entry.id, entry.payload]));
    const nextMovies = movies.map((movie) => {
      const id = String(movie.id || movie.movieId || '');

      if (convertedById.has(id)) {
        return {
          ...movie,
          ...convertedById.get(id),
        };
      }

      if (seriesById.has(id)) {
        return {
          id,
          ...seriesById.get(id),
        };
      }

      return movie;
    });

    for (const [id, payload] of seriesById.entries()) {
      if (!nextMovies.some((movie) => String(movie.id || movie.movieId || '') === id)) {
        nextMovies.unshift({ id, ...payload });
      }
    }

    await fs.writeFile(
      cachePath,
      JSON.stringify(
        {
          ...cache,
          movies: nextMovies,
          cachedAt: isoNow(),
          collectionName,
        },
        null,
        0
      ),
      'utf8'
    );

    return cachePath;
  } catch (error) {
    return `cache not updated (${error instanceof Error ? error.message : String(error)})`;
  }
}

async function main() {
  initializeFirebaseAdmin();

  const collectionName = getMoviesCollectionName();
  const db = admin.firestore();
  const snapshot = await db.collection(collectionName).get();
  const groups = new Map();

  for (const doc of snapshot.docs) {
    const movie = doc.data();
    const target = getTargetForTitle(movie.title || movie.name || movie.original_title);

    if (!target || movie.contentType === 'series' || !hasMatureCategory(movie)) {
      continue;
    }

    const episodeNumber = getEpisodeNumber(movie.title || movie.name || '', 1);
    const group = groups.get(target.title) || {
      title: target.title,
      entries: [],
    };

    group.entries.push({
      id: doc.id,
      movie,
      episodeNumber,
    });
    groups.set(target.title, group);
  }

  console.log(`Mature split-series repair ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Collection: ${collectionName}`);
  console.log(`Targets: ${TARGETS.map((target) => target.title).join(', ')}`);
  console.log('');

  if (!groups.size) {
    console.log('No matching Mature movie episode docs found.');
    return;
  }

  for (const group of groups.values()) {
    const episodes = group.entries
      .map((entry) => `${entry.episodeNumber}:${entry.movie.title || entry.id}`)
      .join(', ');
    console.log(`- ${group.title}: ${group.entries.length} docs -> ${episodes}`);
  }

  const backupPayload = {
    collectionName,
    generatedAt: isoNow(),
    apply: APPLY,
    groups: Array.from(groups.values()).map((group) => ({
      title: group.title,
      entries: group.entries.map((entry) => ({
        id: entry.id,
        episodeNumber: entry.episodeNumber,
        movie: entry.movie,
      })),
    })),
  };
  const backupPath = await writeBackup(backupPayload);
  console.log('');
  console.log(`Backup written: ${backupPath}`);

  if (!APPLY) {
    console.log('');
    console.log('Dry run only. Re-run with --apply after confirming the list above.');
    return;
  }

  const timestamp = isoNow();
  const seriesPayloads = [];
  const convertedUpdates = [];

  for (const group of groups.values()) {
    const existingSnapshot = await db.collection(collectionName).get();
    let existingSeries = null;

    for (const doc of existingSnapshot.docs) {
      const data = doc.data();

      if (
        data.contentType === 'series' &&
        hasMatureCategory(data) &&
        normalizeComparableTitle(data.title || data.name || data.original_title) ===
          normalizeComparableTitle(group.title)
      ) {
        existingSeries = {
          id: doc.id,
          data,
        };
        break;
      }
    }

    const seriesRef = existingSeries
      ? db.collection(collectionName).doc(existingSeries.id)
      : db.collection(collectionName).doc();
    const seriesPayload = buildSeriesPayload({
      group,
      existingSeries: existingSeries?.data || null,
      seriesId: seriesRef.id,
      timestamp,
    });
    const batch = db.batch();

    batch.set(seriesRef, seriesPayload, { merge: false });
    seriesPayloads.push({ id: seriesRef.id, payload: seriesPayload });

    for (const entry of group.entries) {
      const update = buildConvertedMovieUpdate(
        entry.movie,
        seriesRef.id,
        entry.episodeNumber,
        timestamp
      );

      batch.set(db.collection(collectionName).doc(entry.id), update, { merge: true });
      convertedUpdates.push({ id: entry.id, update });
    }

    await batch.commit();
    console.log(
      `Converted ${group.entries.length} ${group.title} movie docs into series ${seriesRef.id}.`
    );
  }

  const cacheResult = await updateRuntimeCache({
    collectionName,
    seriesPayloads,
    convertedUpdates,
  });

  console.log(`Runtime cache: ${cacheResult}`);
  console.log('Done. Restart the web process after this so in-memory catalog cache refreshes.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
