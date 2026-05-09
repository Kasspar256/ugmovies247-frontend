export const isAppInReview = true;

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
