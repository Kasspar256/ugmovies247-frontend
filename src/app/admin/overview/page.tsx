import { requireAdminPage } from '@/lib/auth/server';
import AdminControlCenter from '@/components/admin/AdminControlCenter';

export default async function AdminOverviewPage() {
  await requireAdminPage('/admin/overview');
  return <AdminControlCenter section="overview" />;
}
