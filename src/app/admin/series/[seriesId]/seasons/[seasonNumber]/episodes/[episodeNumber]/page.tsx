'use client';

import { AdminSeriesEpisodeEditorView } from '@/components/admin/SeriesAdminWorkflow';

export default function AdminSeriesEditEpisodePage({
  params,
}: {
  params: { seriesId: string; seasonNumber: string; episodeNumber: string };
}) {
  return (
    <AdminSeriesEpisodeEditorView
      seriesId={params.seriesId}
      seasonNumber={Number(params.seasonNumber) || 1}
      episodeNumber={Number(params.episodeNumber) || 1}
    />
  );
}
