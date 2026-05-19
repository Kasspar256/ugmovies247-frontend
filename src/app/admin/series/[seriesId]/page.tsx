import { redirect } from 'next/navigation';

export default function AdminSeriesEditPage({
  params,
}: {
  params: { seriesId: string };
}) {
  redirect(`/admin/series/${params.seriesId}/seasons`);
}
