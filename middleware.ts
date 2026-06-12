import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { AUTH_ROLE_COOKIE, AUTH_SESSION_COOKIE } from '@/lib/auth/constants';
import {
  APP_REVIEW_SESSION_COOKIE,
  APP_REVIEW_HOME_PATH,
  isAppInReview,
  isReviewBlockedApiPath,
  isReviewBlockedPath,
} from '@/lib/appReview';

const authPages = ['/login', '/signup', '/forgot-password'];
const CANONICAL_HOST = 'ugmovies247.com';
const DUPLICATE_QUERY_PARAMS = new Set([
  'fresh',
  'recovered',
  't',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
]);
const CRAWLER_QUERY_CANONICAL_PATHS = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/subscribe',
];

function isNativeAppRequest(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') || '';
  const requestedWith = request.headers.get('x-requested-with') || '';

  return (
    /Ugmovies247App/i.test(userAgent) ||
    /\bwv\b/i.test(userAgent) ||
    requestedWith === 'com.ugmovies247.app'
  );
}

function isMobileRequest(request: NextRequest) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(request.headers.get('user-agent') || '');
}

function isCrawlerRequest(request: NextRequest) {
  return /Googlebot|Google-InspectionTool|Bingbot|DuckDuckBot|YandexBot|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot/i.test(
    request.headers.get('user-agent') || ''
  );
}


function hasDuplicateQueryParam(name: string) {
  return DUPLICATE_QUERY_PARAMS.has(name.toLowerCase()) || name.toLowerCase().startsWith('utm_');
}

function maybeRedirectToCanonicalRequest(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  let changed = false;

  if (url.hostname.toLowerCase() === `www.${CANONICAL_HOST}`) {
    url.hostname = CANONICAL_HOST;
    changed = true;
  }

  if (pathname !== '/' && pathname.endsWith('/')) {
    url.pathname = pathname.replace(/\/+$/, '');
    changed = true;
  }

  for (const key of Array.from(url.searchParams.keys())) {
    if (hasDuplicateQueryParam(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  if (isCrawlerRequest(request) && CRAWLER_QUERY_CANONICAL_PATHS.includes(pathname)) {
    if (url.search) {
      url.search = '';
      changed = true;
    }
  }

  return changed ? NextResponse.redirect(url, 308) : null;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.getAll(AUTH_SESSION_COOKIE).some((cookie) => Boolean(cookie.value));
  const role =
    request.cookies
      .getAll(AUTH_ROLE_COOKIE)
      .map((cookie) => cookie.value)
      .filter(Boolean)
      .at(-1) || '';
  const isReviewSession =
    isAppInReview ||
    request.cookies.getAll(APP_REVIEW_SESSION_COOKIE).some((cookie) => cookie.value === '1');

  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.includes('.')) {
    return NextResponse.next();
  }

  const canonicalRedirect = maybeRedirectToCanonicalRequest(request, pathname);
  if (canonicalRedirect) {
    return canonicalRedirect;
  }

  if (pathname === '/' && (hasSession || isNativeAppRequest(request) || isMobileRequest(request))) {
    return NextResponse.redirect(new URL('/browse', request.url));
  }

  if (isReviewSession) {
    if (isReviewBlockedApiPath(pathname)) {
      return NextResponse.json({ error: 'Subscriptions are unavailable in this app build.' }, { status: 404 });
    }

    if (isReviewBlockedPath(pathname)) {
      return NextResponse.redirect(new URL(APP_REVIEW_HOME_PATH, request.url));
    }
  }

  if (authPages.includes(pathname) && hasSession) {
    return NextResponse.redirect(new URL('/browse', request.url));
  }

  if (pathname.startsWith('/admin')) {
    if (hasSession && role === 'admin') {
      if (pathname === '/admin/login') {
        return NextResponse.redirect(new URL('/admin', request.url));
      }

      return NextResponse.next();
    }

    if (!hasSession) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    return NextResponse.redirect(new URL('/browse', request.url));
  }

  if (pathname === '/cardspayments' || pathname.startsWith('/cardspayments/')) {
    if (!hasSession) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    if (role !== 'admin') {
      return NextResponse.redirect(new URL('/browse', request.url));
    }

    return NextResponse.next();
  }

  // User-facing pages are guarded in AuthGate instead of here. The mobile app can
  // lose the HTTP-only cookie before its native/Firebase session is restored; a
  // middleware redirect would send that recoverable user straight to /login.

  if (pathname.startsWith('/api/admin') && (!hasSession || role !== 'admin')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/login',
    '/',
    '/signup',
    '/forgot-password',
    '/browse/:path*',
    '/movies/:path*',
    '/series/:path*',
    '/movie/:path*',
    '/downloads/:path*',
    '/likes/:path*',
    '/watchlist/:path*',
    '/profile/:path*',
    '/mobile-checkout',
    '/mobile-checkout/:path*',
    '/request/:path*',
    '/notifications/:path*',
    '/search/:path*',
    '/genres/:path*',
    '/category/:path*',
    '/vjs/:path*',
    '/subscribe/:path*',
    '/admin/:path*',
    '/cardspayments',
    '/cardspayments/:path*',
    '/api/movies/:path*',
    '/api/download',
    '/api/download/:path*',
    '/api/user/downloads/:path*',
    '/api/subscriptions/:path*',
    '/api/admin/:path*',
  ],
};
