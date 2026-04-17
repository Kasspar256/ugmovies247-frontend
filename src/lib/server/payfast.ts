import { createHash, timingSafeEqual } from 'crypto';
import {
  BILLING_OPERATOR,
  CARD_PAYMENT_PROCESSOR,
  CARD_PAYMENT_TRUST_MESSAGE,
} from '@/lib/billingIdentity';
import { getPayFastRecurringConfigError } from '@/lib/server/payfastRecurring';
import { SUBSCRIPTION_PLAN_LIST } from '@/lib/subscriptions/plans';
import type {
  CardPaymentGateway,
  PaymentAttemptStatus,
  SubscriptionPlanDefinition,
  SubscriptionPlanType,
} from '@/types/subscriptions';

type PayFastCheckoutInput = {
  paymentId: string;
  plan: SubscriptionPlanDefinition;
  amount: number;
  returnTo?: string;
};

type PayFastValidationResult = {
  ok: boolean;
  reason?: string;
};

function parseBoolean(value: string | undefined) {
  return value === 'true' || value === '1';
}

function isPayFastSandboxEnabled() {
  return parseBoolean(process.env.PAYFAST_USE_SANDBOX) || parseBoolean(process.env.PAYFAST_SANDBOX);
}

function getAppBaseUrl() {
  const value =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    '';

  return value.replace(/\/$/, '');
}

function getPayFastHost() {
  return isPayFastSandboxEnabled() ? 'sandbox.payfast.co.za' : 'www.payfast.co.za';
}

function getPayFastProcessUrl() {
  return process.env.PAYFAST_PROCESS_URL || `https://${getPayFastHost()}/eng/process`;
}

function getPayFastValidationUrl() {
  return process.env.PAYFAST_VALIDATE_URL || `https://${getPayFastHost()}/eng/query/validate`;
}

function getTrimmedEnv(name: string) {
  return (process.env[name] || '').trim();
}

function parsePlanPricingFromJson(raw: string) {
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return Object.entries(parsed).reduce<Partial<Record<SubscriptionPlanType, number>>>(
      (accumulator, [planType, amount]) => {
        const numericAmount = Number(amount);

        if (Number.isFinite(numericAmount) && numericAmount > 0) {
          accumulator[planType as SubscriptionPlanType] = numericAmount;
        }

        return accumulator;
      },
      {}
    );
  } catch {
    return {};
  }
}

function getConfiguredPlanPrices() {
  const jsonPrices = parsePlanPricingFromJson(process.env.PAYFAST_PLAN_PRICES_ZAR || '');
  const individualPrices: Partial<Record<SubscriptionPlanType, number>> = {};

  for (const plan of SUBSCRIPTION_PLAN_LIST) {
    const envName = `PAYFAST_${plan.type.toUpperCase()}_AMOUNT_ZAR`;
    const numericAmount = Number(process.env[envName] || '');

    if (Number.isFinite(numericAmount) && numericAmount > 0) {
      individualPrices[plan.type] = numericAmount;
    }
  }

  return {
    ...jsonPrices,
    ...individualPrices,
  };
}

