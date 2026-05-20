import { AdminRequestSeriesSeasonsView } from '@/components/admin/requests/RequestFulfillmentWorkflow';

export default function AdminRequestSeriesSeasonsPage({
  params,
}: {
  params: { requestId: string };
}) {
  return <AdminRequestSeriesSeasonsView requestId={params.requestId} />;
}
