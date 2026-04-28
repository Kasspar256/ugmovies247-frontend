'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download, Film, Play, Trash2 } from 'lucide-react';
import { fetchUserDownloads, removeMovieDownload } from '@/lib/downloads';
import {
  cancelOfflineDownload,
  formatDownloadBytes,
  getActiveOfflineDownloads,
  getDownloadPercent,
  getDownloadRemainingBytes,
  listOfflineDownloads,
  removeOfflineDownload,
  retryOfflineDownload,
  subscribeOfflineDownloads,
  supportsNativeOfflineDownloads,
  type ActiveOfflineDownload,
  type OfflineDownloadRecord,
} from '@/lib/mobile/offlineDownloads';
import MobilePageHeader from '@/components/MobilePageHeader';
import type { DownloadRecord, DownloadStatus } from '@/types/downloads';

type DownloadListItem = DownloadRecord | OfflineDownloadRecord | ActiveOfflineDownload;

function isOfflineRecord(record: DownloadListItem): record is OfflineDownloadRecord {
  return 'isOfflineFile' in record && record.isOfflineFile === true;
}

function isActiveDownload(record: DownloadListItem): record is ActiveOfflineDownload {
  return 'downloadedBytes' in record && 'startedAtIso' in record;
}

function getDownloadIdentity(record: DownloadListItem) {
  return 'downloadKey' in record && record.downloadKey ? record.downloadKey : record.movieId;
}

