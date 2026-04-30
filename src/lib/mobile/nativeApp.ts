'use client';

import { Capacitor } from '@capacitor/core';

export function isNativeAndroidApp() {
  return (
    typeof window !== 'undefined' &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'android'
  );
}
