import { requireAdminPage } from '@/lib/auth/server';
import AdminControlCenter from '@/components/admin/AdminControlCenter';

export default async function AdminUsersPage() {
  await requireAdminPage('/admin/users');
  return <AdminControlCenter section="users" />;
}
