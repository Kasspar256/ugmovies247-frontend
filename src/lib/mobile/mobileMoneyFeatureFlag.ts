'use client';

import { fetchAndActivate, getBoolean, getRemoteConfig, isSupported } from 'firebase/remote-config';
import { app } from '@/lib/firebase';

const SHOW_MOBILE_MONEY_KEY = 'show_mobile_money';

let cachedShowMobileMoney: boolean | null = null;

export async function getShowMobileMoneyFlag() {
  if (typeof window === 'undefined') {
    return false;
  }

  if (cachedShowMobileMoney !== null) {
    return cachedShowMobileMoney;
  }

  try {
    const supported = await isSupported();

    if (!supported) {
      cachedShowMobileMoney = false;
      return false;
    }

    const remoteConfig = getRemoteConfig(app);

    remoteConfig.defaultConfig = {
      [SHOW_MOBILE_MONEY_KEY]: false,
    };

    remoteConfig.settings = {
      fetchTimeoutMillis: 10000,
      minimumFetchIntervalMillis: process.env.NODE_ENV === 'production' ? 60 * 60 * 1000 : 60 * 1000,
    };

    await fetchAndActivate(remoteConfig);

    cachedShowMobileMoney = getBoolean(remoteConfig, SHOW_MOBILE_MONEY_KEY);
    return cachedShowMobileMoney;
  } catch (error) {
    console.warn('[remote-config] failed to load mobile money flag', error);
    cachedShowMobileMoney = false;
    return false;
  }
}
