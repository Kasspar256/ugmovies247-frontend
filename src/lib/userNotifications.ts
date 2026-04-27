export type UserNotification = {
  id: string;
  title: string;
  body: string;
  path: string;
  movieId: string;
  source: string;
  read: boolean;
  readAt: string;
  createdAt: string;
};

type NotificationsResponse = {
  notifications?: UserNotification[];
  unreadCount?: number;
  error?: string;
};

async function parseJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

export async function fetchUserNotifications() {
  const response = await fetch('/api/notifications', {
    credentials: 'include',
    cache: 'no-store',
  });

  const payload = await parseJson<NotificationsResponse>(response);

  return {
    notifications: payload.notifications || [],
    unreadCount: payload.unreadCount || 0,
  };
}

export async function createUserNotification(input: {
  title: string;
  body: string;
  path?: string;
  movieId?: string;
  source?: string;
}) {
  const response = await fetch('/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  return parseJson<{ notification: UserNotification }>(response);
}

export async function markUserNotificationRead(notificationId: string) {
  const response = await fetch('/api/notifications', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ notificationId }),
  });

  return parseJson<{ success: boolean }>(response);
}

export async function markAllUserNotificationsRead() {
  const response = await fetch('/api/notifications', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ markAllRead: true }),
  });

  return parseJson<{ success: boolean }>(response);
}

export function formatNotificationTime(value?: string) {
  if (!value) {
    return 'Just now';
  }

  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    return 'Just now';
  }

  const diffMs = Date.now() - time;
  const minutes = Math.max(1, Math.floor(diffMs / 60_000));

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export async function fetchUserNotification(notificationId: string) {
  const params = new URLSearchParams({ notificationId });
  const response = await fetch(`/api/notifications?${params.toString()}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJson<{ notification: UserNotification }>(response);
}
