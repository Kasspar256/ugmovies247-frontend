export const AUTH_SESSION_COOKIE = 'ugm_session';
export const AUTH_ROLE_COOKIE = 'ugm_role';
export const AUTH_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

export const AUTH_PROTECTED_PATHS = [
  '/',
  '/movie',
  '/downloads',
  '/watchlist',
  '/profile',
  '/request',
  '/notifications',
  '/search',
  '/genres',
  '/category',
  '/vjs',
] as const;
