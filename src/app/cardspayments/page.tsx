import { redirect } from 'next/navigation';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { APP_REVIEW_HOME_PATH, isAppInReview } from '@/lib/appReview';
import CardPaymentsAdminPage from '@/components/admin/CardPaymentsAdminPage';

export default async function CardsPaymentsPage() {
  if (isAppInReview) {
    redirect(APP_REVIEW_HOME_PATH);
  }

  const session = await getCurrentAuthSession();

  if (!session) {
    redirect('/login');
  }

  if (session.role !== 'admin' && !isAdminEmail(session.email)) {
    redirect('/browse');
  }

  return <CardPaymentsAdminPage />;
}
