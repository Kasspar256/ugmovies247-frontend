import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { AUTH_ROLE_COOKIE, AUTH_SESSION_COOKIE } from '@/lib/auth/constants';
import {
  APP_REVIEW_HOME_PATH,
  isAppInReview,
  isReviewBlockedApiPath,
  isReviewBlockedPath,
} from '@/lib/appReview';

const protectedPrefixes = [
  '/browse',
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
  '/subscribe',
];

const authPages = ['/login', '/signup', '/forgot-password'];

function matchesProtectedPath(pathname: string) {
  if (pathname === '/browse') {
    return true;
  }

  return protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.getAll(AUTH_SESSION_COOKIE).some((cookie) => Boolean(cookie.value));
  const role =
    request.cookies
      .getAll(AUTH_ROLE_COOKIE)
      .map((cookie) => cookie.value)
      .filter(Boolean)
      .at(-1) || '';

  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.includes('.')) {
    return NextResponse.next();
  }

  if (isAppInReview) {
    if (pathname === '/api/admin/card-payments') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (pathname === '/cardspayments' || pathname.startsWith('/cardspayments/')) {
      return NextResponse.redirect(new URL(hasSession ? APP_REVIEW_HOME_PATH : '/login', request.url));
    }

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

  if (matchesProtectedPath(pathname) && !hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith('/api/admin') && (!hasSession || role !== 'admin')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/login',
    '/signup',
    '/forgot-password',
    '/browse/:path*',
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
