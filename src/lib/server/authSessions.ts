import { createHash, randomBytes, randomUUID } from 'crypto';
import type {
  DocumentData,
  DocumentReference,
  Transaction,
} from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  AUTH_DEVICE_COOKIE,
  AUTH_DEVICE_SESSION_COOKIE,
  AUTH_SESSION_ACTIVE_WINDOW_MS,
} from '@/lib/auth/constants';
import { CLIENT_DEVICE_ID_HEADER, CLIENT_DEVICE_SESSION_HEADER } from '@/lib/auth/deviceIdentity';
import { getDeviceLimitForSubscriptionSnapshot } from '@/lib/server/subscriptions';
import type { SubscriptionSnapshot } from '@/types/subscriptions';
import type {
  AdminAuthSessionAuditLog,
  AdminAuthSessionSummary,
  AuthInvalidReason,
  AuthSessionEndedReason,
  AuthSessionRecord,
  AuthSessionStatus,
  UserAuthSessionState,
} from '@/types/authSessions';

const AUTH_SESSIONS_COLLECTION = 'auth_sessions';
const USER_AUTH_SESSION_STATE_COLLECTION = 'user_auth_session_state';
const AUTH_SESSION_ADMIN_AUDIT_LOGS_COLLECTION = 'auth_session_admin_audit_logs';
const SESSION_COOKIE_SEPARATOR = '.';
const SESSION_VALIDATION_CACHE_MS = 1000 * 60 * 5;
const SESSION_ACTIVITY_SYNC_INTERVAL_MS = 1000 * 60 * 5;

export const AUTH_DEVICE_LIMIT_EXCEEDED_CODE = 'auth/device-limit-exceeded';
export const AUTH_DEVICE_LIMIT_EXCEEDED_MESSAGE =
  'This account is already active on the maximum number of allowed devices. Please log out from another device and try again.';

type ManagedSessionValidation =
  | {
      valid: true;
      deviceId: string;
      sessionId: string;
      sessionToken: string;
      record: AuthSessionRecord & { id: string };
    }
  | {
      valid: false;
      reason: AuthInvalidReason;
      deviceId: string;
      sessionId: string;
      sessionToken: string;
      record: (AuthSessionRecord & { id: string }) | null;
    };

type SessionRegistrationResult = {
  deviceId: string;
  deviceCookieValue: string;
  sessionId: string;
  sessionToken: string;
  sessionCookieValue: string;
};

type SessionTransactionState = {
  stateRef: DocumentReference<DocumentData>;
  sessionRecords: Array<AuthSessionRecord & { id: string }>;
};

type AuthSessionAdminActor = {
  adminUserId: string;
  adminEmail: string;
  adminName: string;
};

type CachedManagedSessionEntry = {
  validation: ManagedSessionValidation;
  userId: string;
  deviceId: string;
  sessionTokenHash: string;
  cachedAtMs: number;
  lastSyncedAtMs: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __ugmoviesManagedSessionValidationCache: Map<string, CachedManagedSessionEntry> | undefined;
}

const sessionValidationCache =
  globalThis.__ugmoviesManagedSessionValidationCache ||
  (globalThis.__ugmoviesManagedSessionValidationCache = new Map<string, CachedManagedSessionEntry>());

export class DeviceLimitExceededError extends Error {
  code = AUTH_DEVICE_LIMIT_EXCEEDED_CODE;
  status = 409;

