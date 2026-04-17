'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, RotateCcw, SquareX } from 'lucide-react';
import { fetchAdminJson } from '@/lib/admin/fetchAdminJson';
import type { VideoJobDocument, VideoJobStatus } from '@/types/videoJobs';
import { Card, StatTile, TextInput } from '@/components/admin/controlCenterFields';

type VideoJobsResponse = {
  jobs?: VideoJobDocument[];
};

type RepairResponse = {
  success?: boolean;
  queuedJobs?: number;
  updatedMovies?: number;
  scannedMovies?: number;
};

type RepairCandidate = {
  movieId: string;
  title: string;
  contentType: 'movie' | 'series';
  repairableAssetCount: number;
  repairableRootCount: number;
  repairablePartCount: number;
  repairableEpisodeCount: number;
  updatedAt: string;
};

type RepairCandidatesResponse = {
  candidates?: RepairCandidate[];
};

function formatTimestamp(value?: string) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString();
}

function getStatusTone(status?: VideoJobStatus) {
  switch (status) {
    case 'ready':
      return 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
    case 'failed':
      return 'border border-red-500/25 bg-red-500/10 text-red-100';
    case 'cancelled':
      return 'border border-amber-500/25 bg-amber-500/10 text-amber-100';
    default:
      return 'border border-sky-500/20 bg-sky-500/10 text-sky-100';
  }
}

function getTargetLabel(job: VideoJobDocument) {
  if (job.target.kind === 'movie') {
    return 'Movie';
  }

  if (job.target.kind === 'part') {
    return 'Movie Part';
  }

  return `Series Episode S${job.target.seasonNumber}E${job.target.episodeNumber}`;
}

function isCancelable(status?: VideoJobStatus) {
  return (
    status === 'queued' ||
    status === 'validating' ||
    status === 'downloading' ||
    status === 'packaging' ||
    status === 'transcoding' ||
    status === 'uploading_source'
  );
}

