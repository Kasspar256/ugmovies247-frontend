export const LEGAL_ROUTE_PREFIXES = [
  '/help',
  '/terms',
  '/privacy',
  '/privacy-policy',
  '/account-deletion',
  '/dmca',
  '/dcma',
];

export function isLegalRoute(pathname: string) {
  if (!pathname) {
    return false;
  }

  return LEGAL_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