  constructor() {
    super(AUTH_DEVICE_LIMIT_EXCEEDED_MESSAGE);
    this.name = 'DeviceLimitExceededError';
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toIsoString(value: unknown) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    return '';
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function parseTime(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function buildOpaqueToken() {
  return `${randomUUID()}${randomBytes(16).toString('hex')}`;
}

function cloneManagedSessionValidation(validation: ManagedSessionValidation): ManagedSessionValidation {
  if (validation.valid) {
    return {
      ...validation,
      record: normalizeAuthSessionRecord(validation.record.id, validation.record),
    };
  }

  return {
    ...validation,
    record: validation.record
      ? normalizeAuthSessionRecord(validation.record.id, validation.record)
      : null,
  };
}

function deleteManagedSessionCache(sessionId: string) {
  if (!sessionId) {
    return;
  }

  sessionValidationCache.delete(sessionId);
}

function cacheManagedSessionValidation(
  validation: ManagedSessionValidation,
  options: {
    userId: string;
    lastSyncedAtMs?: number;
  }
) {
  if (!validation.sessionId) {
    return;
  }

  const sessionTokenHash =
    validation.record?.sessionTokenHash ||
    (validation.sessionToken ? hashSessionToken(validation.sessionToken) : '');

  if (!sessionTokenHash) {
    return;
  }

  const nowMs = Date.now();
  const inferredLastSyncedAtMs = validation.record
    ? parseTime(validation.record.lastActivityAt) ||
      parseTime(validation.record.endedAt) ||
      parseTime(validation.record.createdAt) ||
      nowMs
    : nowMs;

  sessionValidationCache.set(validation.sessionId, {
    validation: cloneManagedSessionValidation(validation),
    userId: options.userId,
    deviceId: validation.deviceId,
    sessionTokenHash,
    cachedAtMs: nowMs,
    lastSyncedAtMs: options.lastSyncedAtMs ?? inferredLastSyncedAtMs,
  });
}

function getCachedManagedSessionValidation(options: {
  userId: string;
  deviceId: string;
  sessionId: string;
  sessionToken: string;
}) {
  const cached = sessionValidationCache.get(options.sessionId);

  if (!cached) {
    return null;
  }

  if (Date.now() - cached.cachedAtMs > SESSION_VALIDATION_CACHE_MS) {
    sessionValidationCache.delete(options.sessionId);
    return null;
  }

  if (
    cached.userId !== options.userId ||
    cached.deviceId !== options.deviceId ||
    cached.sessionTokenHash !== hashSessionToken(options.sessionToken)
  ) {
    return null;
  }

  return cloneManagedSessionValidation(cached.validation);
}

function getCachedSessionSyncTimestamp(sessionId: string) {
  return sessionValidationCache.get(sessionId)?.lastSyncedAtMs || 0;
}

function getRequestCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get('cookie') || '';
  const parts = cookieHeader.split(';').map((entry) => entry.trim());
  const matches = parts.filter((entry) => entry.startsWith(`${name}=`));

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const value = decodeURIComponent(matches[index].slice(name.length + 1));

    if (value) {
      return value;
    }
  }

  return '';
}

function getRequestIpAddress(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for') || '';
  const realIp = request.headers.get('x-real-ip') || '';

  return forwardedFor.split(',')[0]?.trim() || realIp.trim() || 'unknown';
}

function getRequestUserAgent(request: Request) {
  return request.headers.get('user-agent') || 'unknown';
}

function normalizeDeviceId(value: string) {
  const normalized = value.trim();

  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(normalized)) {
    return '';
  }

  return normalized;
}

function detectPlatformName(userAgent: string) {
  if (/iphone/i.test(userAgent)) {
    return 'iPhone';
  }

  if (/ipad/i.test(userAgent)) {
    return 'iPad';
  }

  if (/android/i.test(userAgent)) {
    return 'Android';
  }

  if (/windows/i.test(userAgent)) {
    return 'Windows';
  }

  if (/macintosh|mac os x/i.test(userAgent)) {
    return 'macOS';
  }

  if (/linux/i.test(userAgent)) {
    return 'Linux';
  }

  return 'Unknown Platform';
}

function detectBrowserName(userAgent: string) {
  if (/edg\//i.test(userAgent)) {
    return 'Edge';
  }

  if (/opr\//i.test(userAgent)) {
    return 'Opera';
  }

  if (/samsungbrowser/i.test(userAgent)) {
    return 'Samsung Internet';
  }

  if (/firefox\//i.test(userAgent)) {
    return 'Firefox';
  }

  if (/chrome\//i.test(userAgent) && !/edg\//i.test(userAgent) && !/opr\//i.test(userAgent)) {
    return 'Chrome';
  }

  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) {
    return 'Safari';
  }

  return 'Unknown Browser';
}

function buildDeviceName(userAgent: string) {
  const platformName = detectPlatformName(userAgent);
  const browserName = detectBrowserName(userAgent);
  const isMobile =
    /mobile|iphone|android/i.test(userAgent) && !/ipad|tablet/i.test(userAgent);
  const formFactor = isMobile ? 'Phone' : /ipad|tablet/i.test(userAgent) ? 'Tablet' : 'Desktop';

  if (platformName === 'Unknown Platform' && browserName === 'Unknown Browser') {
    return 'Unknown Device';
  }

  if (platformName === 'Unknown Platform') {
    return `${browserName} ${formFactor}`;
  }

  return `${platformName} ${formFactor}`;
}

function buildSessionCookieValue(sessionId: string, sessionToken: string) {
  return `${sessionId}${SESSION_COOKIE_SEPARATOR}${sessionToken}`;
}

