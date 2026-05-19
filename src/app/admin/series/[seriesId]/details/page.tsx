'use client';

import { AdminSeriesDetailsView } from '@/components/admin/SeriesAdminWorkflow';

export default function AdminSeriesDetailsPage({
  params,
}: {
  params: { seriesId: string };
}) {
  return <AdminSeriesDetailsView seriesId={params.seriesId} />;
}
