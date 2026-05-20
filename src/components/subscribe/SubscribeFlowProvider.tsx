'use client';

import {
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  useRouter,
  useSearchParams,
} from 'next/navigation';
import { fetchPublicMovies } from '@/lib/publicMovies';
import { isNativeAndroidApp } from '@/lib/mobile/nativeApp';
import { openExternalCheckout } from '@/lib/mobile/externalCheckout';
import type {
  CardPaymentGateway,
  PaymentMethodProvider,
  PaymentMethodProviderOption,
  RecurringAgreementSummary,
  SubscriptionEntitlement,
  SubscriptionPlanDefinition,
  SubscriptionPlanType,
} from '@/types/subscriptions';
import {
  getSafeReturnTo,
  sortProviderOptions,
} from './subscribeFlowUtils';

type SubscriptionResponse = {
  plans: SubscriptionPlanDefinition[];
  providers: PaymentMethodProviderOption[];
  cardGateway: CardPaymentGateway;
  entitlement: SubscriptionEntitlement;
  recurringAgreement: RecurringAgreementSummary;
  emailVerified?: boolean;
};

type PaymentState = {
  id: string;
  status: string;
  providerStatus: string;
  providerMessage: string;
  paymentProvider: 'pawapay' | 'payfast';
};

type CheckoutResponse = {
  success?: boolean;
  paymentId?: string;
  status?: string;
  providerStatus?: string;
  message?: string;
  error?: string;
  detail?: string;
  redirect?: {
    action: string;
    method: 'POST';
    fields: Record<string, string>;
  };
  checkoutUrl?: string;
};

type FlowPaymentMethod = '' | 'mobile_money' | 'card';

type SubscribeFlowContextValue = {
  loading: boolean;
  loadError: string;
  submitting: boolean;
  plans: SubscriptionPlanDefinition[];
  entitlement: SubscriptionEntitlement;
  recurringAgreement: RecurringAgreementSummary;
  providers: PaymentMethodProviderOption[];
  sortedProviders: PaymentMethodProviderOption[];
  cardGateway: CardPaymentGateway;
  safeReturnTo: string;
  selectedPlan: SubscriptionPlanType | '';
  setSelectedPlan: (plan: SubscriptionPlanType | '') => void;
  selectedPlanDefinition: SubscriptionPlanDefinition | null;
  paymentMethod: FlowPaymentMethod;
  setPaymentMethod: (method: FlowPaymentMethod) => void;
  provider: PaymentMethodProvider;
  setProvider: (providerId: PaymentMethodProvider) => void;
  selectedProviderOption: PaymentMethodProviderOption | null;
  phoneNumber: string;
  setPhoneNumber: (phoneNumber: string) => void;
  cardAvailable: boolean;
  selectedCardAmount: number;
  selectedPlanHasCardPricing: boolean;
  canPayWithCard: boolean;
  canPayWithMobileMoney: boolean;
  hasActiveSubscription: boolean;
  hasPendingCardUpdate: boolean;
  activePayment: PaymentState | null;
  error: string;
  message: string;
  emailVerified: boolean;
  clearFeedback: () => void;
  startMobileMoneyCheckout: () => Promise<boolean>;
  startCardCheckout: () => Promise<boolean>;
};

const STORAGE_KEY = 'ugmovies247.subscribe-flow.v2';
const SUBSCRIPTION_DATA_CACHE_KEY = 'ugmovies247.subscribe-data.v1';
const SUBSCRIPTION_DATA_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

const DEFAULT_ENTITLEMENT: SubscriptionEntitlement = {
  hasPremiumAccess: false,
  requiresSubscription: true,
  subscription: {
    planType: null,
    planName: '',
    status: 'inactive',
    isActive: false,
    startsAt: '',
    expiresAt: '',
    paymentProvider: '',
    updatedAt: '',
  },
};

const EMPTY_CARD_GATEWAY: CardPaymentGateway = {
  id: 'payfast',
  label: 'Card Payment',
  processor: '',
  billedBy: '',
  trustMessage: '',
  currency: 'ZAR',
  enabled: false,
  supportsAutoRenew: false,
  autoRenewError: '',
  planPrices: {},
};