function parseSessionCookieValue(value: string) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf(SESSION_COOKIE_SEPARATOR);

  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
    return null;
  }

  return {
    sessionId: normalized.slice(0, separatorIndex),
    sessionToken: normalized.slice(separatorIndex + 1),
  };
}

function isEndedStatus(status: AuthSessionStatus) {
  return status === 'replaced' || status === 'revoked' || status === 'logged_out';
}

function getLastActivityAt(record: Pick<AuthSessionRecord, 'lastActivityAt' | 'createdAt'>) {
  return parseTime(record.lastActivityAt) || parseTime(record.createdAt) || 0;
}

function isWithinActiveWindow(record: Pick<AuthSessionRecord, 'lastActivityAt' | 'createdAt'>) {
  const lastSeenAt = getLastActivityAt(record);

  if (!lastSeenAt) {
    return false;
  }

  return Date.now() - lastSeenAt <= AUTH_SESSION_ACTIVE_WINDOW_MS;
}

function normalizeSessionStatus(record: AuthSessionRecord) {
  if (isEndedStatus(record.status)) {
    return record.status;
  }

  return isWithinActiveWindow(record) ? 'active' : 'inactive';
}

function normalizeAuthSessionRecord(
  id: string,
  data: Partial<AuthSessionRecord> | null | undefined
): AuthSessionRecord & { id: string } {
  const createdAt = toIsoString(data?.createdAt) || nowIso();
  const lastActivityAt = toIsoString(data?.lastActivityAt) || createdAt;
  const base: AuthSessionRecord & { id: string } = {
    id,
    userId: String(data?.userId || ''),
    deviceId: String(data?.deviceId || ''),
    sessionTokenHash: String(data?.sessionTokenHash || ''),
    ipAddress: String(data?.ipAddress || 'unknown'),
    userAgent: String(data?.userAgent || 'unknown'),
    createdAt,
    lastActivityAt,
    isActive: data?.isActive === true,
    status: (data?.status || 'inactive') as AuthSessionStatus,
    endedAt: toIsoString(data?.endedAt),
    endedReason: (data?.endedReason || '') as AuthSessionEndedReason,
    replacedBySessionId: String(data?.replacedBySessionId || ''),
  };

  const normalizedStatus = normalizeSessionStatus(base);

  if (!isEndedStatus(base.status)) {
    base.status = normalizedStatus;
    base.isActive = normalizedStatus === 'active';
  }

  return base;
}

function summarizeSession(record: AuthSessionRecord & { id: string }): AdminAuthSessionSummary {
  const platformName = detectPlatformName(record.userAgent);
  const browserName = detectBrowserName(record.userAgent);

  return {
    id: record.id,
    deviceId: record.deviceId,
    deviceName: buildDeviceName(record.userAgent),
    browserName,
    platformName,
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    isActive: record.isActive,
    status: record.status,
    endedAt: record.endedAt,
    endedReason: record.endedReason,
    replacedBySessionId: record.replacedBySessionId,
  };
}

async function loadSessionTransactionState(
  transaction: Transaction,
  userId: string
): Promise<SessionTransactionState> {
  const stateRef = adminDb.collection(USER_AUTH_SESSION_STATE_COLLECTION).doc(userId);
  const stateSnapshot = await transaction.get(stateRef);
  const stateData = stateSnapshot.exists
    ? (stateSnapshot.data() as Partial<UserAuthSessionState>)
    : null;
  const storedSessionIds = Array.isArray(stateData?.sessionIds)
    ? stateData.sessionIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const sessionRefs = storedSessionIds.map((sessionId) =>
    adminDb.collection(AUTH_SESSIONS_COLLECTION).doc(sessionId)
  );
  const sessionSnapshots = sessionRefs.length ? await transaction.getAll(...sessionRefs) : [];
  const sessionRecords = sessionSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) =>
      normalizeAuthSessionRecord(
        snapshot.id,
        snapshot.data() as Partial<AuthSessionRecord> | undefined
      )
    );

  return {
    stateRef,
    sessionRecords,
  };
}

function sortByLeastRecentActivity(
  left: Pick<AuthSessionRecord, 'lastActivityAt' | 'createdAt'>,
  right: Pick<AuthSessionRecord, 'lastActivityAt' | 'createdAt'>
) {
  return getLastActivityAt(left) - getLastActivityAt(right);
}

