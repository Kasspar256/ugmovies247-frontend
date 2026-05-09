import { requireAdminPage } from '@/lib/auth/server';
import AdminControlCenter from '@/components/admin/AdminControlCenter';

export default async function AdminRequestsPage() {
  await requireAdminPage('/admin/requests');
  return <AdminControlCenter section="requests" />;
}
