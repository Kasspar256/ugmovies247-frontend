'use client';

import type {
  PaymentMethodProviderOption,
  SubscriptionCurrency,
  SubscriptionPlanDefinition,
} from '@/types/subscriptions';

export function getSafeReturnTo(value?: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '';
}

export function formatMoney(currency: SubscriptionCurrency, amount: number) {
  if (currency === 'ZAR') {
    return `ZAR ${amount.toFixed(2)}`;
  }

  return `UGX ${amount.toLocaleString()}`;
}

export function getPlanDurationLabel(plan: SubscriptionPlanDefinition) {
  if (plan.durationUnit === 'days') {
    return plan.durationValue === 1 ? '1 day' : `${plan.durationValue} days`;
  }

  return plan.durationValue === 1 ? '1 month' : `${plan.durationValue} months`;
}

export function formatDate(value?: string, includeTime = true) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(includeTime
      ? {
          hour: 'numeric',
          minute: '2-digit',
        }
      : {}),
  }).format(date);
}

function getProviderPriority(providerId: string) {
  if (providerId === 'AIRTEL_OAPI_UGA') {
    return 0;
  }

  if (providerId === 'MTN_MOMO_UGA') {
    return 1;
  }

  return 99;
}

export function sortProviderOptions(options: PaymentMethodProviderOption[]) {
  return [...options].sort((left, right) => {
    const leftPriority = getProviderPriority(left.id);
    const rightPriority = getProviderPriority(right.id);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.label.localeCompare(right.label);
  });
}
