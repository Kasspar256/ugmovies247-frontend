export type TransactionalEmailType =
  | 'welcome_verify'
  | 'password_reset'
  | 'password_changed'
  | 'payment_success'
  | 'payment_failed'
  | 'subscription_activated'
  | 'plan_expiring_soon'
  | 'subscription_expired'
  | 'auto_renew_reminder'
  | 'auto_renew_success'
  | 'auto_renew_failed'
  | 'subscription_cancelled';

export type TransactionalEmailStatus = 'sent' | 'failed' | 'skipped';

export type TransactionalEmailLogDocument = {
  userId: string;
  email: string;
  type: TransactionalEmailType;
  status: TransactionalEmailStatus;
  dedupeKey: string;
  providerResponse: string;
  error: string;
  createdAt: string;
};

