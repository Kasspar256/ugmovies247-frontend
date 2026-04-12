function normalizeEnvironment(value?: string | null) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'production' || normalized === 'prod') {
    return 'production';
  }

  if (normalized === 'staging' || normalized === 'stage') {
    return 'staging';
  }

  return 'development';
}

export const FIRESTORE_ENV_NAMESPACE = normalizeEnvironment(
  process.env.FIRESTORE_ENV_NAMESPACE ||
    process.env.APP_ENV ||
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.NODE_ENV
);

function getScopedCollectionName(baseCollectionName: string) {
  return `${baseCollectionName}__${FIRESTORE_ENV_NAMESPACE}`;
}

export const MOVIES_COLLECTION = getScopedCollectionName('movies');
export const VIDEO_JOBS_COLLECTION = getScopedCollectionName('video_jobs');
export const VIDEO_JOB_RUNTIME_COLLECTION = getScopedCollectionName('video_job_runtime');
