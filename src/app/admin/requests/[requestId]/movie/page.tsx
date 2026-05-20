import { AdminRequestMovieFulfillmentView } from '@/components/admin/requests/RequestFulfillmentWorkflow';

export default function AdminRequestMoviePage({ params }: { params: { requestId: string } }) {
  return <AdminRequestMovieFulfillmentView requestId={params.requestId} />;
}
