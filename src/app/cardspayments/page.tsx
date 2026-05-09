import { redirect } from 'next/navigation';
import CardPaymentsAdminPage from '@/components/admin/CardPaymentsAdminPage';
import { APP_REVIEW_HOME_PATH, isAppInReview } from '@/lib/appReview';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function CardPaymentsPage() {
  const session = await getCurrentAuthSession();

  if (isAppInReview) {
    redirect(session ? APP_REVIEW_HOME_PATH : '/login');
  }

  if (!session) {
    redirect('/login');
  }

  if (session.role !== 'admin' && !isAdminEmail(session.email)) {
    redirect('/browse');
  }

  return <CardPaymentsAdminPage />;
}
