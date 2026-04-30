'use client';

import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { isAppInReview } from '@/lib/appReview';

export async function openExternalCheckout(
  url: string,
  onReturnToApp: () => Promise<void> | void
) {
  if (isAppInReview) {
    return async () => undefined;
  }

  let refreshing = false;
  let cleanup = async () => undefined;

  const refreshOnce = async () => {
    if (refreshing) {
      return;
    }

    refreshing = true;

    try {
      await onReturnToApp();
    } finally {
      await cleanup();
      window.setTimeout(() => {
        refreshing = false;
      }, 1200);
    }
  };

  const browserFinished = await Browser.addListener('browserFinished', refreshOnce);
  const appState = await App.addListener('appStateChange', async ({ isActive }) => {
    if (isActive) {
      await refreshOnce();
    }
  });

  cleanup = async () => {
    await browserFinished.remove();
    await appState.remove();
  };

  await Browser.open({ url });

  return cleanup;
}
