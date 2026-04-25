import { createHash, randomBytes } from 'crypto';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

type EmailTokenType = 'email_verification' | 'password_reset';

type EmailTokenDocument = {
  userId: string;
  email: string;
  type: EmailTokenType;
  expiresAt: string;
  usedAt: string;
  createdAt: string;
};

const EMAIL_TOKENS_COLLECTION = 'auth_email_tokens';
const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 48;
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60;

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function createRawToken() {
  return randomBytes(32).toString('base64url');
}

async function createEmailToken(options: {
  userId: string;
  email: string;
  type: EmailTokenType;
  ttlMs: number;
}) {
  const token = createRawToken();
  const timestamp = nowIso();
  const doc: EmailTokenDocument = {
    userId: options.userId,
    email: options.email.trim().toLowerCase(),
    type: options.type,
    expiresAt: new Date(Date.now() + options.ttlMs).toISOString(),
    usedAt: '',
    createdAt: timestamp,
  };

  await adminDb.collection(EMAIL_TOKENS_COLLECTION).doc(hashToken(token)).set(doc);
  return token;
}

async function consumeEmailToken(token: string, type: EmailTokenType) {
  const tokenHash = hashToken(token);
  const ref = adminDb.collection(EMAIL_TOKENS_COLLECTION).doc(tokenHash);
  const timestamp = nowIso();

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists) {
      return { ok: false as const, reason: 'invalid' as const };
    }

    const data = snapshot.data() as EmailTokenDocument;
    const expiresAtMs = new Date(data.expiresAt || '').getTime();

    if (data.type !== type) {
      return { ok: false as const, reason: 'invalid' as const };
    }

    if (data.usedAt) {
      return { ok: false as const, reason: 'used' as const };
    }

    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return { ok: false as const, reason: 'expired' as const };
    }

    transaction.set(ref, { usedAt: timestamp }, { merge: true });
    return { ok: true as const, token: data };
  });
}

export async function createEmailVerificationToken(userId: string, email: string) {
  return createEmailToken({
    userId,
    email,
    type: 'email_verification',
    ttlMs: EMAIL_VERIFICATION_TTL_MS,
  });
}

export async function createPasswordResetToken(userId: string, email: string) {
  return createEmailToken({
    userId,
    email,
    type: 'password_reset',
    ttlMs: PASSWORD_RESET_TTL_MS,
  });
}

export async function verifyEmailToken(token: string) {
  const consumed = await consumeEmailToken(token, 'email_verification');

  if (!consumed.ok) {
    return consumed;
  }

  const timestamp = nowIso();

  await Promise.all([
    adminDb.collection('users').doc(consumed.token.userId).set(
      {
        emailVerified: true,
        emailVerifiedAt: timestamp,
        updatedAt: timestamp,
      },
      { merge: true }
    ),
    adminAuth.updateUser(consumed.token.userId, { emailVerified: true }).catch(() => undefined),
  ]);

  return consumed;
}

export async function consumePasswordResetToken(token: string) {
  return consumeEmailToken(token, 'password_reset');
}

