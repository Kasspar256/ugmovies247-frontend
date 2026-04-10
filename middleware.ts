import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { AUTH_ROLE_COOKIE, AUTH_SESSION_COOKIE } from '@/lib/auth/constants';

const protectedPrefixes = [
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
  '/subscribe',
];

const authPages = ['/login', '/signup', '/forgot-password'];

function matchesProtectedPath(pathname: string) {
  if (pathname === '/') {
    return true;
  }

  return protectedPrefixes.some((prefix) => prefix !== '/' && pathname.startsWith(prefix));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
  const role = request.cookies.get(AUTH_ROLE_COOKIE)?.value || '';

  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.includes('.')) {
    return NextResponse.next();
  }

  if (authPages.includes(pathname) && hasSession) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login') {
      if (hasSession && role === 'admin') {
        return NextResponse.redirect(new URL('/admin', request.url));
      }

      return NextResponse.next();
    }

    if (!hasSession) {
      const loginUrl = new URL('/admin/login', request.url);
      loginUrl.searchParams.set('redirect', `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }

    if (role !== 'admin') {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    return NextResponse.next();
  }

  if (matchesProtectedPath(pathname) && !hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith('/api/movies') && !hasSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (pathname.startsWith('/api/admin') && (!hasSession || role !== 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/signup',
    '/forgot-password',
    '/movie/:path*',
    '/downloads/:path*',
    '/watchlist/:path*',
    '/profile/:path*',
    '/request/:path*',
    '/notifications/:path*',
    '/search/:path*',
    '/genres/:path*',
    '/category/:path*',
    '/vjs/:path*',
    '/subscribe/:path*',
    '/admin/:path*',
    '/api/movies/:path*',
    '/api/subscriptions/:path*',
    '/api/admin/:path*',
  ],
};
