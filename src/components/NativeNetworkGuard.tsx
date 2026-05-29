'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download, RefreshCcw, WifiOff } from 'lucide-react';

type NetworkStatus = {
  connected: boolean;
  connectionType?: string;
};

type ListenerHandle = {
  remove: () => Promise<void> | void;
};

function browserOnlineFallback() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export default function NativeNetworkGuard() {
  const [isNativeShell, setIsNativeShell] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let mounted = true;
    let networkListener: ListenerHandle | null = null;

    setIsNativeShell(true);

    const updateStatus = (status: NetworkStatus | null) => {
      if (!mounted) {
        return;
      }

      setIsOffline(status ? !status.connected : !browserOnlineFallback());
    };

    const startNetworkListener = async () => {
      try {
        const { Network } = await import('@capacitor/network');
        updateStatus(await Network.getStatus());
        networkListener = await Network.addListener('networkStatusChange', updateStatus);
      } catch (error) {
        console.warn('[network] native network listener unavailable', error);
        updateStatus(null);
      }
    };

    const handleBrowserOnline = () => updateStatus({ connected: true });
    const handleBrowserOffline = () => updateStatus({ connected: false });

    void startNetworkListener();
    window.addEventListener('online', handleBrowserOnline);
    window.addEventListener('offline', handleBrowserOffline);

    return () => {
      mounted = false;
      void networkListener?.remove?.();
      window.removeEventListener('online', handleBrowserOnline);
      window.removeEventListener('offline', handleBrowserOffline);
    };
  }, []);

  if (!isNativeShell || !isOffline) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#07080C] px-5 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(217,4,41,0.18),transparent_34rem)]" />
      <div className="relative w-full max-w-[420px] rounded-[30px] border border-white/10 bg-[#111722]/96 p-6 text-center shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-[24px] border border-white/10 bg-white/[0.04]">
          <img src="/siteicon.png" alt="UG Movies 247" className="h-14 w-14 object-contain" />
        </div>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[#D90429]/30 bg-[#D90429]/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-[#FFD7DF]">
          <WifiOff size={14} />
          Offline Mode
        </div>
        <h2 className="mt-5 text-3xl font-black uppercase leading-tight tracking-normal">
          You are offline
        </h2>
        <p className="mx-auto mt-4 max-w-[320px] text-sm leading-7 text-white/66">
          Your connection dropped. Keep watching saved titles from Downloads, or retry when your network is back.
        </p>
        <div className="mt-7 grid gap-3">
          <button
            type="button"
            onClick={() => window.location.assign('/downloads')}
            className="inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-[#D90429] px-5 text-sm font-black uppercase tracking-[0.16em] text-white"
          >
            <Download size={18} />
            Go To Downloads
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-5 text-sm font-black uppercase tracking-[0.16em] text-white/86"
          >
            <RefreshCcw size={17} />
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
