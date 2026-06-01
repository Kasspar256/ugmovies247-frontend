export const APP_REVIEW_SESSION_COOKIE = 'ugmovies247_review_mode';

const FORCE_APP_REVIEW = false;

export function hasAppReviewSessionCookie() {
  if (typeof document === 'undefined') {
    return false;
  }

  return document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .some((entry) => entry === `${APP_REVIEW_SESSION_COOKIE}=1`);
}

export function getClientAppReviewMode() {
  return FORCE_APP_REVIEW || hasAppReviewSessionCookie();
}

// Keep the first server render and the first client render identical.
// Cookie-only review mode must be checked after hydration by the specific flow that needs it.
export const isAppInReview = FORCE_APP_REVIEW;

export const APP_REVIEW_HOME_PATH = '/browse';

export function isReviewBlockedPath(pathname: string) {
  return (
    pathname.startsWith('/subscribe') ||
    pathname.startsWith('/mobile-checkout') ||
    pathname.startsWith('/cardspayments') ||
    pathname.startsWith('/downloads') ||
    pathname === '/profile/billing' ||
    pathname === '/profile/payments'
  );
}

export function isReviewBlockedApiPath(pathname: string) {
  return (
    pathname.startsWith('/api/subscriptions') ||
    pathname === '/api/admin/card-payments' ||
    pathname === '/api/download' ||
    pathname.startsWith('/api/user/downloads')
  );
}