export default function DownloadsPage() {
  const [downloadedMovies, setDownloadedMovies] = useState<DownloadListItem[]>([]);
  const [activeDownloadJobs, setActiveDownloadJobs] = useState<ActiveOfflineDownload[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DownloadStatus>('completed');
  const [activeOfflineMovie, setActiveOfflineMovie] = useState<OfflineDownloadRecord | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  const loadDownloads = async () => {
    try {
      setActionMessage('');
      const downloads = supportsNativeOfflineDownloads()
        ? await listOfflineDownloads()
        : await fetchUserDownloads();

      setDownloadedMovies(downloads);
    } catch (err) {
      console.error('Error fetching downloads:', err);
      setActionMessage(err instanceof Error ? err.message : 'Downloads could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDownloads();
  }, []);

  useEffect(() => {
    if (!supportsNativeOfflineDownloads()) {
      return;
    }

    const syncActiveDownloads = () => {
      const jobs = getActiveOfflineDownloads();
      setActiveDownloadJobs(jobs);

      if (jobs.length === 0) {
        void loadDownloads();
      }
    };

    syncActiveDownloads();

    return subscribeOfflineDownloads(syncActiveDownloads);
  }, []);

  const handleRemoveDownload = async (movie: DownloadListItem) => {
    try {
      const identity = getDownloadIdentity(movie);

      if (isActiveDownload(movie)) {
        await cancelOfflineDownload(movie.downloadKey);
        setActiveDownloadJobs(getActiveOfflineDownloads());
      } else if (isOfflineRecord(movie)) {
        await removeOfflineDownload(identity);
      } else {
        await removeMovieDownload(movie.movieId);
      }

      setDownloadedMovies((current) => current.filter((item) => getDownloadIdentity(item) !== identity));
      setActionMessage(isActiveDownload(movie) ? 'Download cancelled.' : 'Download removed.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Download could not be removed.');
    }
  };

  const handleRetryDownload = async (movie: ActiveOfflineDownload) => {
    try {
      setActionMessage('Retrying download...');
      await retryOfflineDownload(movie.downloadKey);
      setActiveDownloadJobs(getActiveOfflineDownloads());
      await loadDownloads();
      setActionMessage('Download completed.');
    } catch (error) {
      setActiveDownloadJobs(getActiveOfflineDownloads());
      setActionMessage(error instanceof Error ? error.message : 'Download could not be retried.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4"></div>
      </div>
    );
  }

  const nativeOffline = supportsNativeOfflineDownloads();
  const visibleActiveJobs = nativeOffline ? activeDownloadJobs : [];

  const groupedDownloads: Record<DownloadStatus, DownloadListItem[]> = {
    completed: downloadedMovies.filter((movie) => (movie.status || 'completed') === 'completed'),
    downloading: visibleActiveJobs.filter((movie) => movie.status === 'downloading'),
    failed: [
      ...downloadedMovies.filter((movie) => movie.status === 'failed'),
      ...visibleActiveJobs.filter((movie) => movie.status === 'failed'),
    ],
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
      description: nativeOffline
        ? 'Movies saved inside this device for offline playback.'
        : 'Movies saved to your account activity.',
      emptyText: nativeOffline
        ? 'No offline videos yet. Use the Download button on a movie to save it to this device.'
        : 'No completed downloads yet. Use the Download button on any movie to save it here.',
      statusLabel: nativeOffline ? 'Offline ready' : 'Ready to play',
      statusTone: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    },
    downloading: {
      label: 'Active',
      description: 'Titles that are still downloading appear here.',
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

  const renderDownloadCard = (movie: DownloadListItem, statusLabel: string, statusTone: string) => {
    const activeJob = isActiveDownload(movie) ? movie : null;
    const percent = activeJob ? getDownloadPercent(activeJob) : null;
    const cardContent = (
      <>
        <div className="w-28 md:w-40 rounded relative overflow-hidden aspect-[16/9] flex-shrink-0 bg-black">
          {movie.poster ? (
            <img
              src={movie.poster}
              alt={movie.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white/35">
              <Film size={26} />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-1 bg-[#D90429]"></div>
          <div className="absolute top-2 right-2 bg-black/80 rounded-full p-1">
            <Download size={12} className="text-white" />
          </div>
        </div>
        <div className="flex flex-col justify-center flex-1 min-w-0">
          <h3 className="text-white font-bold text-sm md:text-lg mb-1 line-clamp-2">{movie.title}</h3>
          <p className="text-[#888888] text-xs mb-2">
            {isOfflineRecord(movie) ? 'Saved privately on this device' : 'Saved to your account history'}
          </p>
          <p className={`text-[10px] font-black uppercase px-2 py-0.5 rounded w-max border ${statusTone}`}>
            {statusLabel}
          </p>

          {activeJob ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#D90429] transition-all"
                    style={{ width: `${percent ?? 4}%` }}
                  />
                </div>
                <span className="min-w-10 text-right text-[10px] font-black text-white">
                  {percent === null ? '--' : `${percent}%`}
                </span>
              </div>
              {activeJob.error ? (
                <p className="text-[10px] font-bold text-red-200">{activeJob.error}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </>
    );

    return (
      <div
        key={movie.id}
        className="flex gap-4 bg-[#1F2833]/20 p-3 rounded-lg border border-transparent hover:border-white/10 group shadow-md"
      >
        {isOfflineRecord(movie) ? (
          <button
            type="button"
            onClick={() => setActiveOfflineMovie(movie)}
            className="flex min-w-0 flex-1 gap-4 text-left"
          >
            {cardContent}
          </button>
        ) : (
          <Link href={`/movie/${movie.movieId}`} className="flex min-w-0 flex-1 gap-4">
            {cardContent}
          </Link>
        )}

        <div className="flex items-center gap-2">
          {activeJob?.status === 'downloading' ? (
            <button
              type="button"
              onClick={() => void handleRemoveDownload(activeJob)}
              className="inline-flex items-center rounded-xl border border-red-400/35 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-red-100 transition hover:bg-red-500/15"
            >
              Cancel
            </button>
          ) : null}

          {activeJob?.status === 'failed' ? (
            <button
              type="button"
              onClick={() => void handleRetryDownload(activeJob)}
              className="inline-flex items-center rounded-xl border border-[#D90429]/40 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#D90429] transition hover:bg-[#D90429] hover:text-white"
            >
              Retry
            </button>
          ) : null}

          {isOfflineRecord(movie) ? (
            <button
              type="button"
              onClick={() => setActiveOfflineMovie(movie)}
              className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-[#D90429]/40 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#D90429] transition-colors hover:bg-[#D90429] hover:text-white"
            >
              <Play size={14} />
              Play
            </button>
          ) : null}

          {!activeJob ? (
            <button
              type="button"
              onClick={() => void handleRemoveDownload(movie)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-white/55 transition hover:border-red-500/35 hover:text-red-200"
              aria-label={`Remove ${movie.title}`}
            >
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pb-14 md:pt-[118px] lg:px-10 font-sans">
      <MobilePageHeader title="Downloads" fallbackHref="/profile" />

      <div className="mt-4 md:mt-2 max-w-5xl mx-auto">
        <div className="hidden md:flex items-center gap-4 mb-8">
          <Download size={32} className="text-[#D90429]" />
          <h1 className="text-3xl font-black text-white uppercase tracking-wider">Downloads</h1>
        </div>

        <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-bold leading-6 text-amber-100">
          Downloads are kept for 7 days, then removed automatically to keep your library clean.
        </div>

        <div className="bg-[#1F2833]/30 border border-[#1F2833] rounded-lg p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film size={20} className="text-[#888888]" />
            <span className="text-[#888888] text-sm font-medium">
              {nativeOffline ? 'Titles saved inside hidden app storage' : 'Titles saved from your account activity'}
            </span>
          </div>
          <span className="text-xs text-[#888888] font-mono">
            {downloadedMovies.length} saved
          </span>
        </div>

        {actionMessage ? (
          <div className="mb-4 rounded-2xl border border-[#7AA2D6]/20 bg-[#182334]/88 px-4 py-3 text-sm text-[#D9E7FF]">
            {actionMessage}
          </div>
        ) : null}

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

      {activeOfflineMovie ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/82 px-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl overflow-hidden rounded-[28px] border border-white/10 bg-[#0F1621] shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">
                  Offline Playback
                </div>
                <h2 className="truncate text-sm font-bold text-white">{activeOfflineMovie.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveOfflineMovie(null)}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/70"
              >
                Close
              </button>
            </div>
            <video
              src={activeOfflineMovie.playbackUrl}
              poster={activeOfflineMovie.poster}
              controls
              playsInline
              className="aspect-video w-full bg-black"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
