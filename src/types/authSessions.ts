export type AuthSessionStatus = 'active' | 'inactive' | 'replaced' | 'revoked' | 'logged_out';

export type AuthSessionEndedReason =
  | 'same_device_relogin'
  | 'device_limit_replaced'
  | 'session_limit_reconciliation'
  | 'admin_force_logout'
  | 'admin_reset'
  | 'logout'
  | '';

export type AuthInvalidReason = 'session_missing' | 'session_replaced' | 'session_revoked';

export type AuthSessionRecord = {
  id?: string;
  userId: string;
  deviceId: string;
  sessionTokenHash: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastActivityAt: string;
  isActive: boolean;
  status: AuthSessionStatus;
  endedAt: string;
  endedReason: AuthSessionEndedReason;
  replacedBySessionId: string;
};

export type UserAuthSessionState = {
  userId: string;
  sessionIds: string[];
  updatedAt: string;
};

export type AdminAuthSessionSummary = {
  id: string;
  deviceId: string;
  deviceName: string;
  browserName: string;
  platformName: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastActivityAt: string;
  isActive: boolean;
  status: AuthSessionStatus;
  endedAt: string;
  endedReason: AuthSessionEndedReason;
  replacedBySessionId: string;
};

export type AdminAuthSessionAuditAction = 'force_logout_device' | 'reset_all_sessions';

export type AdminAuthSessionAuditLog = {
  id?: string;
  actionType: AdminAuthSessionAuditAction;
  adminUserId: string;
  adminEmail: string;
  adminName: string;
  targetUserId: string;
  targetUserEmail: string;
  targetUserName: string;
  targetSessionId: string;
  note: string;
  oldState: Record<string, unknown>;
  newState: Record<string, unknown>;
  createdAt: string;
};
