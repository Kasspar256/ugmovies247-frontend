'use client';

import { AdminSeriesSeasonsView } from '@/components/admin/SeriesAdminWorkflow';

export default function AdminSeriesSeasonsPage({
  params,
}: {
  params: { seriesId: string };
}) {
  return <AdminSeriesSeasonsView seriesId={params.seriesId} />;
}
