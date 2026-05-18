export const CLIENT_DEVICE_ID_HEADER = 'x-ugm-device-id';
export const CLIENT_DEVICE_SESSION_HEADER = 'x-ugm-device-session';

const CLIENT_DEVICE_ID_STORAGE_KEY = 'ugmovies247.device-id.v1';
const CLIENT_DEVICE_SESSION_STORAGE_KEY = 'ugmovies247.device-session.v1';

function createDeviceId() {
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : null;

  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getClientDeviceId() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return '';
  }

  try {
    const storedDeviceId = window.localStorage.getItem(CLIENT_DEVICE_ID_STORAGE_KEY);

    if (storedDeviceId) {
      return storedDeviceId;
    }

    const nextDeviceId = createDeviceId();
    window.localStorage.setItem(CLIENT_DEVICE_ID_STORAGE_KEY, nextDeviceId);
    return nextDeviceId;
  } catch {
    return '';
  }
}

export function rememberClientDeviceSession(sessionValue?: string | null) {
  if (
    typeof window === 'undefined' ||
    typeof window.localStorage === 'undefined' ||
    !sessionValue
  ) {
    return;
  }

  try {
    window.localStorage.setItem(CLIENT_DEVICE_SESSION_STORAGE_KEY, sessionValue);
  } catch {
    // Ignore storage failures; cookies may still carry the session.
  }
}

export function getClientDeviceSession() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem(CLIENT_DEVICE_SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function clearClientDeviceSession() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(CLIENT_DEVICE_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function getClientDeviceHeaders() {
  const deviceId = getClientDeviceId();
  const deviceSession = getClientDeviceSession();

  return {
    ...(deviceId ? { [CLIENT_DEVICE_ID_HEADER]: deviceId } : {}),
    ...(deviceSession ? { [CLIENT_DEVICE_SESSION_HEADER]: deviceSession } : {}),
  };
}