function pickDeviceLimitReplacement(
  records: Array<AuthSessionRecord & { id: string }>,
  currentUserAgent: string
) {
  const eligibleRecords = records.filter((record) => !isEndedStatus(record.status));
  const inactiveCandidate = eligibleRecords
    .filter((record) => record.status === 'inactive' || record.isActive !== true)
    .sort(sortByLeastRecentActivity)[0];

  if (inactiveCandidate) {
    return inactiveCandidate;
  }

  const normalizedUserAgent = currentUserAgent.trim().toLowerCase();
  const sameBrowserCandidate = eligibleRecords
    .filter((record) => record.userAgent.trim().toLowerCase() === normalizedUserAgent)
    .sort(sortByLeastRecentActivity)[0];

  if (sameBrowserCandidate) {
    return sameBrowserCandidate;
  }

  return [...eligibleRecords].sort(sortByLeastRecentActivity)[0] || null;
}


function pruneSessionRecords(
  transaction: Transaction,
  records: Array<AuthSessionRecord & { id: string }>
) {
  const activeRecords: Array<AuthSessionRecord & { id: string }> = [];

  records.forEach((record) => {
    if (isEndedStatus(record.status)) {
      return;
    }

    const normalizedStatus = normalizeSessionStatus(record);
    const nextIsActive = normalizedStatus === 'active';

    if (record.status !== normalizedStatus || record.isActive !== nextIsActive) {
      transaction.set(
        adminDb.collection(AUTH_SESSIONS_COLLECTION).doc(record.id),
        {
          status: normalizedStatus,
          isActive: nextIsActive,
        },
        { merge: true }
      );

      record.status = normalizedStatus;
      record.isActive = nextIsActive;
    }

    activeRecords.push(record);
  });

  return activeRecords;
}

function setEndedSession(
  transaction: Transaction,
  record: AuthSessionRecord & { id: string },
  options: {
    status: Extract<AuthSessionStatus, 'replaced' | 'revoked' | 'logged_out'>;
    endedReason: AuthSessionEndedReason;
    endedAt: string;
    replacedBySessionId?: string;
  }
) {
  transaction.set(
    adminDb.collection(AUTH_SESSIONS_COLLECTION).doc(record.id),
    {
      status: options.status,
      isActive: false,
      endedAt: options.endedAt,
      endedReason: options.endedReason,
      replacedBySessionId: options.replacedBySessionId || '',
    },
    { merge: true }
  );

  record.status = options.status;
  record.isActive = false;
  record.endedAt = options.endedAt;
  record.endedReason = options.endedReason;
  record.replacedBySessionId = options.replacedBySessionId || '';
}

function writeStateDocument(
  transaction: Transaction,
  stateRef: DocumentReference<DocumentData>,
  userId: string,
  sessionIds: string[],
  timestamp: string
) {
  transaction.set(
    stateRef,
    {
      userId,
      sessionIds,
      updatedAt: timestamp,
    } satisfies UserAuthSessionState,
    { merge: true }
  );
}

function buildDeviceLimit(role: string | undefined, subscriptionSnapshot?: SubscriptionSnapshot | null) {
  if (role === 'admin') {
    return Number.POSITIVE_INFINITY;
  }

  return getDeviceLimitForSubscriptionSnapshot(subscriptionSnapshot || null, role);
}

export function getManagedDeviceCookieFromRequest(request: Request) {
  return (
    normalizeDeviceId(getRequestCookieValue(request, AUTH_DEVICE_COOKIE)) ||
    normalizeDeviceId(String(request.headers.get(CLIENT_DEVICE_ID_HEADER) || ''))
  );
}

export function getManagedSessionCookieFromRequest(request: Request) {
  return (
    getRequestCookieValue(request, AUTH_DEVICE_SESSION_COOKIE) ||
    String(request.headers.get(CLIENT_DEVICE_SESSION_HEADER) || '').trim()
  );
}

