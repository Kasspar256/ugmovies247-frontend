'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { fetchAuthStatus } from '@/lib/auth/status-client';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    const verifyAdmin = async () => {
      if (pathname === '/admin/login') {
        return;
      }

      try {
        const status = await fetchAuthStatus();

        if (!mounted) {
          return;
        }

        if (!status.authenticated || status.user?.role !== 'admin') {
          router.replace(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
          return;
        }
      } catch (error) {
        if (mounted) {
          router.replace(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
        }
      }
    };

    verifyAdmin();

    return () => {
      mounted = false;
    };
  }, [pathname, router]);

  return <>{children}</>;
}
