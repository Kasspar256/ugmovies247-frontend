import { adminDb } from '@/lib/firebaseAdmin';
import { SUBSCRIPTION_PLANS } from '@/lib/subscriptions/plans';
import { createEmailVerificationToken, createPasswordResetToken } from '@/lib/server/emailTokens';
import { getSupportEmail, sendTransactionalEmailSafely } from '@/lib/server/emailSender';
import type {
  PaymentAttemptDocument,
  RecurringAgreementDocument,
  SubscriptionPlanType,
  UserSubscriptionDocument,
} from '@/types/subscriptions';

type EmailUser = {
  id: string;
  name: string;
  email: string;
};

function nowIso() {
  return new Date().toISOString();
}

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

function formatMoney(amount?: number, currency?: string) {
  const numericAmount = Number(amount || 0);

  if (!numericAmount) {
    return currency || '';
  }

  return `${currency || 'UGX'} ${numericAmount.toLocaleString()}`;
}

function formatDate(value?: string) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function buildPlainText(options: {
  title: string;
  intro: string;
  lines?: string[];
  ctaLabel?: string;
  ctaHref?: string;
}) {
  const lines = [
    options.title,
    '',
    options.intro,
    ...(options.lines?.length ? ['', ...options.lines] : []),
    ...(options.ctaLabel && options.ctaHref ? ['', `${options.ctaLabel}: ${options.ctaHref}`] : []),
    '',
    `Need help? Contact ${getSupportEmail()}`,
  ];

  return lines.filter((line) => line !== undefined).join('\n');
}

