import { requireAdminPage } from '@/lib/auth/server';
import AdminControlCenter from '@/components/admin/AdminControlCenter';

export default async function AdminLibraryPage() {
  await requireAdminPage('/admin/library');
  return <AdminControlCenter section="library" />;
}
