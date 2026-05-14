const { loadEnvConfig } = require('@next/env');
const admin = require('firebase-admin');

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

function getArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));

  return arg ? arg.slice(prefix.length) : fallback;
}

function getProjectId() {
  return process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
}

function getCollectionName() {
  const explicit = getArg('collection', '');

  if (explicit) {
    return explicit;
  }

  const namespace = normalizeEnvironment(
    getArg('env', '') ||
      process.env.FIRESTORE_ENV_NAMESPACE ||
      process.env.APP_ENV ||
      process.env.NEXT_PUBLIC_APP_ENV ||
      process.env.NODE_ENV
  );

  return `video_jobs__${namespace}`;
}

function getAdminCredential() {
  const projectId = getProjectId();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Firebase Admin env vars. Need FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.'
    );
  }

  return admin.credential.cert({
    projectId,
    clientEmail,
    privateKey,
  });
}

function toMillis(value) {
  if (!value) {
    return 0;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }

  const parsed = Date.parse(String(value));

  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMessage(message) {
  return String(message || '').replace(/\s+/g, ' ').trim();
}

function classifyFailure(message) {
  const text = normalizeMessage(message).toLowerCase();

  if (!text) {
    return 'missing error message';
  }

  if (/cancelled by admin/.test(text)) {
    return 'cancelled by admin';
  }

  if (/not a usable mp4|only direct mp4 links are supported|detected format/.test(text)) {
    return 'unsupported file/container';
  }

  if (/could not be parsed|invalid data found|moov atom|ffprobe|inspection/.test(text)) {
    return 'invalid or damaged video file';
  }

  if (/not enough free disk|free disk space/.test(text)) {
    return 'low vps disk space';
  }

  if (/max file size|too large|content-length|payload too large/.test(text)) {
    return 'source file too large';
  }

  if (/403|401|forbidden|unauthorized|access denied|hotlink|permission/.test(text)) {
    return 'source link blocked access';
  }

  if (/404|not found|410|gone/.test(text)) {
    return 'source link missing';
  }

  if (/timeout|timed out|stalled|deadline exceeded/.test(text)) {
    return 'network timeout/stalled';
  }

  if (/econnreset|etimedout|eai_again|fetch failed|socket hang up|connection reset|network/.test(text)) {
    return 'network connection failed';
  }

  if (/request aborted|one or more of the specified parts could not be found|multipart/.test(text)) {
    return 'r2 multipart upload failed';
  }

  if (/quota|resource_exhausted|ramp up limit/.test(text)) {
    return 'firestore quota/throttling';
  }

  if (/ffmpeg|conversion failed|encoder|transcod|non-monotonous|aac|h264/.test(text)) {
    return 'ffmpeg processing failed';
  }

  return 'other';
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function printMap(title, map) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));

  if (!map.size) {
    console.log('None');
    return;
  }

  [...map.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .forEach(([key, count]) => {
      console.log(`${String(count).padStart(4, ' ')}  ${key}`);
    });
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: getAdminCredential(),
      projectId: getProjectId(),
    });
  }

  const db = admin.firestore();
  const collectionName = getCollectionName();
  const limit = Math.max(1, Number(getArg('limit', '5000')) || 5000);
  const days = Math.max(0, Number(getArg('days', '0')) || 0);
  const cutoffMs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

  console.log(`Reading failed video jobs from ${collectionName}...`);
  console.log(days > 0 ? `Window: last ${days} day(s)` : 'Window: all failed jobs in scan');
  console.log(`Scan limit: ${limit}`);

  const snapshot = await db
    .collection(collectionName)
    .where('status', '==', 'failed')
    .limit(limit)
    .get();

  const failedJobs = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((job) => {
      if (!cutoffMs) {
        return true;
      }

      return Math.max(toMillis(job.updatedAt), toMillis(job.createdAt)) >= cutoffMs;
    })
    .sort((first, second) => {
      const firstTime = Math.max(toMillis(first.updatedAt), toMillis(first.createdAt));
      const secondTime = Math.max(toMillis(second.updatedAt), toMillis(second.createdAt));

      return secondTime - firstTime;
    });

  const byCause = new Map();
  const bySourceType = new Map();
  const byJobType = new Map();
  const byPipeline = new Map();
  const byHost = new Map();

  for (const job of failedJobs) {
    increment(byCause, classifyFailure(job.errorMessage));
    increment(bySourceType, job.sourceType || 'unknown');
    increment(byJobType, job.jobType || 'unknown');
    increment(byPipeline, job.sourcePipeline || 'unknown');

    try {
      if (job.sourceUrl) {
        increment(byHost, new URL(job.sourceUrl).hostname);
      }
    } catch {
      increment(byHost, 'invalid source url');
    }
  }

  console.log('\nSummary');
  console.log('-------');
  console.log(`Failed jobs counted: ${failedJobs.length}`);
  console.log(`Failed jobs scanned from Firestore: ${snapshot.size}`);
  if (snapshot.size >= limit) {
    console.log('WARNING: scan hit the limit. Re-run with a bigger --limit value for a full count.');
  }

  printMap('Failures by cause', byCause);
  printMap('Failures by source type', bySourceType);
  printMap('Failures by job type', byJobType);
  printMap('Failures by pipeline', byPipeline);
  printMap('Failures by source host', byHost);

  console.log('\nRecent failed jobs');
  console.log('------------------');

  failedJobs.slice(0, 30).forEach((job, index) => {
    console.log(`\n${index + 1}. ${job.title || '(untitled)'} [${job.id}]`);
    console.log(`   updated: ${job.updatedAt || 'unknown'}`);
    console.log(`   type: ${job.sourceType || 'unknown'} / ${job.jobType || 'unknown'}`);
    console.log(`   cause: ${classifyFailure(job.errorMessage)}`);
    console.log(`   error: ${normalizeMessage(job.errorMessage).slice(0, 420) || '(empty)'}`);
    if (job.sourceUrl) {
      console.log(`   url: ${job.sourceUrl}`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