function buildEmailHtml(options: {
  title: string;
  intro: string;
  lines?: string[];
  ctaLabel?: string;
  ctaHref?: string;
}) {
  const logoUrl = process.env.EMAIL_TEMPLATE_LOGO_URL || `${getBaseUrl()}/templatelogo.png`;
  const supportEmail = getSupportEmail();
  const detailRows = (options.lines || [])
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
                <img src="${escapeHtml(logoUrl)}" alt="UG Movies 247" width="132" style="display:block;margin:0 auto 18px;max-width:132px;height:auto;">
                <h1 style="margin:0;color:#ffffff;font-size:30px;line-height:1.1;letter-spacing:-0.03em;font-weight:900;">${escapeHtml(options.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;color:#ffffff;font-size:17px;line-height:1.65;font-weight:700;">${escapeHtml(options.intro)}</p>
                ${detailRows}
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

async function getUser(userId: string): Promise<EmailUser | null> {
  if (!userId) {
    return null;
  }

  const snapshot = await adminDb.collection('users').doc(userId).get();
  const data = snapshot.data() as Partial<EmailUser> | undefined;
  const email = String(data?.email || '').trim().toLowerCase();

  if (!email) {
    return null;
  }

  return {
    id: userId,
    name: String(data?.name || 'User'),
    email,
  };
}

function sendBrandedEmail(options: {
  user: EmailUser;
  type: Parameters<typeof sendTransactionalEmailSafely>[0]['type'];
  subject: string;
  title: string;
  intro: string;
  lines?: string[];
  ctaLabel?: string;
  ctaHref?: string;
  dedupeKey?: string;
}) {
  const html = buildEmailHtml(options);
  const text = buildPlainText(options);

  return sendTransactionalEmailSafely({
    to: options.user.email,
    userId: options.user.id,
    type: options.type,
    subject: options.subject,
    html,
    text,
    dedupeKey: options.dedupeKey,
  });
}

export async function sendWelcomeVerifyEmail(user: EmailUser, options?: { dedupeSignup?: boolean }) {
  const token = await createEmailVerificationToken(user.id, user.email);
  const verifyHref = `${getBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;

  await adminDb.collection('users').doc(user.id).set(
    {
      emailVerificationSentAt: nowIso(),
      updatedAt: nowIso(),
    },
    { merge: true }
  );

  return sendBrandedEmail({
    user,
    type: 'welcome_verify',
    subject: 'Welcome to UG Movies 247',
    title: 'Welcome to UG Movies 247',
    intro: `Hi ${user.name || 'there'}, your account was created successfully.`,
    lines: [
      'Verifying your email helps you receive payment receipts, subscription updates, and account recovery support.',
      'You can keep using UG Movies 247 now. Verification is recommended, not required.',
    ],
    ctaLabel: 'Verify Email',
    ctaHref: verifyHref,
    dedupeKey: options?.dedupeSignup ? `welcome_verify:${user.id}` : '',
  });
}

export async function sendProviderWelcomeEmail(user: EmailUser) {
  return sendBrandedEmail({
    user,
    type: 'welcome_verify',
    subject: 'Welcome to UG Movies 247',
    title: 'Welcome to UG Movies 247',
    intro: `Hi ${user.name || 'there'}, your account was created successfully.`,
    lines: [
      'Your email is already trusted because you signed in with Google.',
      'We will use this email for payment receipts, subscription updates, and account recovery support.',
    ],
    ctaLabel: 'Start Watching',
    ctaHref: `${getBaseUrl()}/browse`,
    dedupeKey: `welcome_provider:${user.id}`,
  });
}

export async function sendVerificationEmailForUser(userId: string) {
  const user = await getUser(userId);

  if (!user) {
    return { ok: false, error: 'User email was not found.' };
  }

  return sendWelcomeVerifyEmail(user);
}

export async function sendPasswordResetTransactionalEmail(user: EmailUser) {
  const token = await createPasswordResetToken(user.id, user.email);
  const resetHref = `${getBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;

  return sendBrandedEmail({
    user,
    type: 'password_reset',
    subject: 'Reset your UG Movies 247 password',
    title: 'Reset your password',
    intro: 'Use the secure link below to choose a new password for your UG Movies 247 account.',
    lines: ['This link expires in 1 hour. If you did not request it, you can ignore this email.'],
    ctaLabel: 'Reset Password',
    ctaHref: resetHref,
  });
}

export async function sendPasswordChangedEmail(user: EmailUser) {
  return sendBrandedEmail({
    user,
    type: 'password_changed',
    subject: 'Your UG Movies 247 password was changed',
    title: 'Password changed',
    intro: 'Your UG Movies 247 password was changed successfully.',
    lines: ['If you made this change, no action is needed. If this was not you, contact support immediately.'],
    dedupeKey: `password_changed:${user.id}:${Date.now()}`,
  });
}

export async function sendPaymentSuccessEmail(payment: PaymentAttemptDocument) {
  const user = await getUser(payment.userId);

  if (!user) {
    return;
  }

  return sendBrandedEmail({
    user,
    type: payment.paymentKind === 'recurring_renewal' ? 'auto_renew_success' : 'payment_success',
    subject:
      payment.paymentKind === 'recurring_renewal'
        ? 'Your UG Movies 247 auto-renewal was successful'
        : 'Payment successful',
    title: payment.paymentKind === 'recurring_renewal' ? 'Auto-renewal successful' : 'Payment successful',
    intro: `Your payment for ${payment.planName} was confirmed.`,
    lines: [
      `Amount: ${formatMoney(payment.amount, payment.currency)}`,
      `Access valid until: ${formatDate(payment.expiresAt)}`,
    ],
    dedupeKey: `${payment.paymentKind === 'recurring_renewal' ? 'auto_renew_success' : 'payment_success'}:${payment.id}`,
  });
}

export async function sendPaymentFailedEmail(payment: PaymentAttemptDocument) {
  const user = await getUser(payment.userId);

  if (!user) {
    return;
  }

  const isAutoRenewal = payment.paymentKind === 'recurring_renewal';

  return sendBrandedEmail({
    user,
    type: isAutoRenewal ? 'auto_renew_failed' : 'payment_failed',
    subject: isAutoRenewal ? 'Your UG Movies 247 auto-renewal failed' : 'Payment failed',
    title: isAutoRenewal ? 'Auto-renewal failed' : 'Payment failed',
    intro: isAutoRenewal
      ? `We were unable to complete the automatic renewal for your ${payment.planName}.`
      : `Your payment for ${payment.planName} could not be completed.`,
    lines: isAutoRenewal
      ? [
          'No immediate action is required if your current plan is still active. Once it expires, access may pause unless payment is completed.',
          'Please review your payment method to avoid interruption.',
        ]
      : [
          payment.failureReason || payment.providerMessage || 'Please try again when you are ready.',
          'Your account access is only affected if your current plan has expired.',
        ],
    dedupeKey: `${isAutoRenewal ? 'auto_renew_failed' : 'payment_failed'}:${payment.id}:${payment.status}`,
  });
}

export async function sendSubscriptionActivatedEmail(payment: PaymentAttemptDocument) {
  const user = await getUser(payment.userId);

  if (!user) {
    return;
  }

  return sendBrandedEmail({
    user,
    type: 'subscription_activated',
    subject: 'Your UG Movies 247 subscription is active',
    title: 'Subscription activated',
    intro: `Your ${payment.planName} is now active.`,
    lines: [
      `Started: ${formatDate(payment.startsAt)}`,
      `Expires: ${formatDate(payment.expiresAt)}`,
      'You can now continue watching premium movies and series.',
    ],
    ctaLabel: 'Start Watching',
    ctaHref: `${getBaseUrl()}/browse`,
    dedupeKey: `subscription_activated:${payment.id}`,
  });
}

export async function sendSubscriptionCancelledEmail(
  userId: string,
  agreement?: Partial<RecurringAgreementDocument> | null
) {
  const user = await getUser(userId);

  if (!user) {
    return;
  }

  return sendBrandedEmail({
    user,
    type: 'subscription_cancelled',
    subject: 'UG Movies 247 auto-renewal cancelled',
    title: 'Auto-renewal cancelled',
    intro: 'Your card auto-renewal has been cancelled.',
    lines: [
      'You can keep watching until your current premium access expires.',
      'You can restart auto-renewal from your subscription page anytime.',
    ],
    dedupeKey: `subscription_cancelled:${userId}:${agreement?.cancelledAt || nowIso()}`,
  });
}

async function sendPlanExpiringEmail(user: EmailUser, subscription: UserSubscriptionDocument, windowKey: string) {
  return sendBrandedEmail({
    user,
    type: 'plan_expiring_soon',
    subject: 'Your UG Movies 247 plan is expiring soon',
    title: 'Plan expiring soon',
    intro: `Your ${subscription.planName || 'premium plan'} is ending soon.`,
    lines: [
      `Expires: ${formatDate(subscription.expiresAt)}`,
      'Renew when you are ready to keep premium access active.',
    ],
    ctaLabel: 'Renew Plan',
    ctaHref: `${getBaseUrl()}/subscribe`,
    dedupeKey: `plan_expiring_soon:${subscription.userId}:${subscription.expiresAt}:${windowKey}`,
  });
}

async function sendSubscriptionExpiredEmail(user: EmailUser, subscription: UserSubscriptionDocument) {
  return sendBrandedEmail({
    user,
    type: 'subscription_expired',
    subject: 'Your UG Movies 247 subscription has expired',
    title: 'Subscription expired',
    intro: `Your ${subscription.planName || 'premium plan'} has expired.`,
    lines: ['Renew your plan anytime to continue watching premium movies and series.'],
    ctaLabel: 'Renew Access',
    ctaHref: `${getBaseUrl()}/subscribe`,
    dedupeKey: `subscription_expired:${subscription.userId}:${subscription.expiresAt}`,
  });
}

function shouldSendAutoRenewReminder(
  agreement: RecurringAgreementDocument,
  remainingMs: number,
  oneDayMs: number,
) {
  const failedChargeAttempts = Number(agreement.failedChargeAttempts || 0);
  const lastChargeStatus = String(agreement.lastChargeStatus || '').toLowerCase();

  if (remainingMs <= 0 || remainingMs > oneDayMs) {
    return false;
  }

  if (
    agreement.status === 'cancelled' ||
    agreement.status === 'payment_failed' ||
    agreement.status === 'needs_attention' ||
    failedChargeAttempts > 0 ||
    lastChargeStatus === 'payment_failed'
  ) {
    return false;
  }

  // Daily plans renew too frequently for reminder emails to feel useful.
  return agreement.planType !== 'daily';
}

async function sendAutoRenewReminderEmail(user: EmailUser, agreement: RecurringAgreementDocument) {
  return sendBrandedEmail({
    user,
    type: 'auto_renew_reminder',
    subject: 'Your UG Movies 247 auto-renewal is coming up',
    title: 'Auto-renewal reminder',
    intro: `Your ${agreement.planName || 'premium plan'} will renew soon.`,
    lines: [
      `Next billing date: ${formatDate(agreement.nextChargeAt)}`,
      `Amount: ${formatMoney(agreement.amount, agreement.currency)}`,
      'Cancel auto-renewal anytime before renewal.',
    ],
    ctaLabel: 'Manage Renewal',
    ctaHref: `${getBaseUrl()}/subscribe`,
    dedupeKey: `auto_renew_reminder:${agreement.userId}:${agreement.nextChargeAt}`,
  });
}

async function hasActiveCardAutoRenew(subscription: UserSubscriptionDocument) {
  if (subscription.paymentProvider !== 'payfast') {
    return false;
  }

  if (subscription.autoRenewEnabled === true && subscription.nextChargeAt) {
    return true;
  }

  try {
    const snapshot = await adminDb
      .collection('subscription_recurring_agreements')
      .doc(subscription.userId)
      .get();

    if (!snapshot.exists) {
      return false;
    }

    const agreement = snapshot.data() as RecurringAgreementDocument;

    return Boolean(
      agreement.autoRenewEnabled === true &&
        agreement.status !== 'cancelled' &&
        agreement.token &&
        agreement.nextChargeAt
    );
  } catch {
    return false;
  }
}

function isMonthPlan(planType?: SubscriptionPlanType | null) {
  const plan = planType ? SUBSCRIPTION_PLANS[planType] : null;
  return plan?.durationUnit === 'months';
}

export async function processScheduledTransactionalEmails(limit = 50) {
  const now = Date.now();
  const sixHoursMs = 1000 * 60 * 60 * 6;
  const oneDayMs = 1000 * 60 * 60 * 24;
  const threeDaysMs = oneDayMs * 3;

  const subscriptionSnapshot = await adminDb
    .collection('user_subscriptions')
    .where('status', '==', 'active')
    .limit(limit)
    .get()
    .catch(() => null);

  for (const doc of subscriptionSnapshot?.docs || []) {
    const subscription = doc.data() as UserSubscriptionDocument;
    const expiresAtMs = new Date(subscription.expiresAt || '').getTime();

    if (!Number.isFinite(expiresAtMs)) {
      continue;
    }

    const user = await getUser(subscription.userId);

    if (!user) {
      continue;
    }

    const remainingMs = expiresAtMs - now;
    const cardAutoRenewActive = await hasActiveCardAutoRenew(subscription);

    if (cardAutoRenewActive) {
      continue;
    }

    if (remainingMs <= 0) {
      await sendSubscriptionExpiredEmail(user, subscription);
      await import('@/lib/server/subscriptions').then(({ syncUserSubscriptionSnapshot }) =>
        Promise.all([
          adminDb.collection('user_subscriptions').doc(subscription.userId).set(
            {
              status: 'expired',
              isActive: false,
              updatedAt: nowIso(),
            },
            { merge: true }
          ),
          syncUserSubscriptionSnapshot(subscription.userId, {
            ...subscription,
            status: 'expired',
            isActive: false,
            updatedAt: nowIso(),
          }),
        ])
      ).catch((error) => {
        console.warn('[emails] failed to mark subscription expired after email', error);
      });
      continue;
    }

    if (subscription.planType === 'daily' && remainingMs <= sixHoursMs) {
      await sendPlanExpiringEmail(user, subscription, 'daily_6h');
      continue;
    }

    if (isMonthPlan(subscription.planType)) {
      if (remainingMs <= oneDayMs) {
        await sendPlanExpiringEmail(user, subscription, 'monthly_1d');
      } else if (remainingMs <= threeDaysMs) {
        await sendPlanExpiringEmail(user, subscription, 'monthly_3d');
      }
    }
  }

  const recurringSnapshot = await adminDb
    .collection('subscription_recurring_agreements')
    .where('autoRenewEnabled', '==', true)
    .limit(limit)
    .get()
    .catch(() => null);

  for (const doc of recurringSnapshot?.docs || []) {
    const agreement = doc.data() as RecurringAgreementDocument;
    const nextChargeAtMs = new Date(agreement.nextChargeAt || '').getTime();

    if (!Number.isFinite(nextChargeAtMs)) {
      continue;
    }

    const remainingMs = nextChargeAtMs - now;

    if (!shouldSendAutoRenewReminder(agreement, remainingMs, oneDayMs)) {
      continue;
    }

    const user = await getUser(agreement.userId);

    if (user) {
      await sendAutoRenewReminderEmail(user, agreement);
    }
  }
}
