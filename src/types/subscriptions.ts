export type SubscriptionPlanType = 'daily' | 'monthly';
export type SubscriptionCurrency = 'UGX' | 'ZAR';
export type SubscriptionStatus = 'inactive' | 'active' | 'expired' | 'cancelled';
export type PaymentProvider = 'pawapay' | 'payfast';
export type PaymentMethodProvider = string;
export type CheckoutPaymentMethod = 'mobile_money' | 'card';
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
};
