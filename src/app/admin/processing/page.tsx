import { requireAdminPage } from '@/lib/auth/server';
import AdminControlCenter from '@/components/admin/AdminControlCenter';

export default async function AdminProcessingPage() {
  await requireAdminPage('/admin/processing');
  return <AdminControlCenter section="processing" />;
}
