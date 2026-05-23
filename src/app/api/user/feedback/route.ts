import { NextResponse } from 'next/server';
import { getCurrentAuthSession } from '@/lib/auth/server';
import { checkRateLimit } from '@/lib/server/rateLimit';
import { sendTransactionalEmailSafely } from '@/lib/server/emailSender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEEDBACK_INBOX = 'info@ugmovies247.com';
const DEFAULT_FEEDBACK_SUBJECT = 'Help Make UGMOVIES247 Better';

function getRequestIp(request: Request) {
  return request.headers.get('x-forwarded-for') || 'unknown';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeSubject(value: unknown) {
  const subject = String(value || '').trim();
  return subject || DEFAULT_FEEDBACK_SUBJECT;
}

function normalizeMessage(value: unknown) {
  return String(value || '').trim().slice(0, 4000);
}

export async function POST(request: Request) {
  const session = await getCurrentAuthSession({ hydrateUserRecord: true });

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`app-feedback:${getRequestIp(request)}:${session.uid}`, {
    limit: 4,
    windowMs: 1000 * 60 * 30,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many suggestions sent. Please wait a little and try again.' },
      { status: 429 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    subject?: string;
    message?: string;
    source?: string;
  };
  const subject = normalizeSubject(body.subject);
  const message = normalizeMessage(body.message);
  const source = String(body.source || 'Profile Security').trim() || 'Profile Security';

  if (message.length < 8) {
    return NextResponse.json(
      { error: 'Please write a short suggestion before sending.' },
      { status: 400 }
    );
  }

  const submittedAt = new Date().toISOString();
  const senderName = session.name || session.userRecord.name || 'UGMOVIES247 user';
  const senderEmail = session.email || session.userRecord.email || '';
  const text = [
    subject,
    '',
    message,
    '',
    `From: ${senderName}`,
    `Email: ${senderEmail}`,
    `User ID: ${session.uid}`,
    `Source: ${source}`,
    `Submitted: ${submittedAt}`,
  ].join('\n');
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#07080c;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
    <main style="max-width:620px;margin:0 auto;border-radius:24px;border:1px solid rgba(255,255,255,.12);background:#11141c;padding:28px;">
      <div style="color:#ffb3c1;font-size:12px;font-weight:900;letter-spacing:.22em;text-transform:uppercase;">UGMOVIES247 App Feedback</div>
      <h1 style="margin:12px 0 18px;font-size:28px;line-height:1.15;">${escapeHtml(subject)}</h1>
      <div style="white-space:pre-wrap;color:#f4f6fb;font-size:16px;line-height:1.7;">${escapeHtml(message)}</div>
      <hr style="border:0;border-top:1px solid rgba(255,255,255,.1);margin:24px 0;">
      <p style="margin:0;color:#b5bdca;font-size:14px;line-height:1.8;">
        From: ${escapeHtml(senderName)}<br>
        Email: ${escapeHtml(senderEmail)}<br>
        User ID: ${escapeHtml(session.uid)}<br>
        Source: ${escapeHtml(source)}<br>
        Submitted: ${escapeHtml(submittedAt)}
      </p>
    </main>
  </body>
</html>`;

  const result = await sendTransactionalEmailSafely({
    to: FEEDBACK_INBOX,
    userId: session.uid,
    type: 'app_feedback',
    subject,
    html,
    text,
    dedupeKey: `app_feedback:${session.uid}:${submittedAt}`,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: 'Your suggestion could not be sent right now. Please try again shortly.' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Thanks. Your suggestion was sent to the UGMOVIES247 team.',
  });
}
