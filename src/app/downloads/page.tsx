'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download, Film } from 'lucide-react';
import { fetchUserDownloads } from '@/lib/downloads';
import MobilePageHeader from '@/components/MobilePageHeader';
import type { DownloadRecord, DownloadStatus } from '@/types/downloads';

export default function DownloadsPage() {
  const [downloadedMovies, setDownloadedMovies] = useState<DownloadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DownloadStatus>('completed');

  useEffect(() => {
    const loadDownloads = async () => {
      try {
        const downloads = await fetchUserDownloads();
        setDownloadedMovies(downloads);
      } catch (err) {
        console.error('Error fetching downloads:', err);
      } finally {
        setLoading(false);
      }
    };

    loadDownloads();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4"></div>
      </div>
    );
  }

  const groupedDownloads: Record<DownloadStatus, DownloadRecord[]> = {
    completed: downloadedMovies.filter((movie) => (movie.status || 'completed') === 'completed'),
    downloading: downloadedMovies.filter((movie) => movie.status === 'downloading'),
    failed: downloadedMovies.filter((movie) => movie.status === 'failed'),
  };

  const activeDownloads = groupedDownloads[activeTab];

  const tabMeta: Record<
    DownloadStatus,
    {
      label: string;
      description: string;
      emptyText: string;
      statusLabel: string;
      statusTone: string;
    }
  > = {
    completed: {
      label: 'Completed',
      description: 'Movies saved and ready for in-app playback.',
      emptyText: 'No completed downloads yet. Use the Download button on any movie to save it here.',
      statusLabel: 'Ready to play',
      statusTone: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    },
    downloading: {
      label: 'Active',
      description: 'Titles that are still being processed appear here.',
      emptyText: 'No active downloads right now.',
      statusLabel: 'Downloading',
      statusTone: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
    },
    failed: {
      label: 'Failed',
      description: 'Downloads that could not complete appear here for follow-up.',
      emptyText: 'No failed downloads right now.',
      statusLabel: 'Failed',
      statusTone: 'text-red-300 bg-red-500/10 border-red-500/30',
    },
  };

  const renderDownloadCard = (movie: DownloadRecord, statusLabel: string, statusTone: string) => (
    <Link
      href={`/movie/${movie.movieId}`}
      key={movie.id}
      className="flex gap-4 bg-[#1F2833]/20 p-3 rounded-lg hover:bg-[#1F2833] transition-colors border border-transparent hover:border-white/10 group shadow-md"
    >
      <div className="w-28 md:w-40 rounded relative overflow-hidden aspect-[16/9] flex-shrink-0">
        <img
          src={movie.poster}
          alt={movie.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute inset-x-0 bottom-0 h-1 bg-[#D90429]"></div>
        <div className="absolute top-2 right-2 bg-black/80 rounded-full p-1">
          <Download size={12} className="text-white" />
        </div>
      </div>
      <div className="flex flex-col justify-center flex-1">
        <h3 className="text-white font-bold text-sm md:text-lg mb-1">{movie.title}</h3>
        <p className="text-[#888888] text-xs mb-2">Saved for in-app playback</p>
        <p className={`text-[10px] font-black uppercase px-2 py-0.5 rounded w-max border ${statusTone}`}>
          {statusLabel}
        </p>
      </div>
      <div className="hidden sm:flex items-center">
        <span className="border border-[#D90429]/40 text-[#D90429] px-4 py-2 rounded-md text-xs font-black uppercase tracking-wider group-hover:bg-[#D90429] group-hover:text-white transition-colors">
          Play
        </span>
      </div>
    </Link>
  );

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pb-14 md:pt-[118px] lg:px-10 font-sans">
      <MobilePageHeader title="Downloads" fallbackHref="/profile" />

      <div className="mt-4 md:mt-2 max-w-5xl mx-auto">
        <div className="hidden md:flex items-center gap-4 mb-8">
          <Download size={32} className="text-[#D90429]" />
          <h1 className="text-3xl font-black text-white uppercase tracking-wider">Downloads</h1>
        </div>

        <div className="bg-[#1F2833]/30 border border-[#1F2833] rounded-lg p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film size={20} className="text-[#888888]" />
            <span className="text-[#888888] text-sm font-medium">
              Titles saved from your account activity
            </span>
          </div>
          <span className="text-xs text-[#888888] font-mono">
            {downloadedMovies.length} saved
          </span>
        </div>

        <section className="rounded-xl border border-white/10 bg-[#11141C]/70 p-4 md:p-5">
          <div className="flex flex-wrap gap-2 mb-5">
            {(['downloading', 'completed', 'failed'] as DownloadStatus[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 min-w-0 px-2.5 py-2 rounded-full text-[10px] sm:text-[11px] md:text-xs font-black uppercase tracking-[0.12em] border transition-colors whitespace-nowrap ${
                  activeTab === tab
                    ? 'bg-[#D90429] border-[#D90429] text-white'
                    : 'bg-[#1F2833]/40 border-white/10 text-gray-300 hover:border-white/30'
                }`}
              >
                {tabMeta[tab].label}
                <span className="ml-1 text-[9px] md:text-[10px] opacity-80">{groupedDownloads[tab].length}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-white font-black text-sm md:text-base uppercase tracking-[0.2em]">
                {tabMeta[activeTab].label}
              </h2>
              <p className="text-[#888888] text-xs mt-1">{tabMeta[activeTab].description}</p>
            </div>
            <span className="text-xs text-[#888888] font-mono">{activeDownloads.length}</span>
          </div>

          <div className="flex flex-col gap-4">
            {activeDownloads.length > 0 ? (
              activeDownloads.map((movie) =>
                renderDownloadCard(movie, tabMeta[activeTab].statusLabel, tabMeta[activeTab].statusTone)
              )
            ) : (
              <div className="bg-[#1F2833]/20 border border-white/10 rounded-lg p-5 text-sm text-[#888888]">
                {tabMeta[activeTab].emptyText}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
