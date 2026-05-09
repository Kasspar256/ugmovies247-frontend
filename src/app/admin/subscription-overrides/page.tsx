import { requireAdminPage } from '@/lib/auth/server';
import AdminControlCenter from '@/components/admin/AdminControlCenter';

export default async function AdminSubscriptionOverridesPage() {
  await requireAdminPage('/admin/subscription-overrides');
  return <AdminControlCenter section="subscription_overrides" />;
}
