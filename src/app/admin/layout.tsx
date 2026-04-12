'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const ADMIN_VERIFY_TIMEOUT_MS = 8000;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(pathname !== '/admin/login');
  const [allowed, setAllowed] = useState(pathname === '/admin/login');

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ADMIN_VERIFY_TIMEOUT_MS);

    const verifyAdmin = async () => {
      if (pathname === '/admin/login') {
        setAllowed(true);
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/admin', {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!mounted) {
          return;
        }

        if (!response.ok) {
          router.replace(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
          setAllowed(false);
          setLoading(false);
          return;
        }

        setAllowed(true);
      } catch (error) {
        if (mounted) {
          router.replace(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
          setAllowed(false);
        }
      } finally {
        clearTimeout(timeout);

        if (mounted) {
          setLoading(false);
        }
      }
    };

    verifyAdmin();

    return () => {
      mounted = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-red-500 flex items-center justify-center">
        VERIFYING ADMIN SESSION...
      </div>
    );
  }

  if (!allowed) {
    return null;
  }

  return <>{children}</>;
}
