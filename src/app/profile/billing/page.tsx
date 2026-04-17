import { redirect } from 'next/navigation';

function getSafeReturnTo(value?: string) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '';
}

export default function BillingRedirectPage({
  searchParams,
}: {
  searchParams?: { returnTo?: string; plan?: string };
}) {
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
