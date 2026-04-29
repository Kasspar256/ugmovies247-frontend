import { createHash } from 'crypto';
import { BILLING_OPERATOR, CARD_PAYMENT_PROCESSOR } from '@/lib/billingIdentity';
import type { AuthSession } from '@/lib/auth/server';
import type {
  PaymentAttemptStatus,
  RecurringAgreementDocument,
  SubscriptionPlanDefinition,
  SubscriptionPlanType,
} from '@/types/subscriptions';

type PayFastTokenizationCheckoutInput = {
  paymentId: string;
  plan: SubscriptionPlanDefinition;
  amount: number;
  session: AuthSession;
  returnTo?: string;
  returnUrlOverride?: string;
  cancelUrlOverride?: string;
};

type PayFastRecurringChargeInput = {
  paymentId: string;
  itemName: string;
  amount: number;
  token: string;
};

type PayFastApiCallInput = {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  bodyEntries?: Array<[string, string]>;
  debugLabel?: string;
};

type PayFastApiCallResult = {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
  rawText: string;
};

type PayFastTransactionLookupResult = {
  found: boolean;
  providerStatus: string;
  providerMessage: string;
  providerTransactionId: string;
  rawPayload: Record<string, unknown>;
};

export type PayFastRecurringChargeResult = {
  ok: boolean;
  providerStatus: string;
  providerMessage: string;
  providerTransactionId: string;
  rawPayload: Record<string, unknown>;
};

export type PayFastRecurringCancelResult = {
  ok: boolean;
  providerStatus: string;
  providerMessage: string;
  rawPayload: Record<string, unknown>;
};

function parseBoolean(value: string | undefined) {
  return value === 'true' || value === '1';
}

function isSandboxEnabled() {
  return parseBoolean(process.env.PAYFAST_USE_SANDBOX) || parseBoolean(process.env.PAYFAST_SANDBOX);
}

function getTrimmedEnv(name: string) {
  return (process.env[name] || '').trim();
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
  return isSandboxEnabled() ? 'sandbox.payfast.co.za' : 'www.payfast.co.za';
}

function getPayFastProcessUrl() {
  return process.env.PAYFAST_PROCESS_URL || `https://${getPayFastHost()}/eng/process`;
}

function getReturnUrl(path: 'return' | 'cancel') {
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

function normalizeEntries(entries: Array<[string, string]>) {
  return entries
    .map(([key, value]) => [key, String(value ?? '').trim()] as [string, string])
    .filter(([, value]) => Boolean(value));
}

function serializeHostedFormEntries(entries: Array<[string, string]>) {
  const params = new URLSearchParams();

  for (const [key, value] of normalizeEntries(entries)) {
    params.append(key, value);
  }

  return params.toString();
}

function buildHostedFormSignatureDetails(entries: Array<[string, string]>, passphrase?: string) {
  const serialized = serializeHostedFormEntries(entries);
  const normalizedPassphrase = String(passphrase ?? '').trim();
  const withPassphrase = normalizedPassphrase
    ? `${serialized}${serialized ? '&' : ''}${new URLSearchParams({
        passphrase: normalizedPassphrase,
      }).toString()}`
    : serialized;

  return {
    signaturePayload: withPassphrase,
    signature: createHash('md5').update(withPassphrase).digest('hex'),
  };
}

function encodePayFastValue(value: string) {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    )
    .replace(/%[0-9a-f]{2}/gi, (segment) => segment.toUpperCase());
}

function serializeEntries(entries: Array<[string, string]>) {
  return normalizeEntries(entries)
    .map(([key, value]) => `${key}=${encodePayFastValue(value)}`)
    .join('&');
}

function buildSignatureDetails(entries: Array<[string, string]>, passphrase?: string) {
  const serialized = serializeEntries(entries);
  const normalizedPassphrase = String(passphrase ?? '').trim();
  const withPassphrase = normalizedPassphrase
    ? `${serialized}${serialized ? '&' : ''}passphrase=${encodePayFastValue(normalizedPassphrase)}`
    : serialized;

  return {
    signaturePayload: withPassphrase,
    signature: createHash('md5').update(withPassphrase).digest('hex'),
  };
}

