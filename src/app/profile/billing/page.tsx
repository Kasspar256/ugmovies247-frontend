import { redirect } from 'next/navigation';
import { APP_REVIEW_HOME_PATH, isAppInReview } from '@/lib/appReview';

function getSafeReturnTo(value?: string) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '';
}

export default function BillingRedirectPage({
  searchParams,
}: {
  searchParams?: { returnTo?: string; plan?: string };
}) {
  if (isAppInReview) {
    redirect(APP_REVIEW_HOME_PATH);
  }

  const params = new URLSearchParams();
  const safeReturnTo = getSafeReturnTo(searchParams?.returnTo);

  if (searchParams?.plan) {
    params.set('plan', searchParams.plan);
  }

  if (safeReturnTo) {
    params.set('returnTo', safeReturnTo);
  }

  redirect(params.toString() ? `/subscribe?${params.toString()}` : '/subscribe');
}
