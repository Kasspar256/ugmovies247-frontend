'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { initializeNativePushNotifications } from '@/lib/mobile/pushNotifications';

export default function NativePushBridge() {
  const router = useRouter();

  useEffect(() => {
    void initializeNativePushNotifications((path) => {
      router.push(path);
    });
  }, [router]);

  return null;
}