export function AdminVideoJobsTab() {
  const [jobs, setJobs] = useState<VideoJobDocument[]>([]);
  const [repairCandidates, setRepairCandidates] = useState<RepairCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [actionBusyId, setActionBusyId] = useState('');
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairCandidatesLoading, setRepairCandidatesLoading] = useState(true);
  const [repairSearch, setRepairSearch] = useState('');
  const [selectedRepairMovieIds, setSelectedRepairMovieIds] = useState<string[]>([]);

  const loadJobs = async (showSpinner = false) => {
    if (showSpinner) {
      setLoading(true);
    }

    try {
      const payload = await fetchAdminJson<VideoJobsResponse>('/api/admin/video-jobs', {
        force: true,
      });
      setJobs(payload.jobs || []);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load video jobs.');
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  };

  const loadRepairCandidates = async (showSpinner = false) => {
    if (showSpinner) {
      setRepairCandidatesLoading(true);
    }

    try {
      const payload = await fetchAdminJson<RepairCandidatesResponse>(
        '/api/admin/video-jobs/repair-direct-uploads?limit=250',
        {
          force: true,
        }
      );
      const nextCandidates = payload.candidates || [];
      setRepairCandidates(nextCandidates);
      setSelectedRepairMovieIds((current) =>
        current.filter((movieId) => nextCandidates.some((candidate) => candidate.movieId === movieId))
      );
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to load legacy repair candidates.'
      );
    } finally {
      if (showSpinner) {
        setRepairCandidatesLoading(false);
      }
    }
  };

  useEffect(() => {
    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = async () => {
      await Promise.all([loadJobs(true), loadRepairCandidates(true)]);

      if (!mounted) {
        return;
      }

      intervalId = setInterval(() => {
        void loadJobs(false);
      }, 5000);
    };

    void start();

    return () => {
      mounted = false;

      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  const jobCounts = useMemo(() => {
    return jobs.reduce(
      (counts, job) => {
        if (job.status === 'ready') {
          counts.ready += 1;
        } else if (job.status === 'failed') {
          counts.failed += 1;
        } else if (job.status === 'cancelled') {
          counts.cancelled += 1;
        } else {
          counts.active += 1;
        }

        return counts;
      },
      { active: 0, ready: 0, failed: 0, cancelled: 0 }
    );
  }, [jobs]);

  const filteredRepairCandidates = useMemo(() => {
    const normalizedSearch = repairSearch.trim().toLowerCase();

    return normalizedSearch
      ? repairCandidates.filter((candidate) =>
          `${candidate.title} ${candidate.contentType}`
            .toLowerCase()
            .includes(normalizedSearch)
        )
      : repairCandidates;
  }, [repairCandidates, repairSearch]);

  const selectedRepairCount = selectedRepairMovieIds.length;

  const toggleRepairCandidate = (movieId: string) => {
    setSelectedRepairMovieIds((current) =>
      current.includes(movieId)
        ? current.filter((entry) => entry !== movieId)
        : [...current, movieId]
    );
  };

  const toggleVisibleRepairCandidates = () => {
    const visibleMovieIds = filteredRepairCandidates.map((candidate) => candidate.movieId);
    const allVisibleSelected = visibleMovieIds.every((movieId) =>
      selectedRepairMovieIds.includes(movieId)
    );

    setSelectedRepairMovieIds((current) => {
      if (allVisibleSelected) {
        return current.filter((movieId) => !visibleMovieIds.includes(movieId));
      }

      return Array.from(new Set([...current, ...visibleMovieIds]));
    });
  };

  const handleRetry = async (jobId: string) => {
    setActionBusyId(jobId);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const response = await fetch(`/api/admin/video-jobs/${encodeURIComponent(jobId)}/retry`, {
        method: 'POST',
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to retry the job.');
      }

      setStatusMessage('The failed job was moved back into the queue.');
      await loadJobs(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to retry the job.');
    } finally {
      setActionBusyId('');
    }
  };

  const handleCancel = async (jobId: string) => {
    setActionBusyId(jobId);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const response = await fetch(`/api/admin/video-jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to cancel the job.');
      }

      setStatusMessage('The job was cancelled.');
      await loadJobs(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to cancel the job.');
    } finally {
      setActionBusyId('');
    }
  };

  const handleRepairLegacyUploads = async () => {
    if (!selectedRepairMovieIds.length) {
      setErrorMessage('Select at least one movie before queueing repairs.');
      return;
    }

    setRepairBusy(true);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const response = await fetch('/api/admin/video-jobs/repair-direct-uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movieIds: selectedRepairMovieIds,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as RepairResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to queue legacy direct-upload repairs.');
      }

      setStatusMessage(
        payload.queuedJobs
          ? `Queued ${payload.queuedJobs} repair job${payload.queuedJobs === 1 ? '' : 's'} across ${payload.updatedMovies || 0} selected movie${payload.updatedMovies === 1 ? '' : 's'}.`
          : `None of the selected movies needed repair anymore.`
      );
      setSelectedRepairMovieIds([]);
      await Promise.all([loadJobs(false), loadRepairCandidates(false)]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to queue legacy direct-upload repairs.'
      );
    } finally {
      setRepairBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {(statusMessage || errorMessage) && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            errorMessage
              ? 'border-red-500/30 bg-red-500/10 text-red-100'
              : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
          }`}
        >
          {errorMessage || statusMessage}
        </div>
      )}

      <Card
        title="Processing Queue"
        description="Monitor queued, active, failed, and ready MP4 processing jobs without opening the terminal."
        action={
          <button
            type="button"
            onClick={() => void loadJobs(true)}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatTile title="Active / Queued" value={jobCounts.active} />
          <StatTile title="Ready" value={jobCounts.ready} />
          <StatTile title="Failed" value={jobCounts.failed} />
          <StatTile title="Cancelled" value={jobCounts.cancelled} />
        </div>

        <div className="mt-5 rounded-[24px] border border-[#D90429]/18 bg-[linear-gradient(180deg,rgba(23,9,13,0.9),rgba(17,20,28,0.96))] p-4">
          <div className="flex flex-col gap-4">
            <div className="max-w-3xl">
              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-[#FFB3C1]">
                Legacy Repair
              </div>
              <p className="mt-2 text-sm leading-7 text-white/70">
                Pick the exact old direct-upload movies you want to repair instead of queueing them all at once. That keeps the VPS safer and lets you work in controlled batches.
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="w-full lg:max-w-md">
                <TextInput
                  value={repairSearch}
                  onChange={(event) => setRepairSearch(event.target.value)}
                  placeholder="Search repairable movies..."
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadRepairCandidates(true)}
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                >
                  Refresh Repairables
                </button>
                <button
                  type="button"
                  onClick={toggleVisibleRepairCandidates}
                  disabled={!filteredRepairCandidates.length}
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                >
                  {filteredRepairCandidates.length &&
                  filteredRepairCandidates.every((candidate) =>
                    selectedRepairMovieIds.includes(candidate.movieId)
                  )
                    ? 'Clear Visible'
                    : 'Select Visible'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRepairMovieIds([])}
                  disabled={!selectedRepairCount}
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs leading-6 text-white/60">
                {selectedRepairCount} selected | {filteredRepairCandidates.length} repairable movie
                {filteredRepairCandidates.length === 1 ? '' : 's'} shown
              </div>
              <button
                type="button"
                onClick={handleRepairLegacyUploads}
                disabled={repairBusy || !selectedRepairCount}
                className="inline-flex items-center justify-center rounded-full bg-[#D90429] px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
              >
                {repairBusy ? 'Queueing Selected Repairs...' : 'Queue Selected Repairs'}
              </button>
            </div>
          </div>

          {repairCandidatesLoading ? (
            <div className="mt-4 flex items-center justify-center rounded-2xl border border-white/10 bg-black/20 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-[#D90429]" />
            </div>
          ) : filteredRepairCandidates.length ? (
            <div className="mt-4 space-y-3">
              {filteredRepairCandidates.map((candidate) => {
                const isSelected = selectedRepairMovieIds.includes(candidate.movieId);

                return (
                  <label
                    key={candidate.movieId}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4 transition-colors ${
                      isSelected
                        ? 'border-[#D90429]/35 bg-[#D90429]/10'
                        : 'border-white/10 bg-black/20 hover:bg-black/30'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRepairCandidate(candidate.movieId)}
                      className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent text-[#D90429] focus:ring-[#D90429]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-bold text-white">{candidate.title}</div>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
                          {candidate.contentType}
                        </span>
                        <span className="rounded-full border border-[#D90429]/20 bg-[#D90429]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#FFB3C1]">
                          {candidate.repairableAssetCount} repairable asset
                          {candidate.repairableAssetCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="mt-2 text-xs leading-6 text-white/55">
                        {candidate.repairableRootCount ? `${candidate.repairableRootCount} root file` : null}
                        {candidate.repairableRootCount &&
                        (candidate.repairablePartCount || candidate.repairableEpisodeCount)
                          ? ' | '
                          : null}
                        {candidate.repairablePartCount ? `${candidate.repairablePartCount} part${candidate.repairablePartCount === 1 ? '' : 's'}` : null}
                        {candidate.repairablePartCount && candidate.repairableEpisodeCount ? ' | ' : null}
                        {candidate.repairableEpisodeCount
                          ? `${candidate.repairableEpisodeCount} episode${candidate.repairableEpisodeCount === 1 ? '' : 's'}`
                          : null}
                      </div>
                      <div className="mt-1 text-xs leading-6 text-white/45">
                        Updated {formatTimestamp(candidate.updatedAt)}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">
              No repairable legacy direct-upload movies matched your current search.
            </div>
          )}
        </div>

        {loading ? (
          <div className="mt-5 flex items-center justify-center rounded-2xl border border-white/10 bg-black/20 py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[#D90429]" />
          </div>
        ) : jobs.length ? (
          <div className="mt-5 space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-bold text-white">{job.title}</div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${getStatusTone(
                          job.status
                        )}`}
                      >
                        {job.status || 'queued'}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
                        {getTargetLabel(job)}
                      </span>
                    </div>

                    <div className="mt-2 text-xs leading-6 text-white/55">
                      {job.id} | Updated {formatTimestamp(job.updatedAt)}
                    </div>

                    <div className="mt-3 overflow-hidden rounded-full border border-white/10 bg-white/5">
                      <div
                        className={`h-2 transition-all duration-300 ${
                          job.status === 'failed'
                            ? 'bg-red-500'
                            : job.status === 'ready'
                              ? 'bg-emerald-500'
                              : 'bg-[#D90429]'
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, Number(job.progress || 0)))}%` }}
                      />
                    </div>

                    <div className="mt-2 text-xs leading-6 text-white/55">
                      Progress: {Math.max(0, Math.min(100, Number(job.progress || 0)))}%
                    </div>

                    {job.errorMessage ? (
                      <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-xs leading-6 text-red-100">
                        {job.errorMessage}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    <Link
                      href={`/admin/movies/${job.target.movieId}`}
                      className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                    >
                      Open Admin
                    </Link>
                    <Link
                      href={`/movie/${job.target.movieId}`}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-100 transition-colors hover:bg-emerald-500/15"
                    >
                      <CheckCircle2 size={13} />
                      Open App
                    </Link>
                    {job.status === 'failed' || job.status === 'cancelled' ? (
                      <button
                        type="button"
                        onClick={() => job.id && handleRetry(job.id)}
                        disabled={actionBusyId === job.id}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-sky-100 transition-colors hover:bg-sky-500/15 disabled:opacity-60"
                      >
                        <RotateCcw size={13} />
                        Retry
                      </button>
                    ) : null}
                    {isCancelable(job.status) ? (
                      <button
                        type="button"
                        onClick={() => job.id && handleCancel(job.id)}
                        disabled={actionBusyId === job.id}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-amber-100 transition-colors hover:bg-amber-500/15 disabled:opacity-60"
                      >
                        <SquareX size={13} />
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-sm text-white/45">
            No processing jobs have been recorded yet.
          </div>
        )}
      </Card>
    </div>
  );
}
