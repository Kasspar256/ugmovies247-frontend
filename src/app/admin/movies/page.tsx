import { requireAdminPage } from '@/lib/auth/server';
import AdminControlCenter from '@/components/admin/AdminControlCenter';

export default async function AdminMoviesPage() {
  await requireAdminPage('/admin/movies');
  return <AdminControlCenter section="movies" />;
}
