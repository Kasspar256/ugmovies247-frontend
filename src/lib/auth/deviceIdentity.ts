export const CLIENT_DEVICE_ID_HEADER = 'x-ugm-device-id';
export const CLIENT_DEVICE_SESSION_HEADER = 'x-ugm-device-session';

const CLIENT_DEVICE_ID_STORAGE_KEY = 'ugmovies247.device-id.v1';
const CLIENT_DEVICE_SESSION_STORAGE_KEY = 'ugmovies247.device-session.v1';

type NativePreferencesPlugin = {
  get?: (options: { key: string }) => Promise<{ value?: string | null }>;
  set?: (options: { key: string; value: string }) => Promise<void>;
  remove?: (options: { key: string }) => Promise<void>;
};

let hydratedNativeIdentity = false;
let nativeHydrationPromise: Promise<void> | null = null;
let memoryDeviceId = '';
let memoryDeviceSession = '';

function createDeviceId() {
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : null;

  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getNativePreferences() {
  if (typeof window === 'undefined') {
    return null;
  }

  const capacitor = (window as typeof window & {
    Capacitor?: { Plugins?: Record<string, unknown> };
  }).Capacitor;

  return (capacitor?.Plugins?.Preferences || null) as NativePreferencesPlugin | null;
}

function readLocalStorageValue(key: string) {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeLocalStorageValue(key: string, value: string) {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined' || !value) {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures; native storage or cookies may still carry auth.
  }
}

function writeNativeValue(key: string, value: string) {
  if (!value) {
    return;
  }

  void getNativePreferences()?.set?.({ key, value }).catch(() => undefined);
}

function removeNativeValue(key: string) {
  void getNativePreferences()?.remove?.({ key }).catch(() => undefined);
}

export async function hydrateClientDeviceIdentity() {
  if (hydratedNativeIdentity) {
    return;
  }

  if (nativeHydrationPromise) {
    return nativeHydrationPromise;
  }

  nativeHydrationPromise = (async () => {
    const preferences = getNativePreferences();
    const localDeviceId = readLocalStorageValue(CLIENT_DEVICE_ID_STORAGE_KEY);
    const localSession = readLocalStorageValue(CLIENT_DEVICE_SESSION_STORAGE_KEY);

    if (localDeviceId) {
      memoryDeviceId = localDeviceId;
    }

    if (localSession) {
      memoryDeviceSession = localSession;
    }

    if (!preferences?.get) {
      hydratedNativeIdentity = true;
      return;
    }

    const [nativeDeviceIdResult, nativeSessionResult] = await Promise.all([
      preferences.get({ key: CLIENT_DEVICE_ID_STORAGE_KEY }).catch(() => ({ value: '' })),
      preferences.get({ key: CLIENT_DEVICE_SESSION_STORAGE_KEY }).catch(() => ({ value: '' })),
    ]);
    const nativeDeviceId = String(nativeDeviceIdResult.value || '').trim();
    const nativeSession = String(nativeSessionResult.value || '').trim();

    memoryDeviceId = localDeviceId || nativeDeviceId || memoryDeviceId;
    memoryDeviceSession = localSession || nativeSession || memoryDeviceSession;

    if (memoryDeviceId) {
      writeLocalStorageValue(CLIENT_DEVICE_ID_STORAGE_KEY, memoryDeviceId);
      writeNativeValue(CLIENT_DEVICE_ID_STORAGE_KEY, memoryDeviceId);
    }

    if (memoryDeviceSession) {
      writeLocalStorageValue(CLIENT_DEVICE_SESSION_STORAGE_KEY, memoryDeviceSession);
      writeNativeValue(CLIENT_DEVICE_SESSION_STORAGE_KEY, memoryDeviceSession);
    }

    hydratedNativeIdentity = true;
  })().finally(() => {
    nativeHydrationPromise = null;
  });

  return nativeHydrationPromise;
}

export function getClientDeviceId() {
  const storedDeviceId = readLocalStorageValue(CLIENT_DEVICE_ID_STORAGE_KEY) || memoryDeviceId;

  if (storedDeviceId) {
    memoryDeviceId = storedDeviceId;
    return storedDeviceId;
  }

  const nextDeviceId = createDeviceId();
  memoryDeviceId = nextDeviceId;
  writeLocalStorageValue(CLIENT_DEVICE_ID_STORAGE_KEY, nextDeviceId);
  writeNativeValue(CLIENT_DEVICE_ID_STORAGE_KEY, nextDeviceId);
  return nextDeviceId;
}

export function rememberClientDeviceSession(sessionValue?: string | null) {
  if (!sessionValue) {
    return;
  }

  memoryDeviceSession = sessionValue;
  writeLocalStorageValue(CLIENT_DEVICE_SESSION_STORAGE_KEY, sessionValue);
  writeNativeValue(CLIENT_DEVICE_SESSION_STORAGE_KEY, sessionValue);
}

export function getClientDeviceSession() {
  const storedSession = readLocalStorageValue(CLIENT_DEVICE_SESSION_STORAGE_KEY) || memoryDeviceSession;
  memoryDeviceSession = storedSession;
  return storedSession;
}

export function clearClientDeviceSession() {
  memoryDeviceSession = '';

  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.removeItem(CLIENT_DEVICE_SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  removeNativeValue(CLIENT_DEVICE_SESSION_STORAGE_KEY);
}

export function getClientDeviceHeaders() {
  const deviceId = getClientDeviceId();
  const deviceSession = getClientDeviceSession();

  return {
    ...(deviceId ? { [CLIENT_DEVICE_ID_HEADER]: deviceId } : {}),
    ...(deviceSession ? { [CLIENT_DEVICE_SESSION_HEADER]: deviceSession } : {}),
  };
}

export async function getHydratedClientDeviceHeaders() {
  await hydrateClientDeviceIdentity();
  return getClientDeviceHeaders();
}
