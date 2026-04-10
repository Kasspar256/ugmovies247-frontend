'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download, Film } from 'lucide-react';
import {
  fetchUserDownloads,
  getClientDownloadUserId,
} from '@/lib/downloads';
import type { DownloadRecord, DownloadStatus } from '@/types/downloads';

export default function DownloadsPage() {
  const [downloadedMovies, setDownloadedMovies] = useState<DownloadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DownloadStatus>('completed');

  useEffect(() => {
    const loadDownloads = async () => {
      try {
        const userId = await getClientDownloadUserId();
        const downloads = await fetchUserDownloads(userId);
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
    <div className="min-h-screen bg-[#0B0C10] pb-24 md:pb-12 pt-16 md:pt-28 px-4 md:px-12 font-sans">
      <header className="hidden md:flex absolute top-0 w-full z-50 justify-between items-center p-6 bg-gradient-to-b from-black/90 to-transparent left-0">
        <div className="flex items-center gap-12">
          <Link href="/" className="flex items-center justify-center p-1 w-64 hover:scale-105 transition-transform z-50">
            <img
              src="/logo2_perfect.png"
              alt="UG Movies 247"
              className="h-16 md:h-20 w-auto object-contain drop-shadow-[0_2px_20px_rgba(217,4,41,0.9)]"
            />
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/" className="text-[#888888] hover:text-[#D90429] transition-colors">Home</Link>
            <Link href="/vjs" className="text-[#888888] hover:text-[#D90429] transition-colors">VJ Directory</Link>
            <Link href="/genres" className="text-[#888888] hover:text-[#D90429] transition-colors">Genres</Link>
            <Link href="/search" className="text-[#888888] hover:text-[#D90429] transition-colors">Search</Link>
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/profile" className="w-10 h-10 rounded-md bg-[#1F2833] overflow-hidden border border-[#D90429] hover:border-white transition-colors cursor-pointer shadow-[0_0_10px_rgba(217,4,41,0.5)]">
            <img
              src="https://api.dicebear.com/7.x/bottts/svg?seed=AdminBossy&colors=D90429,0B0C10"
              alt="Profile"
              className="w-full h-full object-cover scale-110"
            />
          </Link>
        </div>
      </header>

      <header className="md:hidden fixed top-0 left-0 w-full z-40 bg-[#0B0C10] border-b border-[#1F2833] shadow-lg">
        <div className="flex items-center gap-3 p-4">
          <Download className="text-[#D90429]" size={24} />
          <h1 className="text-lg font-black text-white uppercase tracking-wider">My Downloads</h1>
        </div>
      </header>

      <div className="mt-4 md:mt-8 max-w-4xl mx-auto">
        <div className="hidden md:flex items-center gap-4 mb-8">
          <Download size={32} className="text-[#D90429]" />
          <h1 className="text-3xl font-black text-white uppercase tracking-wider">Downloaded Vault</h1>
        </div>

        <div className="bg-[#1F2833]/30 border border-[#1F2833] rounded-lg p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film size={20} className="text-[#888888]" />
            <span className="text-[#888888] text-sm font-medium">
              Smart Downloads: <span className="text-green-500 font-bold">ON</span>
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

      <div className="fixed bottom-0 left-0 right-0 h-16 bg-[#0B0C10] border-t border-white/5 flex items-center justify-around px-2 z-50 md:hidden pb-safe">
        <Link href="/" className="flex flex-col items-center gap-1 text-[#D90429] w-16 transition-colors">
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
          <span className="text-[10px] font-bold">Home</span>
        </Link>
        <Link href="/vjs" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
          <span className="text-[10px] font-bold">VJs</span>
        </Link>
        <Link href="/genres" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"></path></svg>
          <span className="text-[10px] font-bold">Genres</span>
        </Link>
        <Link href="/search" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          <span className="text-[10px] font-bold">Search</span>
        </Link>
        <Link href="/profile" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
          <span className="text-[10px] font-bold">Profile</span>
        </Link>
      </div>
    </div>
  );
}