function buildSignature(entries: Array<[string, string]>, passphrase?: string) {
  return buildSignatureDetails(entries, passphrase).signature;
}

function getChargeUrlTemplate() {
  return getTrimmedEnv('PAYFAST_TOKEN_CHARGE_URL_TEMPLATE');
}

function getRecurringApiVersion() {
  return getTrimmedEnv('PAYFAST_RECURRING_API_VERSION') || 'v1';
}

function formatApiTimestamp() {
  return new Date().toISOString().slice(0, 19);
}

function getRecurringRetryMs() {
  return Number(process.env.SUBSCRIPTION_RENEWAL_RETRY_MS || 1000 * 60 * 60 * 12);
}

function getTemplateBaseUrl() {
  const template = getChargeUrlTemplate();

  if (!template) {
    throw new Error('Missing PAYFAST_TOKEN_CHARGE_URL_TEMPLATE.');
  }

  return new URL(template.replace('{token}', 'template-token'));
}

function resolveTokenActionUrl(token: string, action: 'adhoc' | 'fetch' | 'cancel') {
  const template = getChargeUrlTemplate();

  if (!template) {
    throw new Error('Missing PAYFAST_TOKEN_CHARGE_URL_TEMPLATE.');
  }

  const resolved = new URL(template.replace('{token}', encodeURIComponent(token)));
  const pathSegments = resolved.pathname.split('/').filter(Boolean);

  if (pathSegments[pathSegments.length - 1] !== 'adhoc') {
    throw new Error(
      'PAYFAST_TOKEN_CHARGE_URL_TEMPLATE must end with /adhoc or /adhoc?testing=true.'
    );
  }

  pathSegments[pathSegments.length - 1] = action;
  resolved.pathname = `/${pathSegments.join('/')}`;

  return resolved.toString();
}

function resolveTransactionHistoryUrl(fromDate: string, toDate: string) {
  const templateUrl = getTemplateBaseUrl();
  const historyUrl = new URL(`${templateUrl.protocol}//${templateUrl.host}/transactions/history`);

  historyUrl.searchParams.set('from', fromDate);
  historyUrl.searchParams.set('to', toDate);

  if (templateUrl.searchParams.get('testing') === 'true') {
    historyUrl.searchParams.set('testing', 'true');
  }

  return historyUrl.toString();
}

function buildApiSignature(
  headers: Record<string, string>,
  body: Record<string, string>,
  passphrase?: string
) {
  const entries = [
    ...Object.entries(headers),
    ...Object.entries(body),
    ...(String(passphrase || '').trim() ? [['passphrase', String(passphrase).trim()] as [string, string]] : []),
  ]
    .filter(([, value]) => String(value || '').trim())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => [key, String(value).trim()] as [string, string]);

  const serialized = serializeEntries(entries);

  return {
    signaturePayload: serialized,
    signaturePayloadRedacted: serialized.replace(
      /(^|&)passphrase=[^&]*/i,
      '$1passphrase=[REDACTED]'
    ),
    signature: createHash('md5').update(serialized).digest('hex'),
  };
}

function redactRecurringUrl(url: string) {
  return url.replace(/\/subscriptions\/[^/?]+/i, '/subscriptions/[REDACTED_TOKEN]');
}

function parseResponseBody(text: string) {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      raw: text,
    };
  }
}

function getApiHeaders(bodyEntries?: Array<[string, string]>) {
  const headers = {
    'merchant-id': getTrimmedEnv('PAYFAST_MERCHANT_ID'),
    version: getRecurringApiVersion(),
    timestamp: formatApiTimestamp(),
  };
  const bodyRecord = Object.fromEntries((bodyEntries || []).map(([key, value]) => [key, value]));
  const signatureDetails = buildApiSignature(headers, bodyRecord, getTrimmedEnv('PAYFAST_PASSPHRASE'));

  return {
    headers,
    signature: signatureDetails.signature,
    signaturePayload: signatureDetails.signaturePayload,
    signaturePayloadRedacted: signatureDetails.signaturePayloadRedacted,
  };
}

