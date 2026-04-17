import { createHash, timingSafeEqual } from 'crypto';
import type {
  PaymentMethodProvider,
  PaymentMethodProviderOption,
  SubscriptionPlanType,
} from '@/types/subscriptions';

type InitiatePawaPayDepositInput = {
  depositId: string;
  amount: number;
  currency: 'UGX';
  phoneNumber: string;
  provider: PaymentMethodProvider;
  planType: SubscriptionPlanType;
  userId: string;
  customerMessage: string;
  clientReferenceId: string;
};

type PawaPayInitiateDepositResponse = {
  depositId?: string;
  status?: string;
  created?: string;
  failureReason?: {
    errorCode?: string;
    errorMessage?: string;
    failureCode?: string;
    failureMessage?: string;
  };
};

type PawaPayDepositStatusResponse = {
  status?: string;
  message?: string;
  error?: string;
  failureReason?: {
    errorCode?: string;
    errorMessage?: string;
    failureCode?: string;
    failureMessage?: string;
  };
  data?: {
    depositId?: string;
    status?: string;
    message?: string;
    error?: string;
    failureReason?: {
      errorCode?: string;
      errorMessage?: string;
      failureCode?: string;
      failureMessage?: string;
    };
    requestedAmount?: string;
    currency?: string;
    country?: string;
    correspondent?: string;
    payer?: { type?: string; address?: { value?: string } };
    customerTimestamp?: string;
    statementDescription?: string;
    created?: string;
    correspondentIds?: Array<{ id?: string; type?: string }>;
    metadata?: Record<string, unknown>;
  };
};

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} for the active environment.`);
  }

  return value;
}

export function getPawaPayConfig() {
  const appEnv = (process.env.NEXT_PUBLIC_APP_ENV || '').toLowerCase();
  const inferredEnvironment =
    process.env.PAWAPAY_ENV ||
    (process.env.NODE_ENV === 'production' || appEnv === 'production' ? 'production' : 'sandbox');

  return {
    env: inferredEnvironment,
    baseUrl: process.env.PAWAPAY_BASE_URL || '',
    apiToken: process.env.PAWAPAY_API_TOKEN || process.env.PAWAPAY_API_KEY || '',
    callbackUrl:
      process.env.PAWAPAY_WEBHOOK_URL ||
      (process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL.replace(/\/$/, '')}/api/webhooks/pawapay` : ''),
    requireSignedCallbacks: process.env.PAWAPAY_REQUIRE_SIGNED_CALLBACKS === 'true',
  };
}

export function getPawaPayProviderLabel(provider: string) {
  const knownLabels: Record<string, string> = {
    MTN_MOMO_UGA: 'MTN Mobile Money',
    AIRTEL_OAPI_UGA: 'Airtel Money',
  };

  return knownLabels[provider] || provider.replace(/_/g, ' ');
}

export function getConfiguredPawaPayProviders(): PaymentMethodProviderOption[] {
  const raw = process.env.PAWAPAY_ALLOWED_PROVIDERS || '';
  const priority: Record<string, number> = {
    AIRTEL_OAPI_UGA: 0,
    MTN_MOMO_UGA: 1,
  };

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((provider) => ({
      id: provider,
      label: getPawaPayProviderLabel(provider),
      country: provider.endsWith('_UGA') ? 'UGA' : '',
    }))
    .sort((left, right) => {
      const leftPriority = priority[left.id] ?? 99;
      const rightPriority = priority[right.id] ?? 99;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return left.label.localeCompare(right.label);
    });
}