export async function createManagedAuthSession(options: {
  request: Request;
  userId: string;
  role?: string;
  subscriptionSnapshot?: SubscriptionSnapshot | null;
  deviceLimit?: number;
}): Promise<SessionRegistrationResult> {
  const timestamp = nowIso();
  const deviceId = getManagedDeviceCookieFromRequest(options.request) || randomUUID();
  const sessionId = randomUUID();
  const sessionToken = buildOpaqueToken();
  const sessionTokenHash = hashSessionToken(sessionToken);
  const ipAddress = getRequestIpAddress(options.request);
  const userAgent = getRequestUserAgent(options.request);
  const deviceLimit =
    typeof options.deviceLimit === 'number'
      ? options.deviceLimit
      : buildDeviceLimit(options.role, options.subscriptionSnapshot);
  const sessionRef = adminDb.collection(AUTH_SESSIONS_COLLECTION).doc(sessionId);
  const endedSessionIds = new Set<string>();
  const nowMs = Date.now();

  await adminDb.runTransaction(async (transaction) => {
    const state = await loadSessionTransactionState(transaction, options.userId);
    const activeRecords = pruneSessionRecords(transaction, state.sessionRecords);

    activeRecords
      .filter((record) => record.deviceId === deviceId)
      .forEach((record) => {
        setEndedSession(transaction, record, {
          status: 'replaced',
          endedReason: 'same_device_relogin',
          endedAt: timestamp,
          replacedBySessionId: sessionId,
        });
        endedSessionIds.add(record.id);
      });

    let nextSessionIds = activeRecords
      .filter((record) => !isEndedStatus(record.status))
      .map((record) => record.id);

    while (Number.isFinite(deviceLimit) && nextSessionIds.length >= deviceLimit) {
      const replacementCandidate = pickDeviceLimitReplacement(activeRecords, userAgent);

      if (!replacementCandidate) {
        throw new DeviceLimitExceededError();
      }

      setEndedSession(transaction, replacementCandidate, {
        status: 'replaced',
        endedReason: 'device_limit_replaced',
        endedAt: timestamp,
        replacedBySessionId: sessionId,
      });
      endedSessionIds.add(replacementCandidate.id);

      nextSessionIds = activeRecords
        .filter((record) => !isEndedStatus(record.status))
        .map((record) => record.id);
    }

    const nextRecord: AuthSessionRecord = {
      userId: options.userId,
      deviceId,
      sessionTokenHash,
      ipAddress,
      userAgent,
      createdAt: timestamp,
      lastActivityAt: timestamp,
      isActive: true,
      status: 'active',
      endedAt: '',
      endedReason: '',
      replacedBySessionId: '',
    };

    transaction.set(sessionRef, nextRecord);
    writeStateDocument(transaction, state.stateRef, options.userId, [...nextSessionIds, sessionId], timestamp);
  });

  endedSessionIds.forEach(deleteManagedSessionCache);

  cacheManagedSessionValidation(
    {
      valid: true,
      deviceId,
      sessionId,
      sessionToken,
      record: normalizeAuthSessionRecord(sessionId, {
        userId: options.userId,
        deviceId,
        sessionTokenHash,
        ipAddress,
        userAgent,
        createdAt: timestamp,
        lastActivityAt: timestamp,
        isActive: true,
        status: 'active',
        endedAt: '',
        endedReason: '',
        replacedBySessionId: '',
      }),
    },
    {
      userId: options.userId,
      lastSyncedAtMs: nowMs,
    }
  );

  return {
    deviceId,
    deviceCookieValue: deviceId,
    sessionId,
    sessionToken,
    sessionCookieValue: buildSessionCookieValue(sessionId, sessionToken),
  };
}

export async function validateManagedAuthSessionFromCookieValues(options: {
  userId: string;
  deviceId: string;
  managedSessionCookie: string;
}): Promise<ManagedSessionValidation> {
  const deviceId = String(options.deviceId || '').trim();
  const parsedCookie = parseSessionCookieValue(options.managedSessionCookie);

  if (!deviceId || !parsedCookie) {
    return {
      valid: false,
      reason: 'session_missing',
      deviceId: deviceId || '',
      sessionId: parsedCookie?.sessionId || '',
      sessionToken: parsedCookie?.sessionToken || '',
      record: null,
    };
  }

  const cachedValidation = getCachedManagedSessionValidation({
    userId: options.userId,
    deviceId,
    sessionId: parsedCookie.sessionId,
    sessionToken: parsedCookie.sessionToken,
  });

  if (cachedValidation) {
    return cachedValidation;
  }

  const snapshot = await adminDb.collection(AUTH_SESSIONS_COLLECTION).doc(parsedCookie.sessionId).get();

  if (!snapshot.exists) {
    const validation: ManagedSessionValidation = {
      valid: false,
      reason: 'session_missing',
      deviceId,
      sessionId: parsedCookie.sessionId,
      sessionToken: parsedCookie.sessionToken,
      record: null,
    };

    cacheManagedSessionValidation(validation, { userId: options.userId });
    return validation;
  }

  const record = normalizeAuthSessionRecord(
    snapshot.id,
    snapshot.data() as Partial<AuthSessionRecord> | undefined
  );

  if (
    record.userId !== options.userId ||
    record.deviceId !== deviceId ||
    record.sessionTokenHash !== hashSessionToken(parsedCookie.sessionToken)
  ) {
    const validation: ManagedSessionValidation = {
      valid: false,
      reason: 'session_missing',
      deviceId,
      sessionId: parsedCookie.sessionId,
      sessionToken: parsedCookie.sessionToken,
      record,
    };

    cacheManagedSessionValidation(validation, { userId: options.userId });
    return validation;
  }

  if (record.status === 'replaced') {
    const validation: ManagedSessionValidation = {
      valid: false,
      reason: 'session_replaced',
      deviceId,
      sessionId: parsedCookie.sessionId,
      sessionToken: parsedCookie.sessionToken,
      record,
    };

    cacheManagedSessionValidation(validation, { userId: options.userId });
    return validation;
  }

  if (record.status === 'revoked' || record.status === 'logged_out') {
    const validation: ManagedSessionValidation = {
      valid: false,
      reason: 'session_revoked',
      deviceId,
      sessionId: parsedCookie.sessionId,
      sessionToken: parsedCookie.sessionToken,
      record,
    };

    cacheManagedSessionValidation(validation, { userId: options.userId });
    return validation;
  }

  if (record.status === 'active' && !isWithinActiveWindow(record)) {
    record.status = 'inactive';
    record.isActive = false;
  }

  const validation: ManagedSessionValidation = {
    valid: true,
    deviceId,
    sessionId: parsedCookie.sessionId,
    sessionToken: parsedCookie.sessionToken,
    record,
  };

  cacheManagedSessionValidation(validation, { userId: options.userId });
  return validation;
}

