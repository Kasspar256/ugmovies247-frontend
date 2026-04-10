'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(pathname !== '/admin/login');
  const [allowed, setAllowed] = useState(pathname === '/admin/login');

  useEffect(() => {
    let mounted = true;

    const verifyAdmin = async () => {
      if (pathname === '/admin/login') {
        setAllowed(true);
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/auth/me');
        const payload = await response.json();

        if (!mounted) {
          return;
        }

        if (!response.ok || payload.user?.role !== 'admin') {
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
        if (mounted) {
          setLoading(false);
        }
      }
    };

    verifyAdmin();

    return () => {
      mounted = false;
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
