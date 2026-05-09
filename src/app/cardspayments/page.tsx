import { redirect } from 'next/navigation';
import { APP_REVIEW_HOME_PATH } from '@/lib/appReview';
import { getCurrentAuthSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CardPaymentsPage() {
  const session = await getCurrentAuthSession();

  redirect(session ? APP_REVIEW_HOME_PATH : '/login');
}
