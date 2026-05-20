import { AdminRequestSeriesEpisodeView } from '@/components/admin/requests/RequestFulfillmentWorkflow';

export default function AdminRequestSeriesEpisodePage({
  params,
}: {
  params: { requestId: string; seasonNumber: string; episodeNumber: string };
}) {
  return (
    <AdminRequestSeriesEpisodeView
      requestId={params.requestId}
      seasonNumber={Math.max(1, Number(params.seasonNumber) || 1)}
      episodeNumber={Math.max(1, Number(params.episodeNumber) || 1)}
    />
  );
}