export async function validateManagedAuthSessionFromSessionValue(options: {
  deviceId?: string;
  managedSessionCookie: string;
}): Promise<ManagedSessionValidation> {
  const deviceId = normalizeDeviceId(String(options.deviceId || ''));
  const parsedCookie = parseSessionCookieValue(options.managedSessionCookie);

  if (!parsedCookie) {
    return {
      valid: false,
      reason: 'session_missing',
      deviceId,
      sessionId: '',
      sessionToken: '',
      record: null,
    };
  }

  const snapshot = await adminDb.collection(AUTH_SESSIONS_COLLECTION).doc(parsedCookie.sessionId).get();

  if (!snapshot.exists) {
    return {
      valid: false,
      reason: 'session_missing',
      deviceId,
      sessionId: parsedCookie.sessionId,
      sessionToken: parsedCookie.sessionToken,
      record: null,
    };
  }

  const record = normalizeAuthSessionRecord(
    snapshot.id,
    snapshot.data() as Partial<AuthSessionRecord> | undefined
  );

  if (
    (deviceId && record.deviceId !== deviceId) ||
    record.sessionTokenHash !== hashSessionToken(parsedCookie.sessionToken)
  ) {
    return {
      valid: false,
      reason: 'session_missing',
      deviceId,
      sessionId: parsedCookie.sessionId,
      sessionToken: parsedCookie.sessionToken,
      record,
    };
  }

  if (record.status === 'replaced') {
    return {
      valid: false,
      reason: 'session_replaced',
      deviceId: record.deviceId,
      sessionId: parsedCookie.sessionId,
      sessionToken: parsedCookie.sessionToken,
      record,
    };
  }

  if (record.status === 'revoked' || record.status === 'logged_out') {
    return {
      valid: false,
      reason: 'session_revoked',
      deviceId: record.deviceId,
      sessionId: parsedCookie.sessionId,
      sessionToken: parsedCookie.sessionToken,
      record,
    };
  }

  if (record.status === 'active' && !isWithinActiveWindow(record)) {
    record.status = 'inactive';
    record.isActive = false;
  }

  const validation: ManagedSessionValidation = {
    valid: true,
    deviceId: record.deviceId,
    sessionId: parsedCookie.sessionId,
    sessionToken: parsedCookie.sessionToken,
    record,
  };

  cacheManagedSessionValidation(validation, { userId: record.userId });
  return validation;
}

export async function validateManagedAuthSession(options: {
  request: Request;
  userId: string;
}) {
  return validateManagedAuthSessionFromCookieValues({
    userId: options.userId,
    deviceId: getManagedDeviceCookieFromRequest(options.request),
    managedSessionCookie: getManagedSessionCookieFromRequest(options.request),
  });
}

