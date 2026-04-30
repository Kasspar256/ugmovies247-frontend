#!/usr/bin/env node

const { loadEnvConfig } = require('@next/env');
const admin = require('firebase-admin');
const trailerMappings = require('../src/lib/reviewTrailerData.json');

loadEnvConfig(process.cwd());

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

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getTimestamp(movie) {
  const candidate = movie.date_added || movie.updatedAt || movie.createdAt || '';
  const timestamp = candidate ? new Date(candidate).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getMovieTitleCandidates(movie) {
  return [
    movie.title,
    movie.name,
    movie.original_title,
    movie.file_name,
    movie.sourceFileName,
  ]
    .map(normalizeTitle)
    .filter(Boolean);
}

function getMappingCandidates(mapping) {
  return [mapping.title, ...(mapping.aliases || [])].map(normalizeTitle).filter(Boolean);
}

function findMovieForMapping(movies, mapping, usedMovieIds) {
  const mappingCandidates = getMappingCandidates(mapping);
  const availableMovies = movies.filter((movie) => !usedMovieIds.has(movie.id));
  const exactMatches = availableMovies.filter((movie) => {
    const titleCandidates = getMovieTitleCandidates(movie);
    return mappingCandidates.some((candidate) => titleCandidates.includes(candidate));
  });

  if (exactMatches.length) {
    return exactMatches.sort((left, right) => getTimestamp(right) - getTimestamp(left))[0];
  }

  const partialMatches = availableMovies.filter((movie) => {
    const titleCandidates = getMovieTitleCandidates(movie);
    return mappingCandidates.some((mappingCandidate) =>
      titleCandidates.some((titleCandidate) => titleCandidate.includes(mappingCandidate))
    );
  });

  return partialMatches.sort((left, right) => getTimestamp(right) - getTimestamp(left))[0] || null;
}

function initializeFirebaseAdmin() {
  if (admin.apps.length) {
    return;
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  initializeFirebaseAdmin();

  const collectionName = getMoviesCollectionName();
  const db = admin.firestore();
  const snapshot = await db.collection(collectionName).get();
  const movies = snapshot.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    ...doc.data(),
  }));
  const usedMovieIds = new Set();
  const matched = [];
  const unmatched = [];

  for (const mapping of trailerMappings) {
    const movie = findMovieForMapping(movies, mapping, usedMovieIds);

    if (!movie) {
      unmatched.push(mapping.title);
      continue;
    }

    usedMovieIds.add(movie.id);
    matched.push({
      id: movie.id,
      title: movie.title || movie.name || movie.original_title || movie.file_name || movie.id,
      trailerUrl: mapping.trailerUrl,
    });

    if (!dryRun) {
      await movie.ref.set(
        {
          trailer_url: mapping.trailerUrl,
          is_for_review: true,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
  }

  console.log(`${dryRun ? 'Dry run checked' : 'Updated'} ${matched.length} review trailer movie(s) in ${collectionName}.`);
  matched.forEach((entry) => {
    console.log(`- ${entry.title} (${entry.id}) -> ${entry.trailerUrl}`);
  });

  if (unmatched.length) {
    console.log('');
    console.log(`Unmatched ${unmatched.length} title(s). Add/rename manually or update aliases:`);
    unmatched.forEach((title) => console.log(`- ${title}`));  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


