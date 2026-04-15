import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { FIRESTORE_ENV_NAMESPACE } from './firestoreNamespaces';

export type PersistedAdminCache<T> = {
  value: T;
  cachedAt: number;
};

const ADMIN_RUNTIME_CACHE_DIR = path.join(process.cwd(), '.runtime-cache');

function getAdminRuntimeCachePath(resource: string) {
  const safeResource = resource.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return path.join(
    ADMIN_RUNTIME_CACHE_DIR,
    `admin-${safeResource}.${FIRESTORE_ENV_NAMESPACE}.json`
  );
}

export async function readPersistedAdminCache<T>(resource: string) {
  try {
    const raw = await readFile(getAdminRuntimeCachePath(resource), 'utf8');
    const parsed = JSON.parse(raw) as PersistedAdminCache<T>;

    if (!parsed || typeof parsed.cachedAt !== 'number' || !('value' in parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function persistAdminCache<T>(resource: string, cache: PersistedAdminCache<T>) {
  try {
    await mkdir(ADMIN_RUNTIME_CACHE_DIR, { recursive: true });
    await writeFile(getAdminRuntimeCachePath(resource), JSON.stringify(cache), 'utf8');
  } catch (error) {
    console.warn(`[admin-cache] failed to persist ${resource} cache`, error);
  }
}
