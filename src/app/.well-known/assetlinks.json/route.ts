import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getFingerprints() {
  return (
    process.env.ANDROID_APP_SHA256_FINGERPRINTS ||
    process.env.ANDROID_APP_SHA256_FINGERPRINT ||
    ''
  )
    .split(',')
    .map((fingerprint) => fingerprint.trim())
    .filter(Boolean);
}

export async function GET() {
  const packageName = process.env.ANDROID_APP_PACKAGE_NAME || 'com.ugmovies247.app';
  const fingerprints = getFingerprints();

  return NextResponse.json(
    fingerprints.map((fingerprint) => ({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: [fingerprint],
      },
    })),
    {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    }
  );
}