const EMPTY_RECURRING_AGREEMENT: RecurringAgreementSummary = {
  status: 'inactive',
  planType: null,
  planName: '',
  amount: 0,
  currency: 'ZAR',
  autoRenewEnabled: false,
  nextChargeAt: '',
  lastChargeAt: '',
  lastChargeStatus: '',
  lastPaymentId: '',
  tokenAvailable: false,
  pendingPaymentId: '',
  failureReason: '',
};

const SubscribeFlowContext = createContext<SubscribeFlowContextValue | null>(null);

async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();

  if (!raw.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (primaryError) {
    const firstStructuredCharacter = raw.search(/[{\[]/);

    if (firstStructuredCharacter > 0) {
      const candidate = raw.slice(firstStructuredCharacter);

      try {
        return JSON.parse(candidate) as T;
      } catch {
        // Fall through to the detailed error below.
      }
    }

    throw new Error(
      raw.length > 220
        ? `${raw.slice(0, 220).trim()}...`
        : raw.trim() ||
            (primaryError instanceof Error ? primaryError.message : 'Invalid JSON response.')
    );
  }
}

async function refreshUnlockedCatalog() {
  try {
    await fetchPublicMovies({ force: true, refreshEntitlement: true });
  } catch (error) {
    console.warn('[subscribe] failed to refresh public movie catalog after subscription change', error);
  }
}

function readCachedSubscriptionData() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SUBSCRIPTION_DATA_CACHE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      value?: SubscriptionResponse;
      cachedAt?: number;
    };

    if (!parsed.value || typeof parsed.cachedAt !== 'number') {
      return null;
    }

    if (Date.now() - parsed.cachedAt > SUBSCRIPTION_DATA_CACHE_TTL_MS) {
      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
}

function persistSubscriptionData(value: SubscriptionResponse) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      SUBSCRIPTION_DATA_CACHE_KEY,
      JSON.stringify({
        value,
        cachedAt: Date.now(),
      })
    );
  } catch {
    // Checkout can continue without persistent plan data.
  }
}

