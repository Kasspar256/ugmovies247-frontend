import { requireAdminPage } from '@/lib/auth/server';
import { AdminSeriesEditView } from '@/components/admin/AdminSeriesEditView';

export default async function AdminSeriesEditPage({
  params,
}: {
  params: { seriesId: string };
}) {
  await requireAdminPage(`/admin/series/${params.seriesId}`);
  return <AdminSeriesEditView seriesId={params.seriesId} />;
}
