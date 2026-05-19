'use client';

import { AdminSeriesEpisodeEditorView } from '@/components/admin/SeriesAdminWorkflow';

export default function AdminSeriesNewEpisodePage({
  params,
}: {
  params: { seriesId: string; seasonNumber: string };
}) {
  return (
    <AdminSeriesEpisodeEditorView
      seriesId={params.seriesId}
      seasonNumber={Number(params.seasonNumber) || 1}
    />
  );
}
