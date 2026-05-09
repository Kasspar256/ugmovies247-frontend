import { requireAdminPage } from '@/lib/auth/server';
import AdminControlCenter from '@/components/admin/AdminControlCenter';

export default async function AdminSeriesPage() {
  await requireAdminPage('/admin/series');
  return <AdminControlCenter section="series" />;
}
