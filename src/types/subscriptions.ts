export type SubscriptionPlanType =
  | 'daily'
  | 'seven_days'
  | 'fourteen_days'
  | 'monthly'
  | 'two_months'
  | 'three_months'
  | 'six_months'
  | 'twelve_months';
export type SubscriptionCurrency = 'UGX' | 'ZAR';
export type SubscriptionStatus = 'inactive' | 'active' | 'expired' | 'cancelled';
export type PaymentProvider = 'pawapay' | 'payfast';
export type PaymentMethodProvider = string;
export type CheckoutPaymentMethod = 'mobile_money' | 'card';
export type CardCheckoutMode = 'once_off' | 'auto_renew';
export type PaymentKind = 'once_off' | 'recurring_enrollment' | 'recurring_renewal';
export type PaymentTriggerSource = 'user' | 'scheduler' | 'webhook';
export type PaymentAttemptStatus =
  | 'created'
  | 'initiated'
  | 'pending'
  | 'submitted'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'not_found'
  | 'needs_attention';
export type RecurringAgreementStatus =
  | 'inactive'
  | 'pending_setup'
  | 'active'
  | 'cancelled'
  | 'payment_failed'
  | 'needs_attention';

export type SubscriptionPlanDefinition = {
  type: SubscriptionPlanType;
  name: string;
  amount: number;
  currency: SubscriptionCurrency;
  durationUnit: 'days' | 'months';
  durationValue: number;
  description: string;
};

export type SubscriptionSnapshot = {
  planType: SubscriptionPlanType | null;
  planName: string;
  status: SubscriptionStatus;
  isActive: boolean;
  startsAt: string;
  expiresAt: string;
  paymentProvider: PaymentProvider | '';
  updatedAt: string;
};

export type UserSubscriptionDocument = {
  userId: string;
  planType: SubscriptionPlanType | null;
  planName: string;
  amount: number;
  currency: SubscriptionCurrency;
  status: SubscriptionStatus;
  paymentProvider: PaymentProvider | '';
  providerTransactionId: string;
  latestPaymentId: string;
  startsAt: string;
  expiresAt: string;
  isActive: boolean;
  recurringAgreementId: string;
  autoRenewEnabled: boolean;
  nextChargeAt: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentAttemptDocument = {
  id?: string;
  userId: string;
  planType: SubscriptionPlanType;
  planName: string;
  amount: number;
  currency: SubscriptionCurrency;
  status: PaymentAttemptStatus;
  paymentKind: PaymentKind;
  paymentProvider: PaymentProvider;
  paymentMethodProvider: PaymentMethodProvider;
  phoneNumber: string;
  providerTransactionId: string;
  providerDepositId: string;
  providerStatus: string;
  providerMessage: string;
  providerResponse?: Record<string, unknown>;
  providerCallbackPayload?: Record<string, unknown>;
  clientReferenceId: string;
  recurringAgreementId: string;
  recurringTokenLast4: string;
  isAutoRenewal: boolean;
  triggerSource: PaymentTriggerSource;
  startsAt: string;
  expiresAt: string;
  isActive: boolean;
  activationAppliedAt: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string;
  webhookReceivedAt: string;
};

export type RecurringAgreementDocument = {
  id?: string;
  userId: string;
  planType: SubscriptionPlanType;
  planName: string;
  status: RecurringAgreementStatus;
  paymentProvider: 'payfast';
  amount: number;
  currency: 'ZAR';
  token: string;
  tokenCapturedAt: string;
  tokenSourcePaymentId: string;
  autoRenewEnabled: boolean;
  nextChargeAt: string;
  lastChargeAt: string;
  lastChargeStatus: string;
  lastChargeAttemptAt: string;
  lastPaymentId: string;
  billingAnchorDay: number;
  pendingPaymentId: string;
  processingLockUntil: string;
  cancelledAt: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
};

export type RecurringAgreementSummary = {
  status: RecurringAgreementStatus;
  planType: SubscriptionPlanType | null;
  planName: string;
  amount: number;
  currency: 'ZAR';
  autoRenewEnabled: boolean;
  nextChargeAt: string;
  lastChargeAt: string;
  lastChargeStatus: string;
  lastPaymentId: string;
  tokenAvailable: boolean;
  pendingPaymentId: string;
  failureReason: string;
};

export type SubscriptionEntitlement = {
  hasPremiumAccess: boolean;
  requiresSubscription: boolean;
  subscription: SubscriptionSnapshot;
};

export type PaymentMethodProviderOption = {
  id: PaymentMethodProvider;
  label: string;
  country?: string;
};

export type CardPaymentGateway = {
  id: 'payfast';
  label: string;
  processor: string;
  billedBy: string;
  trustMessage: string;
  currency: 'ZAR';
  enabled: boolean;
  supportsAutoRenew: boolean;
  autoRenewError: string;
  planPrices: Partial<Record<SubscriptionPlanType, number>>;
};

export type UserPaymentHistoryEntry = {
  id: string;
  planType: SubscriptionPlanType;
  planName: string;
  status: PaymentAttemptStatus;
  startsAt: string;
  expiresAt: string;
  daysLeft: number | null;
  paymentMethodLabel: string;
  paymentMethodProvider: PaymentMethodProvider | '';
  paymentProvider: PaymentProvider;
  providerStatus: string;
  createdAt: string;
  billedBy: string;
  isAutoRenewal: boolean;
  paymentKind: PaymentKind;
};
