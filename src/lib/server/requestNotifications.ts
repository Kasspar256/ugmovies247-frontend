import { adminDb, adminMessaging } from '@/lib/firebaseAdmin';
import { getSupportEmail, sendTransactionalEmailSafely } from '@/lib/server/emailSender';
import type { AdminRequest } from '@/types/admin';

type FcmPayload = {
  token?: string;
  title: string;
  body: string;
  data?: Record<string, string | undefined>;
  link?: string;
};

function getBaseUrl() {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://ugmovies247.com'
  ).replace(/\/$/, '');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeFcmData(data?: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(data || {})
      .filter(([, value]) => typeof value === 'string' && value.length > 0)
      .map(([key, value]) => [key, value as string])
  );
}

function buildRequestEmailHtml(options: {
  title: string;
  intro: string;
  lines?: string[];
  ctaHref?: string;
  ctaLabel?: string;
}) {
  const logoUrl = process.env.EMAIL_TEMPLATE_LOGO_URL || `${getBaseUrl()}/templatelogo.png`;
  const supportEmail = getSupportEmail();
  const rows = (options.lines || [])
    .map(
      (line) =>
        `<p style="margin:0 0 12px;color:#d6d9e0;font-size:15px;line-height:1.65;">${escapeHtml(line)}</p>`
    )
    .join('');
  const cta = options.ctaHref && options.ctaLabel
    ? `<a href="${escapeHtml(options.ctaHref)}" style="display:inline-block;margin-top:20px;border-radius:16px;background:#d90429;color:#ffffff;text-decoration:none;font-weight:900;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;padding:16px 24px;">${escapeHtml(options.ctaLabel)}</a>`
    : '';

  return `<!doctype html>
<html>
  <body style="margin:0;background:#07080c;padding:0;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#07080c;padding:28px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border-radius:28px;overflow:hidden;background:#11141c;border:1px solid rgba(255,255,255,0.10);box-shadow:0 24px 70px rgba(0,0,0,0.42);">
            <tr>
              <td style="padding:30px 28px 18px;text-align:center;background:radial-gradient(circle at top,rgba(217,4,41,.24),transparent 48%),#0b0c10;">
                <img src="${escapeHtml(logoUrl)}" alt="UGMOVIES247" width="132" style="display:block;margin:0 auto 18px;max-width:132px;height:auto;">
                <h1 style="margin:0;color:#ffffff;font-size:30px;line-height:1.1;letter-spacing:-0.03em;font-weight:900;">${escapeHtml(options.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;color:#ffffff;font-size:17px;line-height:1.65;font-weight:700;">${escapeHtml(options.intro)}</p>
                ${rows}
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 26px;border-top:1px solid rgba(255,255,255,0.08);color:#9aa4b2;font-size:13px;line-height:1.6;">
                Need help? Contact <a href="mailto:${escapeHtml(supportEmail)}" style="color:#ffb3c1;text-decoration:none;">${escapeHtml(supportEmail)}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildRequestEmailText(options: {
  title: string;
  intro: string;
  lines?: string[];
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return [
    options.title,
    '',
    options.intro,
    ...(options.lines?.length ? ['', ...options.lines] : []),
    ...(options.ctaHref && options.ctaLabel ? ['', `${options.ctaLabel}: ${options.ctaHref}`] : []),
    '',
    `Need help? Contact ${getSupportEmail()}`,
  ].join('\n');
}

export async function sendFcmNotification(options: FcmPayload) {
  const token = String(options.token || '').trim();

  if (!token) {
    return { ok: false, skipped: true, reason: 'missing_token' };
  }

  try {
    await adminMessaging.send({
      token,
      notification: {
        title: options.title,
        body: options.body,
      },
      data: normalizeFcmData(options.data),
      android: {
        priority: 'high',
        notification: {
          channelId: 'movie_requests',
          sound: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
      webpush: options.link
        ? {
            fcmOptions: {
              link: options.link,
            },
          }
        : undefined,
    });

    return { ok: true, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send FCM notification.';
    console.warn('[movie-requests] FCM notification failed', message);
    return { ok: false, skipped: false, reason: message };
  }
}

export async function sendTelegramAdminMessage(message: string) {
  const botToken = process.env.ADMIN_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID || '';

  if (!botToken || !chatId) {
    return { ok: false, skipped: true, reason: 'telegram_not_configured' };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const payload = await response.text().catch(() => '');
      throw new Error(payload || `Telegram responded with ${response.status}`);
    }

    return { ok: true, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send Telegram message.';
    console.warn('[movie-requests] Telegram admin alert failed', message);
    return { ok: false, skipped: false, reason: message };
  }
}

export async function sendAdminMovieRequestAlert(request: AdminRequest) {
  const adminLink = `${getBaseUrl()}/admin/requests`;
  const title = request.title || request.movieTitle || 'Untitled request';
  const requester = request.requesterEmail || request.userEmail || request.requesterName || 'Unknown user';
  const body = `New movie request: ${title}`;

  await Promise.allSettled([
    sendFcmNotification({
      token: process.env.ADMIN_FCM_TOKEN || '',
      title: 'New movie request',
      body,
      data: {
        type: 'movie_request_admin',
        requestId: request.id,
        route: '/admin/requests',
      },
      link: adminLink,
    }),
    sendTelegramAdminMessage(
      [
        '<b>New UGMOVIES247 movie request</b>',
        `Title: ${escapeHtml(title)}`,
        `User: ${escapeHtml(requester)}`,
        request.preferredVj ? `Preferred VJ: ${escapeHtml(request.preferredVj)}` : '',
        request.notes ? `Notes: ${escapeHtml(request.notes)}` : '',
        `Admin: ${adminLink}`,
      ]
        .filter(Boolean)
        .join('\n')
    ),
  ]);
}

export async function sendMovieRequestUserUpdate(options: {
  request: AdminRequest;
  subject: string;
  title: string;
  message: string;
  lines?: string[];
  movieId?: string;
  status: string;
}) {
  const email = String(options.request.userEmail || options.request.requesterEmail || '').trim();
  const userId = String(options.request.userId || options.request.requesterId || '').trim();
  const movieId = String(options.movieId || options.request.movieId || '').trim();
  let fcmToken = String(options.request.fcmToken || '').trim();

  if (!fcmToken && userId) {
    const userSnapshot = await adminDb.collection('users').doc(userId).get().catch(() => null);
    const userData = userSnapshot?.data() as { fcmToken?: string } | undefined;
    fcmToken = userData?.fcmToken?.trim() || '';
  }

  const movieLink = movieId
    ? `${getBaseUrl()}/movie/${encodeURIComponent(movieId)}?fresh=1&fromRequest=1`
    : `${getBaseUrl()}/browse`;

  await Promise.allSettled([
    email
      ? sendTransactionalEmailSafely({
          to: email,
          userId,
          type: 'movie_request_update',
          subject: options.subject,
          html: buildRequestEmailHtml({
            title: options.title,
            intro: options.message,
            lines: options.lines,
            ctaHref: movieId ? movieLink : undefined,
            ctaLabel: movieId ? 'Watch Now' : undefined,
          }),
          text: buildRequestEmailText({
            title: options.title,
            intro: options.message,
            lines: options.lines,
            ctaHref: movieId ? movieLink : undefined,
            ctaLabel: movieId ? 'Watch Now' : undefined,
          }),
        })
      : Promise.resolve({ ok: false, skipped: true }),
    sendFcmNotification({
      token: fcmToken,
      title: options.title,
      body: options.message,
      link: movieLink,
      data: {
        type: 'movie_request_update',
        status: options.status,
        requestId: options.request.id,
        movieId,
        route: movieId ? `/movie/${movieId}?fresh=1&fromRequest=1` : '/browse',
      },
    }),
  ]);
}
