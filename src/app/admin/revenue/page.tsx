import { requireAdminPage } from '@/lib/auth/server';
import AdminControlCenter from '@/components/admin/AdminControlCenter';

export default async function AdminRevenuePage() {
  await requireAdminPage('/admin/revenue');
  return <AdminControlCenter section="revenue" />;
}
