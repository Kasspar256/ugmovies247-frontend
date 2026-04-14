import { AdminMovieEditView } from '@/components/admin/AdminMovieEditView';

export default function AdminMovieEditPage({
  params,
}: {
  params: { movieId: string };
}) {
  return <AdminMovieEditView movieId={params.movieId} />;
}
