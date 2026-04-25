import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { checkRateLimit } from '@/lib/server/rateLimit';
import { sendVerificationEmailForUser } from '@/lib/server/transactionalEmails';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRequestIp(request: Request) {
  return request.headers.get('x-forwarded-for') || 'unknown';
}

export async function POST(request: Request) {
  const session = await getCurrentAuthSession({ hydrateUserRecord: true });

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.userRecord.emailVerified) {
    return NextResponse.json({ success: true, message: 'Your email is already verified.' });
  }

  const rateLimit = checkRateLimit(`auth-verify-resend:${getRequestIp(request)}:${session.uid}`, {
    limit: 3,
    windowMs: 1000 * 60 * 20,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many verification emails. Please wait and try again.' },
      { status: 429 }
    );
  }

  const result = await sendVerificationEmailForUser(session.uid);

  if (!result?.ok) {
    return NextResponse.json(
      { error: 'We could not send the verification email right now.' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Verification email sent. Check your inbox and spam folder.',
  });
}

