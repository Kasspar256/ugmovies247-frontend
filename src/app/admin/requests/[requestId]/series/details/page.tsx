import { AdminRequestSeriesDetailsView } from '@/components/admin/requests/RequestFulfillmentWorkflow';

export default function AdminRequestSeriesDetailsPage({
  params,
}: {
  params: { requestId: string };
}) {
  return <AdminRequestSeriesDetailsView requestId={params.requestId} />;
}
