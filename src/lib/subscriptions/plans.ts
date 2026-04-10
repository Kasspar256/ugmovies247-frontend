import type { SubscriptionPlanDefinition, SubscriptionPlanType } from '@/types/subscriptions';

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanType, SubscriptionPlanDefinition> = {
  daily: {
    type: 'daily',
    name: '1 Day Pass',
    amount: 2000,
    currency: 'UGX',
    durationUnit: 'days',
    durationValue: 1,
    description: 'Unlock premium movies and series for 24 hours.',
  },
  monthly: {
    type: 'monthly',
    name: '1 Month Pass',
    amount: 15000,
    currency: 'UGX',
    durationUnit: 'months',
    durationValue: 1,
    description: 'Unlock premium movies and series for 30+ days.',
  },
};

export const SUBSCRIPTION_PLAN_LIST = Object.values(SUBSCRIPTION_PLANS);