export function getPawaPayConfigError() {
  const config = getPawaPayConfig();
  const missing: string[] = [];

  if (!process.env.PAWAPAY_ENV) {
    missing.push('PAWAPAY_ENV');
  }

  if (!config.baseUrl) {
    missing.push('PAWAPAY_BASE_URL');
  }

  if (!config.apiToken) {
    missing.push('PAWAPAY_API_TOKEN or PAWAPAY_API_KEY');
  }

  if (!config.callbackUrl) {
    missing.push('PAWAPAY_WEBHOOK_URL or APP_BASE_URL');
  }

  if (!getConfiguredPawaPayProviders().length) {
    missing.push('PAWAPAY_ALLOWED_PROVIDERS');
  }

  return missing.length ? `Missing PawaPay configuration: ${missing.join(', ')}` : '';
}

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.PAWAPAY_API_TOKEN || process.env.PAWAPAY_API_KEY || ''}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function getBaseUrl() {
  const baseUrl = getRequiredEnv('PAWAPAY_BASE_URL').replace(/\/$/, '');

  return /\/v2$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v2`;
}

export function normalizeUgandaPhoneNumber(value: string) {
  const digits = value.replace(/[^\d]/g, '');

  if (digits.startsWith('256') && digits.length === 12) {
    return digits;
  }

  if (digits.startsWith('0') && digits.length === 10) {
    return `256${digits.slice(1)}`;
  }

  throw new Error('Use a valid Ugandan phone number, for example 0771234567 or 256771234567.');
}

function sanitizeCustomerMessage(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  if (cleaned.length >= 4 && cleaned.length <= 22) {
    return cleaned;
  }

  if (cleaned.length > 22) {
    return cleaned.slice(0, 22).trimEnd();
  }

  return 'UGMovies247';
}

function parseJsonSafely<T>(text: string) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function formatPawaPayError(response: Response, text: string, payload: Record<string, unknown> | null, fallback: string) {
  const detailedMessage = getPawaPayFailureMessage(payload) || text.trim();

  return `${fallback} status ${response.status}${detailedMessage ? `: ${detailedMessage}` : '.'}`;
}

function getNestedRecord(
  payload: Record<string, unknown> | null | undefined,
  key: string
): Record<string, unknown> | null {
  if (!payload || typeof payload[key] !== 'object' || !payload[key]) {
    return null;
  }

  return payload[key] as Record<string, unknown>;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

export function getPawaPayFailureMessage(payload: Record<string, unknown> | null | undefined) {
  const data = getNestedRecord(payload, 'data');
  const failureReason = getNestedRecord(payload, 'failureReason');
  const nestedFailureReason = getNestedRecord(data, 'failureReason');

  return firstString(
    payload?.message,
    payload?.error,
    failureReason?.errorMessage,
    failureReason?.failureMessage,
    nestedFailureReason?.errorMessage,
    nestedFailureReason?.failureMessage,
    failureReason?.errorCode,
    failureReason?.failureCode,
    nestedFailureReason?.errorCode,
    nestedFailureReason?.failureCode,
    data?.message,
    data?.error
  );
}

export async function initiatePawaPayDeposit(input: InitiatePawaPayDepositInput) {
  const normalizedPhoneNumber = normalizeUgandaPhoneNumber(input.phoneNumber);
  const customerMessage = sanitizeCustomerMessage(input.customerMessage);

  const response = await fetch(`${getBaseUrl()}/deposits`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      depositId: input.depositId,
      payer: {
        type: 'MMO',
        accountDetails: {
          phoneNumber: normalizedPhoneNumber,
          provider: input.provider,
        },
      },
      amount: String(input.amount),
      currency: input.currency,
      clientReferenceId: input.clientReferenceId,
      customerMessage,
      metadata: [
        { userId: input.userId },
        { planType: input.planType },
        { clientReferenceId: input.clientReferenceId },
      ],
    }),
  });

  const text = await response.text();
  const payload = parseJsonSafely<PawaPayInitiateDepositResponse>(text);

  if (!response.ok) {
    console.error('[pawapay] deposit initiation rejected', {
      status: response.status,
      provider: input.provider,
      planType: input.planType,
      response: payload || text,
    });
    throw new Error(
      formatPawaPayError(
        response,
        text,
        payload as Record<string, unknown> | null,
        'PawaPay initiation failed with'
      )
    );
  }

  return payload || {};
}

export async function fetchPawaPayDepositStatus(depositId: string) {
  const response = await fetch(`${getBaseUrl()}/deposits/${encodeURIComponent(depositId)}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  const text = await response.text();
  const payload = parseJsonSafely<PawaPayDepositStatusResponse>(text);

  if (!response.ok) {
    console.error('[pawapay] deposit status check rejected', {
      status: response.status,
      depositId,
      response: payload || text,
    });
    throw new Error(
      formatPawaPayError(
        response,
        text,
        payload as Record<string, unknown> | null,
        'PawaPay status check failed with'
      )
    );
  }

  return payload || {};
}

export function mapPawaPayStatusToPaymentState(status: string) {
  const normalized = status.toUpperCase();

  if (normalized === 'COMPLETED') {
    return 'completed' as const;
  }

  if (normalized === 'FAILED') {
    return 'failed' as const;
  }

  if (normalized === 'CANCELLED') {
    return 'cancelled' as const;
  }

  if (normalized === 'NOT_FOUND') {
    return 'not_found' as const;
  }

  if (normalized === 'ACCEPTED' || normalized === 'SUBMITTED' || normalized === 'PROCESSING') {
    return 'pending' as const;
  }

  return 'needs_attention' as const;
}

export function getProviderTransactionId(payload: Record<string, unknown>) {
  const correspondentIds = Array.isArray(payload.correspondentIds) ? payload.correspondentIds : [];
  const transactionId = correspondentIds.find((entry) => {
    const record = entry as Record<string, unknown>;
    return typeof record.id === 'string' && record.id;
  }) as Record<string, unknown> | undefined;

  return String(transactionId?.id || '');
}

export function validatePawaPayContentDigest(rawBody: string, digestHeader: string) {
  const match = digestHeader.match(/sha-256=:(.+):/i);

  if (!match?.[1]) {
    return false;
  }

  const expected = createHash('sha256').update(rawBody).digest('base64');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(match[1]);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
