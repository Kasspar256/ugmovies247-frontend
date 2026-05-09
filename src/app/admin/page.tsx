import { requireAdminPage } from '@/lib/auth/server';
import AdminControlCenter from '@/components/admin/AdminControlCenter';

export default async function AdminPage() {
  await requireAdminPage('/admin');
  return <AdminControlCenter />;
}