async function callPayFastApi(input: PayFastApiCallInput): Promise<PayFastApiCallResult> {
  const serializedBody = input.bodyEntries?.length ? serializeEntries(input.bodyEntries) : '';
  const { headers, signature, signaturePayloadRedacted } = getApiHeaders(
    input.bodyEntries
  );

  if (process.env.NODE_ENV !== 'production' && input.debugLabel) {
    console.info('[subscriptions] payfast recurring api request', {
      label: input.debugLabel,
      url: redactRecurringUrl(input.url),
      headers: {
        'merchant-id': headers['merchant-id'],
        version: headers.version,
        timestamp: headers.timestamp,
      },
      signaturePayload: signaturePayloadRedacted,
      body: serializedBody,
    });
  }

  const response = await fetch(input.url, {
    method: input.method,
    headers: {
      ...(serializedBody ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      'merchant-id': headers['merchant-id'],
      version: headers.version,
      timestamp: headers.timestamp,
      signature,
    },
    body: serializedBody || undefined,
    cache: 'no-store',
  });

  const rawText = await response.text();

  if (process.env.NODE_ENV !== 'production' && input.debugLabel) {
    console.info('[subscriptions] payfast recurring api response', {
      label: input.debugLabel,
      url: redactRecurringUrl(input.url),
      status: response.status,
      ok: response.ok,
      body: rawText,
      signature: signature,
      signaturePayload: signaturePayloadRedacted,
    });
  }

  return {
    ok: response.ok,
    status: response.status,
    payload: parseResponseBody(rawText),
    rawText,
  };
}

function splitName(name: string) {
  const trimmed = name.trim();

  if (!trimmed) {
    return { firstName: 'UG', lastName: 'Movies 247' };
  }

  const [firstName, ...rest] = trimmed.split(/\s+/);

  return {
    firstName: firstName || 'UG',
    lastName: rest.join(' ') || 'Movies 247',
  };
}

function formatAmountInCents(amount: number) {
  const cents = Math.round(Number(amount) * 100);

  if (!Number.isFinite(cents) || cents <= 0) {
    throw new Error('Invalid recurring charge amount.');
  }

  return String(cents);
}

function getPayloadValue(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];

    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return '';
}

function extractTransactionList(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const queue: unknown[] = [payload];

  while (queue.length) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      const records = current.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
      );

      if (records.length) {
        return records;
      }

      continue;
    }

    if (!current || typeof current !== 'object') {
      continue;
    }

    for (const value of Object.values(current as Record<string, unknown>)) {
      if (Array.isArray(value) || (value && typeof value === 'object')) {
        queue.push(value);
      }
    }
  }

  return [];
}

function buildHistoryLookupMessage(status: number, payload: Record<string, unknown>, rawText: string) {
  const detail =
    getPayloadValue(payload, ['message', 'error', 'detail']) ||
    rawText.trim() ||
    `PayFast transaction history lookup failed (${status}).`;

  return detail;
}

