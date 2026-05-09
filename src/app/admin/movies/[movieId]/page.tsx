import { requireAdminPage } from '@/lib/auth/server';
import { AdminMovieEditView } from '@/components/admin/AdminMovieEditView';

export default async function AdminMovieEditPage({
  params,
}: {
  params: { movieId: string };
}) {
  await requireAdminPage(`/admin/movies/${params.movieId}`);
  return <AdminMovieEditView movieId={params.movieId} />;
}
