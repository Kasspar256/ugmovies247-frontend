export const CLIENT_DEVICE_ID_HEADER = 'x-ugm-device-id';

const CLIENT_DEVICE_ID_STORAGE_KEY = 'ugmovies247.device-id.v1';

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

export function getClientDeviceHeaders() {
  const deviceId = getClientDeviceId();

  return deviceId
    ? {
        [CLIENT_DEVICE_ID_HEADER]: deviceId,
      }
    : {};
}