function formatDateOnly(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

export function getPayFastRecurringConfigError() {
  const missing: string[] = [];

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

  if (!getChargeUrlTemplate()) {
    missing.push('PAYFAST_TOKEN_CHARGE_URL_TEMPLATE');
  }

  return missing.length ? `Missing PayFast recurring configuration: ${missing.join(', ')}` : '';
}

export function buildPayFastTokenizationCheckout(options: PayFastTokenizationCheckoutInput) {
  const returnUrl = new URL(options.returnUrlOverride || getReturnUrl('return'));
  returnUrl.searchParams.set('paymentId', options.paymentId);
  returnUrl.searchParams.set('payment', 'card');
  returnUrl.searchParams.set('mode', 'recurring');
  returnUrl.searchParams.set('plan', options.plan.type);

  if (options.returnTo) {
    returnUrl.searchParams.set('returnTo', options.returnTo);
  }

  const cancelUrl = new URL(options.cancelUrlOverride || getReturnUrl('cancel'));
  cancelUrl.searchParams.set('paymentId', options.paymentId);
  cancelUrl.searchParams.set('payment', 'card');
  cancelUrl.searchParams.set('mode', 'recurring');
  cancelUrl.searchParams.set('plan', options.plan.type);
  cancelUrl.searchParams.set('cancelled', '1');

  if (options.returnTo) {
    cancelUrl.searchParams.set('returnTo', options.returnTo);
  }

  const notifyUrl = new URL(getNotifyUrl());
  notifyUrl.searchParams.set('paymentId', options.paymentId);
  notifyUrl.searchParams.set('payment', 'card');
  notifyUrl.searchParams.set('mode', 'recurring');
  notifyUrl.searchParams.set('plan', options.plan.type);

  const { firstName, lastName } = splitName(options.session.name || '');
  const itemName = `${options.plan.name} Auto-Renew UG Movies 247`;
  const itemDescription = `${options.plan.name} auto-renew billed by ${BILLING_OPERATOR}`;

  const entries: Array<[string, string]> = [
    ['merchant_id', getTrimmedEnv('PAYFAST_MERCHANT_ID')],
    ['merchant_key', getTrimmedEnv('PAYFAST_MERCHANT_KEY')],
    ['return_url', returnUrl.toString()],
    ['cancel_url', cancelUrl.toString()],
    ['notify_url', notifyUrl.toString()],
    ['name_first', firstName],
    ['name_last', lastName],
    ['email_address', options.session.email || ''],
    ['amount', options.amount.toFixed(2)],
    ['item_name', itemName],
    ['item_description', itemDescription],
    ['subscription_type', '2'],
  ];
  const details = buildHostedFormSignatureDetails(entries, getTrimmedEnv('PAYFAST_PASSPHRASE'));
  const fields = Object.fromEntries([...normalizeEntries(entries), ['signature', details.signature]]);

  if (process.env.NODE_ENV !== 'production') {
    console.info('[subscriptions] payfast tokenization signature debug', {
      signaturePayload: details.signaturePayload,
      signature: details.signature,
      fieldOrder: [...normalizeEntries(entries).map(([key]) => key), 'signature'],
      fields,
    });
  }

  return {
    processUrl: getPayFastProcessUrl(),
    fields,
  };
}

export function extractPayFastToken(payload: Record<string, string>) {
  return String(payload.token || '').trim();
}

export async function chargePayFastTokenizedAgreement(
  options: PayFastRecurringChargeInput
): Promise<PayFastRecurringChargeResult> {
  const bodyEntries: Array<[string, string]> = [
    ['amount', formatAmountInCents(options.amount)],
    ['item_name', options.itemName],
    ['item_description', `${options.itemName} billed by ${BILLING_OPERATOR}`],
    ['m_payment_id', options.paymentId],
    ['itn', '1'],
  ];

  const response = await callPayFastApi({
    method: 'POST',
    url: resolveTokenActionUrl(options.token, 'adhoc'),
    bodyEntries,
    debugLabel: 'recurring_charge',
  });

  const providerStatus = getPayloadValue(response.payload, [
    'status',
    'payment_status',
    'result',
  ]).toUpperCase() || (response.ok ? 'SUBMITTED' : 'FAILED');
  const providerTransactionId = getPayloadValue(response.payload, [
    'pf_payment_id',
    'payment_id',
    'id',
    'reference',
  ]);
  const normalizedProviderStatus = providerStatus.trim().toUpperCase();
  const providerFailureMessage =
    normalizedProviderStatus === 'FAILED' ||
    normalizedProviderStatus === 'ERROR' ||
    normalizedProviderStatus === 'DECLINED'
      ? 'PayFast did not complete the recurring card renewal.'
      : '';

  const providerMessage =
    getPayloadValue(response.payload, ['message', 'error', 'detail']) ||
    providerFailureMessage ||
    (response.ok
      ? 'Recurring card renewal submitted to PayFast.'
      : `PayFast recurring charge request failed (${response.status}).`);

  return {
    ok: response.ok,
    providerStatus,
    providerMessage,
    providerTransactionId,
    rawPayload: response.payload,
  };
}

export async function cancelPayFastTokenizedAgreement(
  token: string
): Promise<PayFastRecurringCancelResult> {
  const response = await callPayFastApi({
    method: 'PUT',
    url: resolveTokenActionUrl(token, 'cancel'),
  });

  return {
    ok: response.ok,
    providerStatus:
      getPayloadValue(response.payload, ['status', 'payment_status', 'result']).toUpperCase() ||
      (response.ok ? 'CANCELLED' : 'FAILED'),
    providerMessage:
      getPayloadValue(response.payload, ['message', 'error', 'detail']) ||
      (response.ok
        ? 'PayFast recurring agreement cancelled successfully.'
        : `PayFast recurring agreement cancellation failed (${response.status}).`),
    rawPayload: response.payload,
  };
}

export async function findPayFastTransactionByPaymentId(
  paymentId: string,
  createdAt: string
): Promise<PayFastTransactionLookupResult> {
  const response = await callPayFastApi({
    method: 'GET',
    url: resolveTransactionHistoryUrl(formatDateOnly(createdAt), formatDateOnly(new Date().toISOString())),
  });

  if (!response.ok) {
    return {
      found: false,
      providerStatus: 'HISTORY_LOOKUP_FAILED',
      providerMessage: buildHistoryLookupMessage(response.status, response.payload, response.rawText),
      providerTransactionId: '',
      rawPayload: response.payload,
    };
  }

  const transactions = extractTransactionList(response.payload);
  const matchingTransaction = transactions.find((entry) => {
    const merchantPaymentId = getPayloadValue(entry, [
      'm_payment_id',
      'merchant_payment_id',
      'merchantPaymentId',
      'mPaymentId',
    ]);

    return merchantPaymentId === paymentId;
  });

  if (!matchingTransaction) {
    return {
      found: false,
      providerStatus: 'NOT_FOUND',
      providerMessage: 'No PayFast transaction history record was found for this renewal yet.',
      providerTransactionId: '',
      rawPayload: response.payload,
    };
  }

  return {
    found: true,
    providerStatus:
      getPayloadValue(matchingTransaction, ['payment_status', 'status', 'result']).toUpperCase() ||
      'UNKNOWN',
    providerMessage:
      getPayloadValue(matchingTransaction, ['message', 'error', 'detail']) ||
      'Recurring renewal transaction was found in PayFast history.',
    providerTransactionId: getPayloadValue(matchingTransaction, [
      'pf_payment_id',
      'payment_id',
      'pfPaymentId',
      'id',
      'reference',
    ]),
    rawPayload: matchingTransaction,
  };
}

export function getRecurringFailureRescheduleAt() {
  return new Date(Date.now() + getRecurringRetryMs()).toISOString();
}

export function mapRecurringChargeResultToPaymentState(status: string): PaymentAttemptStatus {
  const normalized = status.trim().toUpperCase();

  if (normalized === 'COMPLETE' || normalized === 'COMPLETED') {
    return 'completed';
  }

  if (normalized === 'FAILED' || normalized === 'ERROR' || normalized === 'DECLINED') {
    return 'failed';
  }

  if (normalized === 'CANCELLED') {
    return 'cancelled';
  }

  if (normalized === 'PENDING') {
    return 'pending';
  }

  return 'submitted';
}

export function buildRecurringChargeItemName(agreement: RecurringAgreementDocument) {
  return `${agreement.planName} Auto-Renew ${CARD_PAYMENT_PROCESSOR}`;
}

export function buildNextChargeAtFromExpiry(expiresAt: string) {
  return expiresAt || '';
}
