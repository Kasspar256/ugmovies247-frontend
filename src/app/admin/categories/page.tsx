import { requireAdminPage } from '@/lib/auth/server';
import AdminControlCenter from '@/components/admin/AdminControlCenter';

export default async function AdminCategoriesPage() {
  await requireAdminPage('/admin/categories');
  return <AdminControlCenter section="categories" />;
}
