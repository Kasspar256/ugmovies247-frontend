export const AUTH_SESSION_COOKIE = 'ugm_session_v2';
export const AUTH_ROLE_COOKIE = 'ugm_role_v2';
export const AUTH_DEVICE_COOKIE = 'ugm_device_v1';
export const AUTH_DEVICE_SESSION_COOKIE = 'ugm_device_session_v1';
// Firebase session cookies are capped at 14 days. Keep just under that limit
// and refresh activity often so users do not get logged out after a few hours.
export const AUTH_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 13;
export const AUTH_DEVICE_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365 * 2;
export const AUTH_SESSION_ACTIVE_WINDOW_MS = 1000 * 60 * 20;
export const AUTH_SESSION_HEARTBEAT_MS = 1000 * 45;
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

export const AUTH_PROTECTED_PATHS = [
  '/',
  '/movie',
  '/downloads',
  '/likes',
  '/watchlist',
  '/profile',
  '/request',
  '/notifications',
  '/search',
  '/genres',
  '/category',
  '/vjs',
] as const;