export async function touchManagedAuthSession(options: {
  request: Request;
  userId: string;
}) {
  const validation = await validateManagedAuthSession(options);

  if (!validation.valid) {
    return validation;
  }

  const timestamp = nowIso();
  const nowMs = Date.now();
  const ipAddress = getRequestIpAddress(options.request);
  const userAgent = getRequestUserAgent(options.request);
  const shouldPersistActivity =
    validation.record.status !== 'active' ||
    validation.record.isActive !== true ||
    nowMs - getCachedSessionSyncTimestamp(validation.record.id) >= SESSION_ACTIVITY_SYNC_INTERVAL_MS;

  if (shouldPersistActivity) {
    await adminDb.collection(AUTH_SESSIONS_COLLECTION).doc(validation.record.id).set(
      {
        ipAddress,
        userAgent,
        lastActivityAt: timestamp,
        isActive: true,
        status: 'active',
      },
      { merge: true }
    );
  }

  const nextValidation: ManagedSessionValidation = {
    ...validation,
    record: {
      ...validation.record,
      ipAddress,
      userAgent,
      lastActivityAt: timestamp,
      isActive: true,
      status: 'active' as const,
    },
  };

  cacheManagedSessionValidation(nextValidation, {
    userId: options.userId,
    lastSyncedAtMs: shouldPersistActivity ? nowMs : getCachedSessionSyncTimestamp(validation.record.id) || nowMs,
  });

  return nextValidation;
}

export async function endManagedAuthSession(options: {
  request: Request;
  userId: string;
  endedReason?: AuthSessionEndedReason;
}) {
  const validation = await validateManagedAuthSession(options);

  if (!validation.valid) {
    return validation;
  }

  const timestamp = nowIso();

  await adminDb.runTransaction(async (transaction) => {
    const state = await loadSessionTransactionState(transaction, options.userId);
    const nextSessionIds = state.sessionRecords
      .filter((record) => record.id !== validation.record.id && !isEndedStatus(record.status))
      .map((record) => record.id);

    setEndedSession(transaction, validation.record, {
      status: 'logged_out',
      endedReason: options.endedReason || 'logout',
      endedAt: timestamp,
    });
    writeStateDocument(transaction, state.stateRef, options.userId, nextSessionIds, timestamp);
  });

  deleteManagedSessionCache(validation.record.id);

  return validation;
}

export async function enforceDeviceSessionLimit(
  userId: string,
  options?: {
    role?: string;
    subscriptionSnapshot?: SubscriptionSnapshot | null;
    deviceLimit?: number;
  }
) {
  const limit =
    typeof options?.deviceLimit === 'number'
      ? options.deviceLimit
      : buildDeviceLimit(options?.role, options?.subscriptionSnapshot);
  const timestamp = nowIso();
  const endedSessionIds = new Set<string>();

  await adminDb.runTransaction(async (transaction) => {
    const state = await loadSessionTransactionState(transaction, userId);
    const activeRecords = pruneSessionRecords(transaction, state.sessionRecords);

    if (!Number.isFinite(limit)) {
      writeStateDocument(
        transaction,
        state.stateRef,
        userId,
        activeRecords.filter((record) => !isEndedStatus(record.status)).map((record) => record.id),
        timestamp
      );
      return;
    }

    const eligibleRecords = activeRecords.filter((record) => !isEndedStatus(record.status));

    if (eligibleRecords.length <= limit) {
      writeStateDocument(
        transaction,
        state.stateRef,
        userId,
        eligibleRecords.map((record) => record.id),
        timestamp
      );
      return;
    }

    const removableRecords = [...eligibleRecords].sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? 1 : -1;
      }

      return sortByLeastRecentActivity(left, right);
    });
    const recordsToEnd = removableRecords.slice(0, Math.max(0, eligibleRecords.length - limit));

    recordsToEnd.forEach((record) => {
      setEndedSession(transaction, record, {
        status: 'revoked',
        endedReason: 'session_limit_reconciliation',
        endedAt: timestamp,
      });
      endedSessionIds.add(record.id);
    });

    writeStateDocument(
      transaction,
      state.stateRef,
      userId,
      eligibleRecords
        .filter((record) => !recordsToEnd.some((candidate) => candidate.id === record.id))
        .map((record) => record.id),
      timestamp
    );
  });

  endedSessionIds.forEach(deleteManagedSessionCache);
}

