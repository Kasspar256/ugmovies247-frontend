import { AdminSeriesEditView } from '@/components/admin/AdminSeriesEditView';

export default function AdminSeriesEditPage({
  params,
}: {
  params: { seriesId: string };
}) {
  return <AdminSeriesEditView seriesId={params.seriesId} />;
}
