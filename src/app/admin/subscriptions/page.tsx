import { requireAdminPage } from '@/lib/auth/server';
import { AdminSubscriptionsDiagnostics } from '@/components/admin/AdminSubscriptionsDiagnostics';

export default async function AdminSubscriptionsPage() {
  await requireAdminPage('/admin/subscriptions');
  return <AdminSubscriptionsDiagnostics />;
}