export async function listManagedAuthSessionsForUser(userId: string) {
  const stateSnapshot = await adminDb.collection(USER_AUTH_SESSION_STATE_COLLECTION).doc(userId).get();
  const stateData = stateSnapshot.exists
    ? (stateSnapshot.data() as Partial<UserAuthSessionState>)
    : null;
  const sessionIds = Array.isArray(stateData?.sessionIds)
    ? stateData.sessionIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];

  if (!sessionIds.length) {
    return [];
  }

  const sessionRefs = sessionIds.map((sessionId) => adminDb.collection(AUTH_SESSIONS_COLLECTION).doc(sessionId));
  const sessionSnapshots = await adminDb.getAll(...sessionRefs);
  const sessions = sessionSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) =>
      normalizeAuthSessionRecord(
        snapshot.id,
        snapshot.data() as Partial<AuthSessionRecord> | undefined
      )
    )
    .map((record) => {
      if (record.status === 'inactive' || isWithinActiveWindow(record)) {
        return record;
      }

      return {
        ...record,
        status: 'inactive' as const,
        isActive: false,
      };
    })
    .sort((left, right) => getLastActivityAt(right) - getLastActivityAt(left));

  return sessions.map(summarizeSession);
}

export async function forceLogoutManagedAuthSession(options: {
  userId: string;
  sessionId: string;
  admin: AuthSessionAdminActor;
  note: string;
  targetUserEmail: string;
  targetUserName: string;
}) {
  const timestamp = nowIso();
  let oldState: Record<string, unknown> = {};
  let newState: Record<string, unknown> = {};

  await adminDb.runTransaction(async (transaction) => {
    const state = await loadSessionTransactionState(transaction, options.userId);
    const targetRecord = state.sessionRecords.find((record) => record.id === options.sessionId);

    if (!targetRecord) {
      throw new Error('That device session could not be found.');
    }

    oldState = summarizeSession(targetRecord);
    setEndedSession(transaction, targetRecord, {
      status: 'revoked',
      endedReason: 'admin_force_logout',
      endedAt: timestamp,
    });
    newState = summarizeSession(targetRecord);

    writeStateDocument(
      transaction,
      state.stateRef,
      options.userId,
      state.sessionRecords
        .filter((record) => record.id !== options.sessionId && !isEndedStatus(record.status))
        .map((record) => record.id),
      timestamp
    );
  });

  deleteManagedSessionCache(options.sessionId);

  await logAuthSessionAdminAudit({
    actionType: 'force_logout_device',
    adminUserId: options.admin.adminUserId,
    adminEmail: options.admin.adminEmail,
    adminName: options.admin.adminName,
    targetUserId: options.userId,
    targetUserEmail: options.targetUserEmail,
    targetUserName: options.targetUserName,
    targetSessionId: options.sessionId,
    note: options.note,
    oldState,
    newState,
    createdAt: timestamp,
  });
}

export async function resetManagedAuthSessions(options: {
  userId: string;
  admin: AuthSessionAdminActor;
  note: string;
  targetUserEmail: string;
  targetUserName: string;
}) {
  const timestamp = nowIso();
  const oldState: Record<string, unknown> = {};
  const newState: Record<string, unknown> = {};

  await adminDb.runTransaction(async (transaction) => {
    const state = await loadSessionTransactionState(transaction, options.userId);

    state.sessionRecords.forEach((record) => {
      oldState[record.id] = summarizeSession(record);
      setEndedSession(transaction, record, {
        status: 'revoked',
        endedReason: 'admin_reset',
        endedAt: timestamp,
      });
      newState[record.id] = summarizeSession(record);
    });

    writeStateDocument(transaction, state.stateRef, options.userId, [], timestamp);
  });

  Object.keys(oldState).forEach(deleteManagedSessionCache);

  await logAuthSessionAdminAudit({
    actionType: 'reset_all_sessions',
    adminUserId: options.admin.adminUserId,
    adminEmail: options.admin.adminEmail,
    adminName: options.admin.adminName,
    targetUserId: options.userId,
    targetUserEmail: options.targetUserEmail,
    targetUserName: options.targetUserName,
    targetSessionId: '',
    note: options.note,
    oldState,
    newState,
    createdAt: timestamp,
  });
}

export async function logAuthSessionAdminAudit(entry: AdminAuthSessionAuditLog) {
  await adminDb.collection(AUTH_SESSION_ADMIN_AUDIT_LOGS_COLLECTION).add(entry);
}

export async function listAuthSessionAdminAuditLogs(options?: {
  userId?: string;
  limit?: number;
}) {
  const baseQuery = adminDb.collection(AUTH_SESSION_ADMIN_AUDIT_LOGS_COLLECTION);
  const snapshot = await (options?.userId
    ? baseQuery.where('targetUserId', '==', options.userId).limit(options?.limit || 20).get()
    : baseQuery.limit(options?.limit || 20).get()).catch(async () =>
    baseQuery.limit(options?.limit || 20).get()
  );

  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...(doc.data() as AdminAuthSessionAuditLog),
    }))
    .filter((entry) => !options?.userId || entry.targetUserId === options.userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, options?.limit || 20);
}
