import { requireAdminPage } from '@/lib/auth/server';
import { AdminMovieCreateView } from '@/components/admin/AdminMovieCreateView';

export default async function AdminMovieCreatePage() {
  await requireAdminPage('/admin/movies/new');
  return <AdminMovieCreateView />;
}