function getPayFastAllowedSourceIps() {
  return (process.env.PAYFAST_ITN_ALLOWED_IPS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function serializePayFastEntries(entries: Array<[string, string]>) {
  const params = new URLSearchParams();

  for (const [key, value] of entries) {
    const normalizedValue = String(value ?? '').trim();

    if (!normalizedValue) {
      continue;
    }

    params.append(key, normalizedValue);
  }

  return params.toString();
}

function buildPayFastSignaturePayloadFromRawBody(rawBody: string, passphrase?: string) {
  const serialized = rawBody
    .split('&')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => {
      const [rawKey = ''] = segment.split('=', 1);
      const normalizedKey = decodeURIComponent(rawKey.replace(/\+/g, '%20'));
      return normalizedKey !== 'signature';
    })
    .join('&');

  const withPassphrase =
    passphrase && passphrase.trim()
      ? `${serialized}${serialized ? '&' : ''}${new URLSearchParams({
          passphrase: passphrase.trim(),
        }).toString()}`
      : serialized;

  return createHash('md5').update(withPassphrase).digest('hex');
}

function buildPayFastSignaturePayload(entries: Array<[string, string]>, passphrase?: string) {
  const serialized = serializePayFastEntries(entries);

  const withPassphrase =
    passphrase && passphrase.trim()
      ? `${serialized}${serialized ? '&' : ''}${new URLSearchParams({
          passphrase: passphrase.trim(),
        }).toString()}`
      : serialized;

  return createHash('md5').update(withPassphrase).digest('hex');
}

function buildSignedPayFastFields(entries: Array<[string, string]>) {
  const passphrase = getTrimmedEnv('PAYFAST_PASSPHRASE');
  const signature = buildPayFastSignaturePayload(entries, passphrase);

  return Object.fromEntries([...entries, ['signature', signature]]);
}

function getReturnUrl(path: string) {
  const explicit = getTrimmedEnv(path === 'return' ? 'PAYFAST_RETURN_URL' : 'PAYFAST_CANCEL_URL');

  if (explicit) {
    return explicit;
  }

  const baseUrl = getAppBaseUrl();
  return baseUrl ? `${baseUrl}/subscribe` : '';
}

function getNotifyUrl() {
  const explicit = getTrimmedEnv('PAYFAST_NOTIFY_URL');

  if (explicit) {
    return explicit;
  }

  const baseUrl = getAppBaseUrl();
  return baseUrl ? `${baseUrl}/api/webhooks/payfast` : '';
}

export function getPayFastPlanPrice(planType: SubscriptionPlanType) {
  const configuredPrices = getConfiguredPlanPrices();
  return configuredPrices[planType] || 0;
}

export function getPayFastGatewayConfig(): CardPaymentGateway {
  const autoRenewError = getPayFastRecurringConfigError();

  return {
    id: 'payfast',
    label: 'Card Payment',
    processor: CARD_PAYMENT_PROCESSOR,
    billedBy: BILLING_OPERATOR,
    trustMessage: CARD_PAYMENT_TRUST_MESSAGE,
    currency: 'ZAR',
    enabled: !getPayFastConfigError(),
    supportsAutoRenew: !autoRenewError,
    autoRenewError,
    planPrices: getConfiguredPlanPrices(),
  };
}

export function getPayFastConfigError() {
  const missing: string[] = [];
  const configuredPrices = getConfiguredPlanPrices();

  if (!getTrimmedEnv('PAYFAST_MERCHANT_ID')) {
    missing.push('PAYFAST_MERCHANT_ID');
  }

  if (!getTrimmedEnv('PAYFAST_MERCHANT_KEY')) {
    missing.push('PAYFAST_MERCHANT_KEY');
  }

  if (!getNotifyUrl()) {
    missing.push('PAYFAST_NOTIFY_URL or APP_BASE_URL');
  }

  if (!getReturnUrl('return')) {
    missing.push('PAYFAST_RETURN_URL or APP_BASE_URL');
  }

  if (!getReturnUrl('cancel')) {
    missing.push('PAYFAST_CANCEL_URL or APP_BASE_URL');
  }

  if (!Object.keys(configuredPrices).length) {
    missing.push('PAYFAST_PLAN_PRICES_ZAR or PAYFAST_<PLAN>_AMOUNT_ZAR');
  }

  return missing.length ? `Missing PayFast configuration: ${missing.join(', ')}` : '';
}

export function buildPayFastCheckout(options: PayFastCheckoutInput) {
  const returnUrl = new URL(getReturnUrl('return'));
  returnUrl.searchParams.set('paymentId', options.paymentId);
  returnUrl.searchParams.set('payment', 'card');
  returnUrl.searchParams.set('plan', options.plan.type);

  if (options.returnTo) {
    returnUrl.searchParams.set('returnTo', options.returnTo);
  }

  const cancelUrl = new URL(getReturnUrl('cancel'));
  cancelUrl.searchParams.set('paymentId', options.paymentId);
  cancelUrl.searchParams.set('payment', 'card');
  cancelUrl.searchParams.set('plan', options.plan.type);
  cancelUrl.searchParams.set('cancelled', '1');

  if (options.returnTo) {
    cancelUrl.searchParams.set('returnTo', options.returnTo);
  }

  const itemName = `${options.plan.name} UG Movies 247`;

  const entries: Array<[string, string]> = [
    ['merchant_id', getTrimmedEnv('PAYFAST_MERCHANT_ID')],
    ['merchant_key', getTrimmedEnv('PAYFAST_MERCHANT_KEY')],
    ['return_url', returnUrl.toString()],
    ['cancel_url', cancelUrl.toString()],
    ['notify_url', getNotifyUrl()],
    ['m_payment_id', options.paymentId],
    ['amount', options.amount.toFixed(2)],
    ['item_name', itemName],
  ];

  return {
    processUrl: getPayFastProcessUrl(),
    fields: buildSignedPayFastFields(entries),
  };
}

export function mapPayFastStatusToPaymentState(status: string): PaymentAttemptStatus {
  const normalized = status.trim().toUpperCase();

  if (normalized === 'COMPLETE' || normalized === 'COMPLETED') {
    return 'completed';
  }

  if (normalized === 'FAILED') {
    return 'failed';
  }

  if (normalized === 'CANCELLED' || normalized === 'CANCELLED_BY_USER') {
    return 'cancelled';
  }

  if (normalized === 'PENDING') {
    return 'pending';
  }

  return 'submitted';
}

export function parsePayFastPayload(rawBody: string) {
  const params = new URLSearchParams(rawBody);
  const payload: Record<string, string> = {};

  params.forEach((value, key) => {
    payload[key] = value;
  });

  return payload;
}

export function validatePayFastSignature(payload: Record<string, string>) {
  const receivedSignature = (payload.signature || '').trim().toLowerCase();

  if (!receivedSignature) {
    return false;
  }

  const configuredPassphrase = getTrimmedEnv('PAYFAST_PASSPHRASE');
  const signatureEntries = Object.entries(payload).filter(([key]) => key !== 'signature');
  const candidates = new Set<string>([
    buildPayFastSignaturePayload(
      signatureEntries.map(([key, value]) => [key, value]),
      configuredPassphrase
    ).toLowerCase(),
  ]);

  if (isPayFastSandboxEnabled()) {
    candidates.add(buildPayFastSignaturePayload(signatureEntries.map(([key, value]) => [key, value])).toLowerCase());

    if (configuredPassphrase.toLowerCase() !== 'payfast') {
      candidates.add(
        buildPayFastSignaturePayload(
          signatureEntries.map(([key, value]) => [key, value]),
          'payfast'
        ).toLowerCase()
      );
    }
  }

  for (const candidate of candidates) {
    const expectedBuffer = Buffer.from(candidate);
    const receivedBuffer = Buffer.from(receivedSignature);

    if (expectedBuffer.length !== receivedBuffer.length) {
      continue;
    }

    if (timingSafeEqual(expectedBuffer, receivedBuffer)) {
      return true;
    }
  }

  return false;
}

export function validatePayFastSignatureFromRawBody(payload: Record<string, string>, rawBody: string) {
  const receivedSignature = (payload.signature || '').trim().toLowerCase();

  if (!receivedSignature) {
    return false;
  }

  const configuredPassphrase = getTrimmedEnv('PAYFAST_PASSPHRASE');
  const candidates = new Set<string>([
    buildPayFastSignaturePayloadFromRawBody(rawBody, configuredPassphrase).toLowerCase(),
  ]);

  if (isPayFastSandboxEnabled()) {
    candidates.add(buildPayFastSignaturePayloadFromRawBody(rawBody).toLowerCase());

    if (configuredPassphrase.toLowerCase() !== 'payfast') {
      candidates.add(buildPayFastSignaturePayloadFromRawBody(rawBody, 'payfast').toLowerCase());
    }
  }

  for (const candidate of candidates) {
    const expectedBuffer = Buffer.from(candidate);
    const receivedBuffer = Buffer.from(receivedSignature);

    if (expectedBuffer.length !== receivedBuffer.length) {
      continue;
    }

    if (timingSafeEqual(expectedBuffer, receivedBuffer)) {
      return true;
    }
  }

  return false;
}

export async function validatePayFastPayloadWithGateway(rawBody: string): Promise<PayFastValidationResult> {
  try {
    const response = await fetch(getPayFastValidationUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: rawBody,
      cache: 'no-store',
    });

    const text = (await response.text()).trim().toUpperCase();

    if (!response.ok || text !== 'VALID') {
      return { ok: false, reason: `PayFast validation rejected the ITN payload (${response.status}).` };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'PayFast validation request failed.',
    };
  }
}

export function getPayFastRequestIp(request: Request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    ''
  );
}

export function validatePayFastSourceIp(request: Request) {
  const allowList = getPayFastAllowedSourceIps();

  if (!allowList.length) {
    return true;
  }

  const requestIp = getPayFastRequestIp(request);
  return Boolean(requestIp && allowList.includes(requestIp));
}

export function validatePayFastAmount(expectedAmount: number, actualAmount: string) {
  const expected = Number(expectedAmount.toFixed(2));
  const received = Number(actualAmount);

  return Number.isFinite(received) && Math.abs(expected - received) < 0.001;
}