function submitHostedPaymentForm(redirect: NonNullable<CheckoutResponse['redirect']>) {
  const form = document.createElement('form');
  form.method = redirect.method;
  form.action = redirect.action;
  form.style.display = 'none';

  if (process.env.NODE_ENV !== 'production' && redirect.fields.subscription_type === '2') {
    console.info('[subscriptions] payfast tokenization browser form debug', {
      action: redirect.action,
      method: redirect.method,
      fieldOrder: Object.keys(redirect.fields),
      fields: redirect.fields,
    });
  }

  Object.entries(redirect.fields).forEach(([key, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
}

export function SubscribeFlowProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPlan = searchParams.get('plan') || '';
  const requestedMethod = searchParams.get('payment') || '';
  const requestedPaymentId = searchParams.get('paymentId') || '';
  const cancelledPayment = searchParams.get('cancelled') === '1';
  const requestedReturnTo = getSafeReturnTo(searchParams.get('returnTo'));

  const [draftReady, setDraftReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [plans, setPlans] = useState<SubscriptionPlanDefinition[]>([]);
  const [entitlement, setEntitlement] = useState<SubscriptionEntitlement>(DEFAULT_ENTITLEMENT);
  const [recurringAgreement, setRecurringAgreement] = useState<RecurringAgreementSummary>(
    EMPTY_RECURRING_AGREEMENT
  );
  const [providers, setProviders] = useState<PaymentMethodProviderOption[]>([]);
  const [cardGateway, setCardGateway] = useState<CardPaymentGateway>(EMPTY_CARD_GATEWAY);
  const [safeReturnTo, setSafeReturnTo] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanType | ''>('');
  const [paymentMethod, setPaymentMethod] = useState<FlowPaymentMethod>('');
  const [provider, setProvider] = useState<PaymentMethodProvider>('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');
  const [emailVerified, setEmailVerified] = useState(true);
  const [error, setError] = useState('');
  const [activePayment, setActivePayment] = useState<PaymentState | null>(null);
  const [showUpgradeSuccess, setShowUpgradeSuccess] = useState(false);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);

  const sortedProviders = useMemo(() => sortProviderOptions(providers), [providers]);
  const selectedPlanDefinition = useMemo(
    () => plans.find((plan) => plan.type === selectedPlan) || null,
    [plans, selectedPlan]
  );
  const selectedProviderOption = useMemo(
    () => sortedProviders.find((entry) => entry.id === provider) || null,
    [provider, sortedProviders]
  );
  const cardAvailable = cardGateway.enabled && cardGateway.supportsAutoRenew;
  const selectedCardAmount = selectedPlanDefinition
    ? cardGateway.planPrices[selectedPlanDefinition.type] || 0
    : 0;
  const selectedPlanHasCardPricing = Boolean(selectedCardAmount);
  const hasActiveSubscription = entitlement.subscription.isActive;
  const hasPendingCardUpdate =
    recurringAgreement.status === 'pending_setup' && Boolean(recurringAgreement.pendingPaymentId);
  const canPayWithCard =
    paymentMethod === 'card' &&
    selectedPlanHasCardPricing &&
    cardAvailable;
  const canPayWithMobileMoney =
    paymentMethod === 'mobile_money' && Boolean(selectedProviderOption) && Boolean(phoneNumber.trim());

  const clearFeedback = useCallback(() => {
    setError('');
    setMessage('');
  }, []);

  const applySubscriptionData = useCallback((payload: SubscriptionResponse) => {
    setPlans(payload.plans || []);
    setProviders(payload.providers || []);
    setEntitlement(payload.entitlement || DEFAULT_ENTITLEMENT);
    setCardGateway(payload.cardGateway || EMPTY_CARD_GATEWAY);
    setRecurringAgreement(payload.recurringAgreement || EMPTY_RECURRING_AGREEMENT);
    setEmailVerified(payload.emailVerified === true);
  }, []);

  const loadSubscriptionData = useCallback(async () => {
    const response = await fetch('/api/subscriptions/me', {
      credentials: 'include',
      cache: 'no-store',
    });
    const payload = await readJsonResponse<SubscriptionResponse & { error?: string }>(response);

    if (!response.ok) {
      const cachedSubscriptionData = readCachedSubscriptionData();

      if (cachedSubscriptionData) {
        applySubscriptionData(cachedSubscriptionData);
        return cachedSubscriptionData;
      }

      throw new Error(
        response.status === 401
          ? 'We are reconnecting your account. Please try opening premium plans again in a moment.'
          : payload.error || 'Failed to load subscription plans.'
      );
    }

    applySubscriptionData(payload);
    persistSubscriptionData(payload);

    if (payload.entitlement) {
      void refreshUnlockedCatalog();
    }

    return payload;
  }, [applySubscriptionData]);

  const syncCompletedPayment = useCallback(async () => {
    const subscriptionPayload = await loadSubscriptionData();
    setEntitlement(subscriptionPayload.entitlement || DEFAULT_ENTITLEMENT);

    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }

    setShowUpgradeSuccess(true);
    setRedirectCountdown(4);
  }, [loadSubscriptionData]);

  const refreshNativeCheckoutState = useCallback(async () => {
    await loadSubscriptionData();
    await refreshUnlockedCatalog();
  }, [loadSubscriptionData]);

  const applyPaymentResult = useCallback(
    async (payment: {
      id?: string;
      status?: string;
      providerStatus?: string;
      providerMessage?: string;
      paymentProvider?: 'pawapay' | 'payfast';
    }) => {
      const nextPayment: PaymentState = {
        id: payment.id || '',
        status: payment.status || 'submitted',
        providerStatus: payment.providerStatus || '',
        providerMessage: payment.providerMessage || '',
        paymentProvider: payment.paymentProvider || 'payfast',
      };

      setActivePayment(nextPayment);

      if (nextPayment.status === 'completed') {
        setMessage('Payment confirmed. Your subscription is now active. Redirecting you to home...');
        setError('');
        await syncCompletedPayment();
        return;
      }

      if (nextPayment.status === 'failed' || nextPayment.status === 'cancelled') {
        setError(
          nextPayment.paymentProvider === 'payfast'
            ? 'Card payment was not completed. Please try again or use Mobile Money.'
            : nextPayment.providerMessage || 'Payment was not completed.'
        );
        setMessage('');
        return;
      }

      if (nextPayment.paymentProvider === 'payfast') {
        setMessage('We are waiting for your card payment confirmation. Keep this page open for the status update.');
        setError('');
        return;
      }

      setMessage(
        nextPayment.providerMessage || 'Payment request sent. Complete the Mobile Money prompt on your phone.'
      );
      setError('');
    },
    [syncCompletedPayment]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      setDraftReady(true);
      return;
    }

    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);

      if (raw) {
        const parsed = JSON.parse(raw) as {
          selectedPlan?: string;
          paymentMethod?: FlowPaymentMethod;
          provider?: string;
          phoneNumber?: string;
          returnTo?: string;
        };

        setSelectedPlan((parsed.selectedPlan || '') as SubscriptionPlanType | '');
        setPaymentMethod(parsed.paymentMethod || '');
        setProvider(parsed.provider || '');
        setPhoneNumber(parsed.phoneNumber || '');
        setSafeReturnTo(getSafeReturnTo(parsed.returnTo));
      }
    } catch (storageError) {
      console.warn('[subscribe] failed to restore checkout draft', storageError);
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) {
      return;
    }

    if (requestedReturnTo) {
      setSafeReturnTo(requestedReturnTo);
    }
  }, [draftReady, requestedReturnTo]);

  useEffect(() => {
    if (!draftReady || typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selectedPlan,
        paymentMethod,
        provider,
        phoneNumber,
        returnTo: safeReturnTo,
      })
    );
  }, [draftReady, paymentMethod, phoneNumber, provider, safeReturnTo, selectedPlan]);

  useEffect(() => {
    if (!draftReady) {
      return;
    }

    let mounted = true;

    const load = async () => {
      const cachedSubscriptionData = readCachedSubscriptionData();

      if (cachedSubscriptionData) {
        applySubscriptionData(cachedSubscriptionData);
        setLoading(false);
      }

      try {
        setLoadError('');
        await loadSubscriptionData();
      } catch (loadSubscriptionError) {
        if (mounted && !cachedSubscriptionData) {
          setLoadError(
            loadSubscriptionError instanceof Error
              ? loadSubscriptionError.message
              : 'Failed to load subscription plans.'
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [applySubscriptionData, draftReady, loadSubscriptionData]);

  useEffect(() => {
    if (!plans.length) {
      return;
    }

    const nextPlan = plans.find((plan) => plan.type === requestedPlan);

    if (nextPlan) {
      setSelectedPlan(nextPlan.type);
      return;
    }

    if (selectedPlan && !plans.some((plan) => plan.type === selectedPlan)) {
      setSelectedPlan('');
    }
  }, [plans, requestedPlan, selectedPlan]);

  useEffect(() => {
    const methods: FlowPaymentMethod[] = [];

    if (sortedProviders.length) {
      methods.push('mobile_money');
    }

    if (cardAvailable && selectedPlanHasCardPricing) {
      methods.push('card');
    }

    if (requestedMethod === 'card' && cardAvailable && selectedPlanHasCardPricing) {
      setPaymentMethod('card');
      return;
    }

    if (requestedMethod === 'mobile_money' && sortedProviders.length) {
      setPaymentMethod('mobile_money');
      return;
    }

    if (paymentMethod && !methods.includes(paymentMethod)) {
      setPaymentMethod('');
    }
  }, [cardAvailable, paymentMethod, requestedMethod, selectedPlanHasCardPricing, sortedProviders.length]);

  useEffect(() => {
    if (!sortedProviders.length) {
      setProvider('');
      return;
    }

    if (!sortedProviders.some((entry) => entry.id === provider)) {
      setProvider(sortedProviders[0].id);
    }
  }, [provider, sortedProviders]);

  useEffect(() => {
    if (!requestedPaymentId) {
      return;
    }

    let cancelled = false;

    const hydratePayment = async () => {
      try {
        if (cancelledPayment) {
          await fetch(`/api/subscriptions/payments/${requestedPaymentId}/cancel`, {
            method: 'POST',
            credentials: 'include',
          }).catch(() => undefined);
        }

        const response = await fetch(`/api/subscriptions/payments/${requestedPaymentId}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await readJsonResponse<{ payment?: PaymentState }>(response);

        if (cancelled || !response.ok || !payload.payment) {
          return;
        }

        await applyPaymentResult(payload.payment);
      } catch {
        return;
      }
    };

    void hydratePayment();

    return () => {
      cancelled = true;
    };
  }, [applyPaymentResult, cancelledPayment, requestedPaymentId]);

  useEffect(() => {
    if (!activePayment || ['completed', 'failed', 'cancelled', 'not_found'].includes(activePayment.status)) {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/subscriptions/payments/${activePayment.id}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await readJsonResponse<{ payment?: PaymentState }>(response);

        if (!response.ok || !payload.payment) {
          return;
        }

        await applyPaymentResult(payload.payment);
      } catch {
        return;
      }
    }, activePayment.paymentProvider === 'payfast' ? 5000 : 8000);

    return () => window.clearInterval(interval);
  }, [activePayment, applyPaymentResult]);

  useEffect(() => {
    if (!showUpgradeSuccess) {
      return;
    }

    const countdownInterval = window.setInterval(() => {
      setRedirectCountdown((current) => {
        if (current === null) {
          return current;
        }

        return current > 1 ? current - 1 : 1;
      });
    }, 1000);

    const redirectTimer = window.setTimeout(() => {
      router.replace('/');
    }, 4000);

    return () => {
      window.clearInterval(countdownInterval);
      window.clearTimeout(redirectTimer);
    };
  }, [router, showUpgradeSuccess]);

  const startMobileMoneyCheckout = useCallback(async () => {
    if (!selectedPlanDefinition || !selectedProviderOption || !phoneNumber.trim()) {
      return false;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    setShowUpgradeSuccess(false);
    setRedirectCountdown(null);

    try {
      if (isNativeAndroidApp()) {
        const response = await fetch('/api/subscriptions/external-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            planType: selectedPlanDefinition.type,
            paymentMethod: 'mobile_money',
            provider,
            phoneNumber,
            returnTo: safeReturnTo,
          }),
        });
        const payload = await readJsonResponse<CheckoutResponse>(response);

        if (!response.ok || !payload.checkoutUrl) {
          throw new Error(payload.detail || payload.error || 'Failed to open payment checkout.');
        }

        setMessage('Opening secure payment checkout...');
        await openExternalCheckout(payload.checkoutUrl, refreshNativeCheckoutState);
        return true;
      }

      const response = await fetch('/api/subscriptions/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          planType: selectedPlanDefinition.type,
          paymentMethod: 'mobile_money',
          provider,
          phoneNumber,
          returnTo: safeReturnTo,
        }),
      });
      const payload = await readJsonResponse<CheckoutResponse>(response);

      if (!response.ok) {
        throw new Error(payload.detail || payload.error || 'Failed to start payment.');
      }

      const nextPayment: PaymentState = {
        id: payload.paymentId || '',
        status: payload.status || 'initiated',
        providerStatus: payload.providerStatus || '',
        providerMessage: payload.message || '',
        paymentProvider: 'pawapay',
      };

      setActivePayment(nextPayment);
      setMessage('Payment request sent. Approve it on your phone.');
      return true;
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Failed to start payment.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [
    phoneNumber,
    provider,
    refreshNativeCheckoutState,
    safeReturnTo,
    selectedPlanDefinition,
    selectedProviderOption,
  ]);

  const startCardCheckout = useCallback(async () => {
    if (!selectedPlanDefinition || !selectedCardAmount || !cardAvailable) {
      return false;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    setShowUpgradeSuccess(false);
    setRedirectCountdown(null);

    try {
      if (isNativeAndroidApp()) {
        const response = await fetch('/api/subscriptions/external-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            planType: selectedPlanDefinition.type,
            paymentMethod: 'card',
            returnTo: safeReturnTo,
          }),
        });
        const payload = await readJsonResponse<CheckoutResponse>(response);

        if (!response.ok || !payload.checkoutUrl) {
          throw new Error(payload.detail || payload.error || 'Failed to open payment checkout.');
        }

        setMessage('Opening secure card checkout...');
        await openExternalCheckout(payload.checkoutUrl, refreshNativeCheckoutState);
        return true;
      }

      const response = await fetch('/api/subscriptions/auto-renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'enroll',
          planType: selectedPlanDefinition.type,
          returnTo: safeReturnTo,
        }),
      });
      const payload = await readJsonResponse<CheckoutResponse>(response);

      if (!response.ok) {
        throw new Error(payload.detail || payload.error || 'Failed to start payment.');
      }

      const nextPayment: PaymentState = {
        id: payload.paymentId || '',
        status: payload.status || 'submitted',
        providerStatus: payload.providerStatus || '',
        providerMessage: payload.message || '',
        paymentProvider: 'payfast',
      };

      setActivePayment(nextPayment);
      setMessage('Redirecting to secure card checkout.');

      if (payload.redirect) {
        submitHostedPaymentForm(payload.redirect);
      }

      return true;
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Failed to start payment.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [cardAvailable, refreshNativeCheckoutState, safeReturnTo, selectedCardAmount, selectedPlanDefinition]);

  const contextValue = useMemo<SubscribeFlowContextValue>(
    () => ({
      loading: loading || !draftReady,
      loadError,
      submitting,
      plans,
      entitlement,
      recurringAgreement,
      providers,
      sortedProviders,
      cardGateway,
      safeReturnTo,
      selectedPlan,
      setSelectedPlan,
      selectedPlanDefinition,
      paymentMethod,
      setPaymentMethod,
      provider,
      setProvider,
      selectedProviderOption,
      phoneNumber,
      setPhoneNumber,
      cardAvailable,
      selectedCardAmount,
      selectedPlanHasCardPricing,
      canPayWithCard,
      canPayWithMobileMoney,
      hasActiveSubscription,
      hasPendingCardUpdate,
      activePayment,
      error,
      message,
      emailVerified,
      clearFeedback,
      startMobileMoneyCheckout,
      startCardCheckout,
    }),
    [
      activePayment,
      canPayWithCard,
      canPayWithMobileMoney,
      cardAvailable,
      cardGateway,
      clearFeedback,
      draftReady,
      entitlement,
      emailVerified,
      error,
      hasActiveSubscription,
      hasPendingCardUpdate,
      loadError,
      loading,
      message,
      paymentMethod,
      phoneNumber,
      plans,
      provider,
      providers,
      recurringAgreement,
      safeReturnTo,
      selectedCardAmount,
      selectedPlanHasCardPricing,
      selectedPlan,
      selectedPlanDefinition,
      selectedProviderOption,
      sortedProviders,
      startCardCheckout,
      startMobileMoneyCheckout,
      submitting,
    ]
  );

  return (
    <SubscribeFlowContext.Provider value={contextValue}>
      {showUpgradeSuccess ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#0B0C10]/88 px-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-[28px] border border-emerald-500/20 bg-[#11141C] p-6 text-center shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
              <CheckCircle2 size={32} />
            </div>
            <div className="mt-5 text-[11px] font-black uppercase tracking-[0.3em] text-emerald-300">
              Plan Upgraded
            </div>
            <h2 className="mt-3 text-3xl font-black uppercase tracking-[0.12em] text-white">
              Premium Unlocked
            </h2>
            <p className="mt-4 text-sm leading-6 text-white/70">
              Your payment has been approved and your account now has premium access. We are taking you to the home page so you can start watching right away.
            </p>
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.22em] text-white/70">
              Redirecting in {redirectCountdown ?? 4}s
            </div>
            <button
              type="button"
              onClick={() => router.replace('/')}
              className="mt-5 w-full rounded-2xl bg-[#D90429] px-4 py-4 text-sm font-black uppercase tracking-[0.28em] text-white"
            >
              Go Home Now
            </button>
            {safeReturnTo ? (
              <Link
                href={safeReturnTo}
                className="mt-3 block text-xs font-black uppercase tracking-[0.22em] text-emerald-200/80"
              >
                Return To Your Movie Instead
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {loading || !draftReady ? (
        <div className="flex min-h-screen items-center justify-center bg-[#0B0C10]">
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-4 text-sm font-bold text-white">
            <Loader2 size={18} className="animate-spin" />
            Loading premium plans...
          </div>
        </div>
      ) : (
        children
      )}
    </SubscribeFlowContext.Provider>
  );
}

export function useSubscribeFlow() {
  const context = useContext(SubscribeFlowContext);

  if (!context) {
    throw new Error('useSubscribeFlow must be used within SubscribeFlowProvider.');
  }

  return context;
}
