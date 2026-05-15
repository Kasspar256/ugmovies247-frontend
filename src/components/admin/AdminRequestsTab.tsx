'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Check,
  Clapperboard,
  Film,
  ImagePlus,
  Loader2,
  MessageSquareText,
  MonitorPlay,
  PlayCircle,
  Search,
  ServerCog,
  Sparkles,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import type {
  AdminCategory,
  AdminRequest,
  AdminRequestStatus,
  RequestProcessingJob,
} from '@/types/admin';
import { uploadPosterToAdmin } from '@/lib/admin/directUploadClient';
import { db } from '@/lib/firebase';
import { Card, FieldLabel, SelectInput, TextArea, TextInput } from '@/components/admin/controlCenterFields';
import { CategoryChecklist } from '@/components/admin/controlCenterEditors';
import { REQUEST_STATUS_OPTIONS, formatDate } from '@/components/admin/controlCenterUtils';

type RequestConsoleTab = 'queue' | 'engine' | 'monitor';

type RequestEdit = {
  status: AdminRequestStatus;
  adminNotes: string;
  sourceUrl: string;
  sourceFileName: string;
  customReply: string;
  rejectionMessage: string;
  movieId: string;
  title: string;
  originalTitle: string;
  description: string;
  poster: string;
  backdrop: string;
  genres: string;
  category: string[];
  vj: string;
  releaseDate: string;
  releaseYear: string;
  tmdbId: string;
  contentType: 'movie' | 'series';
  seasonNumber: string;
  episodeNumber: string;
  seasonTitle: string;
  episodeTitle: string;
};

type TmdbResult = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
};

type TmdbDetails = TmdbResult & {
  genres?: Array<{ id: number; name: string }>;
};

function buildImageUrl(path?: string | null, size = 'w780') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
}

function getTmdbTitle(result: TmdbResult) {
  return result.title || result.name || 'Untitled';
}

function getTmdbOriginalTitle(result: TmdbResult) {
  return result.original_title || result.original_name || getTmdbTitle(result);
}

function getTmdbDate(result: TmdbResult) {
  return result.release_date || result.first_air_date || '';
}

function yearFromDate(value: string) {
  const match = value.match(/^(\d{4})/);
  return match ? match[1] : '';
}

function createRequestEditFallback(request: AdminRequest): RequestEdit {
  return {
    status: request.status,
    adminNotes: request.adminNotes || '',
    sourceUrl: request.sourceUrl || '',
    sourceFileName: request.sourceFileName || '',
    customReply: request.customReply || '',
    rejectionMessage: request.rejectionMessage || '',
    movieId: request.movieId || '',
    title: request.title || request.movieTitle || '',
    originalTitle: request.originalTitle || '',
    description: request.description || request.overview || request.notes || '',
    poster: request.poster || '',
    backdrop: request.backdrop || request.banner || '',
    genres: (request.genres || []).join(', '),
    category: request.category || [],
    vj: request.preferredVj || '',
    releaseDate: request.releaseDate || '',
    releaseYear: request.releaseYear ? String(request.releaseYear) : '',
    tmdbId: request.tmdbId ? String(request.tmdbId) : '',
    contentType: request.contentType === 'series' ? 'series' : 'movie',
    seasonNumber: request.seasonNumber ? String(request.seasonNumber) : '1',
    episodeNumber: request.episodeNumber ? String(request.episodeNumber) : '1',
    seasonTitle: request.seasonTitle || 'Season 1',
    episodeTitle: request.episodeTitle || '',
  };
}

function statusClassName(status: string) {
  if (status === 'uploaded') {
    return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100';
  }

  if (status === 'failed' || status === 'rejected') {
    return 'border-red-300/25 bg-red-500/10 text-red-100';
  }

  if (status === 'processing' || status === 'uploading' || status === 'downloading') {
    return 'border-sky-300/25 bg-sky-400/10 text-sky-100';
  }

  return 'border-white/10 bg-white/5 text-white/70';
}

export function AdminRequestsTab({
  requests,
  categories,
  search,
  onSearchChange,
  requestEdits,
  onChangeRequestEdit,
  onSaveRequest,
  onRequestAction,
  actionBusy,
}: {
  requests: AdminRequest[];
  categories: AdminCategory[];
  search: string;
  onSearchChange: (value: string) => void;
  requestEdits: Record<string, RequestEdit>;
  onChangeRequestEdit: (requestId: string, nextEdit: RequestEdit) => void;
  onSaveRequest: (requestId: string) => void;
  onRequestAction: (requestId: string, action: 'fulfill' | 'vjVariance' | 'reject') => void;
  actionBusy: boolean;
}) {
  const [activeConsoleTab, setActiveConsoleTab] = useState<RequestConsoleTab>('queue');
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [tmdbQuery, setTmdbQuery] = useState('');
  const [tmdbResults, setTmdbResults] = useState<TmdbResult[]>([]);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [tmdbError, setTmdbError] = useState('');
  const [uploadingImage, setUploadingImage] = useState<'poster' | 'backdrop' | ''>('');
  const [workerJobs, setWorkerJobs] = useState<RequestProcessingJob[]>([]);
  const [workerError, setWorkerError] = useState('');

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) || requests[0] || null,
    [requests, selectedRequestId]
  );

  const selectedEdit = selectedRequest
    ? requestEdits[selectedRequest.id] || createRequestEditFallback(selectedRequest)
    : null;

  useEffect(() => {
    if (!selectedRequestId && requests[0]) {
      setSelectedRequestId(requests[0].id);
    }
  }, [requests, selectedRequestId]);

  useEffect(() => {
    const jobsQuery = query(
      collection(db, 'request_processing_jobs'),
      orderBy('updatedAt', 'desc'),
      limit(50)
    );

    return onSnapshot(
      jobsQuery,
      (snapshot) => {
        setWorkerJobs(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            ...(doc.data() as Omit<RequestProcessingJob, 'id'>),
          }))
        );
        setWorkerError('');
      },
      (error) => {
        setWorkerError(error.message || 'Failed to load live worker monitor.');
      }
    );
  }, []);

  const openProcessingConsole = (requestId: string) => {
    setSelectedRequestId(requestId);
    setActiveConsoleTab('engine');
    const request = requests.find((entry) => entry.id === requestId);
    const edit = request ? requestEdits[requestId] || createRequestEditFallback(request) : null;
    setTmdbQuery(edit?.title || request?.title || '');
  };

  const updateSelectedEdit = (patch: Partial<RequestEdit>) => {
    if (!selectedRequest || !selectedEdit) {
      return;
    }

    onChangeRequestEdit(selectedRequest.id, {
      ...selectedEdit,
      ...patch,
    });
  };

  const toggleCategory = (name: string) => {
    if (!selectedEdit) {
      return;
    }

    updateSelectedEdit({
      category: selectedEdit.category.includes(name)
        ? selectedEdit.category.filter((entry) => entry !== name)
        : [...selectedEdit.category, name],
    });
  };

  const searchTmdb = async () => {
    if (!tmdbQuery.trim() || !selectedEdit) {
      setTmdbError('Enter a title before searching TMDB.');
      return;
    }

    setTmdbLoading(true);
    setTmdbError('');

    try {
      const mediaType = selectedEdit.contentType === 'series' ? 'tv' : 'movie';
      const response = await fetch(
        `/api/admin/tmdb?title=${encodeURIComponent(tmdbQuery.trim())}&mediaType=${mediaType}`
      );
      const payload = (await response.json().catch(() => ({}))) as
        | TmdbResult[]
        | {
        results?: TmdbResult[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(Array.isArray(payload) ? 'TMDB search failed.' : payload.error || 'TMDB search failed.');
      }

      setTmdbResults(Array.isArray(payload) ? payload : payload.results || []);
    } catch (error) {
      setTmdbError(error instanceof Error ? error.message : 'TMDB search failed.');
    } finally {
      setTmdbLoading(false);
    }
  };

  const applyTmdbResult = async (result: TmdbResult) => {
    if (!selectedEdit) {
      return;
    }

    setTmdbLoading(true);
    setTmdbError('');

    try {
      const mediaType = selectedEdit.contentType === 'series' ? 'tv' : 'movie';
      const response = await fetch(
        `/api/admin/tmdb?tmdbId=${encodeURIComponent(result.id)}&mediaType=${mediaType}`
      );
      const details = (await response.json().catch(() => ({}))) as TmdbDetails & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(details.error || 'Failed to fetch TMDB details.');
      }

      const releaseDate = getTmdbDate(details) || getTmdbDate(result);

      updateSelectedEdit({
        title: getTmdbTitle(details) || getTmdbTitle(result),
        originalTitle: getTmdbOriginalTitle(details) || getTmdbOriginalTitle(result),
        description: details.overview || result.overview || selectedEdit.description,
        poster: buildImageUrl(details.poster_path || result.poster_path) || selectedEdit.poster,
        backdrop:
          buildImageUrl(details.backdrop_path || result.backdrop_path, 'w1280') ||
          selectedEdit.backdrop,
        releaseDate,
        releaseYear: yearFromDate(releaseDate),
        tmdbId: String(details.id || result.id),
        genres: (details.genres || [])
          .map((genre) => genre.name)
          .filter(Boolean)
          .join(', '),
      });
    } catch (error) {
      setTmdbError(error instanceof Error ? error.message : 'Failed to fetch TMDB details.');
    } finally {
      setTmdbLoading(false);
    }
  };

  const uploadImageOverride = async (file: File | null, field: 'poster' | 'backdrop') => {
    if (!file) {
      return;
    }

    setUploadingImage(field);

    try {
      const uploaded = await uploadPosterToAdmin(file);
      updateSelectedEdit(
        field === 'poster'
          ? { poster: uploaded.publicUrl }
          : { backdrop: uploaded.publicUrl }
      );
    } catch (error) {
      setTmdbError(error instanceof Error ? error.message : 'Image upload failed.');
    } finally {
      setUploadingImage('');
    }
  };

  return (
    <Card
      title="Movie Request Management System"
      description="A dedicated request pipeline for metadata preparation, isolated VPS processing, live worker progress, and exactly three user communication scenarios."
      action={
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'queue' as const, label: 'Active Queue', icon: <BellRing size={14} /> },
            { id: 'engine' as const, label: 'Processing Engine', icon: <ServerCog size={14} /> },
            { id: 'monitor' as const, label: 'Worker Monitor', icon: <MonitorPlay size={14} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveConsoleTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] transition ${
                activeConsoleTab === tab.id
                  ? 'bg-[#D90429] text-white shadow-[0_0_24px_rgba(217,4,41,0.28)]'
                  : 'border border-white/10 bg-white/5 text-white/65 hover:bg-white/10'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      }
    >
      {activeConsoleTab === 'queue' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <TextInput
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search by request title, user email, VJ, or note..."
              className="pl-10"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {requests.map((request) => {
              const edit = requestEdits[request.id] || createRequestEditFallback(request);
              const requester = request.userEmail || request.requesterEmail || request.requesterName || 'Unknown user';

              return (
                <article
                  key={request.id}
                  className="rounded-[28px] border border-white/10 bg-[#0C1017] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.24)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-black text-white">{request.title}</div>
                      <div className="mt-1 text-xs text-white/50">{requester}</div>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusClassName(request.status)}`}>
                      {request.status}
                    </span>
                  </div>

                  <p className="mt-3 min-h-[44px] text-sm leading-6 text-white/58">
                    {request.notes || 'No requester note was provided.'}
                  </p>

                  <div className="mt-4 grid gap-2 text-xs text-white/45 sm:grid-cols-2">
                    <div>Requested: {formatDate(request.createdAt || request.timestamp)}</div>
                    <div>Preferred VJ: {request.preferredVj || 'Not specified'}</div>
                    <div>Push token: {request.fcmToken ? 'Ready' : 'Missing'}</div>
                    <div>Stage: {request.currentStage || request.workerStatus || 'Waiting'}</div>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => openProcessingConsole(request.id)}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-500 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-white"
                    >
                      <PlayCircle size={14} />
                      Open Console
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => onSaveRequest(request.id)}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-white/80 disabled:opacity-50"
                    >
                      <Check size={14} />
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => onRequestAction(request.id, 'reject')}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-[#D90429] px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-white disabled:opacity-50"
                    >
                      <XCircle size={14} />
                      Reject
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <SelectInput
                      value={edit.status}
                      onChange={(event) =>
                        onChangeRequestEdit(request.id, {
                          ...edit,
                          status: event.target.value as AdminRequestStatus,
                        })
                      }
                    >
                      {REQUEST_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </SelectInput>
                    <TextInput
                      value={edit.movieId}
                      onChange={(event) =>
                        onChangeRequestEdit(request.id, {
                          ...edit,
                          movieId: event.target.value,
                        })
                      }
                      placeholder="Existing movie ID if manually fulfilled..."
                    />
                  </div>
                </article>
              );
            })}
          </div>

          {!requests.length && (
            <div className="rounded-3xl border border-white/10 bg-black/20 p-8 text-center text-sm text-white/55">
              No movie requests found.
            </div>
          )}
        </div>
      )}

      {activeConsoleTab === 'engine' && (
        <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <aside className="space-y-3">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">
                Select Request
              </div>
              <div className="mt-3 space-y-2">
                {requests.map((request) => (
                  <button
                    key={request.id}
                    type="button"
                    onClick={() => openProcessingConsole(request.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      selectedRequest?.id === request.id
                        ? 'border-[#D90429]/40 bg-[#D90429]/10 text-white'
                        : 'border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.07]'
                    }`}
                  >
                    <div className="text-sm font-black">{request.title}</div>
                    <div className="mt-1 text-xs text-white/45">{request.userEmail || request.requesterEmail}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-amber-300/15 bg-amber-400/[0.06] p-4">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-amber-100">
                <Sparkles size={14} />
                Strict Notifications
              </div>
              <p className="mt-3 text-sm leading-6 text-white/58">
                Users are notified only when rejected, when VJ variance is sent, or when the worker
                completes upload and the movie is live.
              </p>
            </div>
          </aside>

          {!selectedRequest || !selectedEdit ? (
            <div className="rounded-3xl border border-white/10 bg-black/20 p-8 text-center text-sm text-white/55">
              Select a request to open the processing engine.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-[30px] border border-white/10 bg-[#0C1017] p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/45">
                      Advanced Processing Console
                    </div>
                    <h3 className="mt-2 text-2xl font-black text-white">{selectedEdit.title}</h3>
                    <p className="mt-2 text-sm text-white/55">
                      Build metadata, attach artwork, choose content type, then send to the isolated request VPS.
                    </p>
                  </div>
                  <div className="grid min-w-[320px] gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => updateSelectedEdit({ contentType: 'movie' })}
                      className={`rounded-3xl border p-4 text-left transition ${
                        selectedEdit.contentType === 'movie'
                          ? 'border-[#D90429]/45 bg-[#D90429]/15 text-white shadow-[0_18px_42px_rgba(217,4,41,0.18)]'
                          : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.07]'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em]">
                        <Film size={14} />
                        Movie Workspace
                      </span>
                      <span className="mt-2 block text-[11px] leading-5 text-white/45">
                        Poster-first metadata, one final stream URL.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSelectedEdit({ contentType: 'series' })}
                      className={`rounded-3xl border p-4 text-left transition ${
                        selectedEdit.contentType === 'series'
                          ? 'border-sky-300/45 bg-sky-400/15 text-white shadow-[0_18px_42px_rgba(14,165,233,0.16)]'
                          : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.07]'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em]">
                        <Clapperboard size={14} />
                        Series Workspace
                      </span>
                      <span className="mt-2 block text-[11px] leading-5 text-white/45">
                        Backdrop-first shell with season and episode controls.
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <section className="rounded-[30px] border border-sky-300/15 bg-sky-400/[0.05] p-5">
                  <FieldLabel>
                    {selectedEdit.contentType === 'series'
                      ? 'TMDB Series Engine'
                      : 'TMDB Movie Engine'}
                  </FieldLabel>
                  <p className="mb-3 mt-1 text-sm leading-6 text-white/55">
                    Search applies one unified metadata package: title, year, genres, plot, poster,
                    and backdrop. You can override any field afterwards without losing the others.
                  </p>
                  <div className="flex gap-2">
                    <TextInput
                      value={tmdbQuery}
                      onChange={(event) => setTmdbQuery(event.target.value)}
                      placeholder="Search official TMDB metadata..."
                    />
                    <button
                      type="button"
                      disabled={tmdbLoading}
                      onClick={() => void searchTmdb()}
                      className="inline-flex min-w-[120px] items-center justify-center gap-2 rounded-2xl bg-sky-500 px-4 text-xs font-black uppercase tracking-[0.16em] text-white disabled:opacity-50"
                    >
                      {tmdbLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                      Search
                    </button>
                  </div>
                  {tmdbError && (
                    <div className="mt-3 rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                      {tmdbError}
                    </div>
                  )}
                  <div className="mt-4 space-y-2">
                    {tmdbResults.slice(0, 6).map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => void applyTmdbResult(result)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-left hover:bg-white/[0.06]"
                      >
                        {result.poster_path ? (
                          <img
                            src={buildImageUrl(result.poster_path, 'w185')}
                            alt=""
                            className="h-16 w-11 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-16 w-11 items-center justify-center rounded-lg bg-white/10 text-white/30">
                            <Film size={16} />
                          </div>
                        )}
                        <div>
                          <div className="text-sm font-black text-white">{getTmdbTitle(result)}</div>
                          <div className="mt-1 text-xs text-white/45">{getTmdbDate(result) || 'No date'}</div>
                        </div>
                      </button>
                    ))}
                    {!tmdbLoading && tmdbQuery.trim() && tmdbResults.length === 0 && !tmdbError && (
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/45">
                        No TMDB results loaded yet. Search, then choose a result to populate the form.
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-[30px] border border-white/10 bg-black/20 p-5">
                  <FieldLabel>
                    {selectedEdit.contentType === 'series'
                      ? 'Series Backdrop, Poster & Manual Overrides'
                      : 'Movie Poster, Backdrop & Manual Overrides'}
                  </FieldLabel>
                  <p className="mb-4 mt-1 text-sm leading-6 text-white/55">
                    TMDB fills both images. Manual uploads only replace the selected image and keep
                    the title, plot, genres, and release data intact.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="aspect-[2/3] overflow-hidden rounded-2xl border border-white/10 bg-[#0C1017]">
                        {selectedEdit.poster ? (
                          <img src={selectedEdit.poster} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-white/25">
                            <ImagePlus size={34} />
                          </div>
                        )}
                      </div>
                      <TextInput
                        value={selectedEdit.poster}
                        onChange={(event) => updateSelectedEdit({ poster: event.target.value })}
                        placeholder="Poster URL..."
                        className="mt-3"
                      />
                      <input
                        type="file"
                        accept="image/*"
                        disabled={Boolean(uploadingImage)}
                        onChange={(event) => void uploadImageOverride(event.currentTarget.files?.[0] || null, 'poster')}
                        className="mt-3 block w-full text-xs text-white/55 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.14em] file:text-white"
                      />
                    </div>
                    <div>
                      <div className="aspect-video overflow-hidden rounded-2xl border border-white/10 bg-[#0C1017]">
                        {selectedEdit.backdrop ? (
                          <img src={selectedEdit.backdrop} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-white/25">
                            <ImagePlus size={34} />
                          </div>
                        )}
                      </div>
                      <TextInput
                        value={selectedEdit.backdrop}
                        onChange={(event) => updateSelectedEdit({ backdrop: event.target.value })}
                        placeholder="Banner/backdrop URL..."
                        className="mt-3"
                      />
                      <input
                        type="file"
                        accept="image/*"
                        disabled={Boolean(uploadingImage)}
                        onChange={(event) => void uploadImageOverride(event.currentTarget.files?.[0] || null, 'backdrop')}
                        className="mt-3 block w-full text-xs text-white/55 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.14em] file:text-white"
                      />
                    </div>
                  </div>
                </section>
              </div>

              <section
                className={`rounded-[30px] border p-5 ${
                  selectedEdit.contentType === 'series'
                    ? 'border-sky-300/15 bg-sky-400/[0.05]'
                    : 'border-white/10 bg-black/20'
                }`}
              >
                <div className="mb-5">
                  <FieldLabel>
                    {selectedEdit.contentType === 'series'
                      ? 'Dedicated Series Metadata Workspace'
                      : 'Dedicated Movie Metadata Workspace'}
                  </FieldLabel>
                  <p className="mt-1 text-sm leading-6 text-white/55">
                    {selectedEdit.contentType === 'series'
                      ? 'This builds the series shell, backdrop, season, and episode document before the request VPS writes the final episode stream.'
                      : 'This builds the movie document with poster, metadata, categories, and final stream target before the request VPS starts processing.'}
                  </p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <FieldLabel>Title</FieldLabel>
                    <TextInput
                      value={selectedEdit.title}
                      onChange={(event) => updateSelectedEdit({ title: event.target.value })}
                    />
                  </div>
                  <div>
                    <FieldLabel>Original Title</FieldLabel>
                    <TextInput
                      value={selectedEdit.originalTitle}
                      onChange={(event) => updateSelectedEdit({ originalTitle: event.target.value })}
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <FieldLabel>Plot Summary</FieldLabel>
                    <TextArea
                      rows={4}
                      value={selectedEdit.description}
                      onChange={(event) => updateSelectedEdit({ description: event.target.value })}
                    />
                  </div>
                  <div>
                    <FieldLabel>Genres</FieldLabel>
                    <TextInput
                      value={selectedEdit.genres}
                      onChange={(event) => updateSelectedEdit({ genres: event.target.value })}
                      placeholder="Action, Drama, Thriller..."
                    />
                  </div>
                  <div>
                    <FieldLabel>VJ / Translation</FieldLabel>
                    <TextInput
                      value={selectedEdit.vj}
                      onChange={(event) => updateSelectedEdit({ vj: event.target.value })}
                      placeholder="VJ Emmy, VJ Junior..."
                    />
                  </div>
                  <div>
                    <FieldLabel>Release Date</FieldLabel>
                    <TextInput
                      value={selectedEdit.releaseDate}
                      onChange={(event) =>
                        updateSelectedEdit({
                          releaseDate: event.target.value,
                          releaseYear: yearFromDate(event.target.value) || selectedEdit.releaseYear,
                        })
                      }
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                  <div>
                    <FieldLabel>Release Year</FieldLabel>
                    <TextInput
                      value={selectedEdit.releaseYear}
                      onChange={(event) => updateSelectedEdit({ releaseYear: event.target.value })}
                    />
                  </div>
                  {selectedEdit.contentType === 'series' && (
                    <div className="lg:col-span-2 rounded-[26px] border border-sky-300/15 bg-black/20 p-4">
                      <FieldLabel>Series Season & Episode Panel</FieldLabel>
                      <p className="mb-4 mt-1 text-sm leading-6 text-white/55">
                        This request worker job attaches the processed video to the exact season and
                        episode below. Additional episodes can be queued as separate request jobs
                        without touching the main Telegram production worker.
                      </p>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <FieldLabel>Season Number</FieldLabel>
                          <TextInput
                            type="number"
                            min="1"
                            value={selectedEdit.seasonNumber}
                            onChange={(event) => updateSelectedEdit({ seasonNumber: event.target.value })}
                          />
                        </div>
                        <div>
                          <FieldLabel>Episode Number</FieldLabel>
                          <TextInput
                            type="number"
                            min="1"
                            value={selectedEdit.episodeNumber}
                            onChange={(event) => updateSelectedEdit({ episodeNumber: event.target.value })}
                          />
                        </div>
                        <div>
                          <FieldLabel>Season Title</FieldLabel>
                          <TextInput
                            value={selectedEdit.seasonTitle}
                            onChange={(event) => updateSelectedEdit({ seasonTitle: event.target.value })}
                          />
                        </div>
                        <div>
                          <FieldLabel>Episode Title</FieldLabel>
                          <TextInput
                            value={selectedEdit.episodeTitle}
                            onChange={(event) => updateSelectedEdit({ episodeTitle: event.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="lg:col-span-2">
                    <FieldLabel>Browse Categories</FieldLabel>
                    <CategoryChecklist
                      categories={categories}
                      selected={selectedEdit.category}
                      onToggle={toggleCategory}
                      className="grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-[30px] border border-sky-300/15 bg-sky-400/[0.05] p-5">
                <FieldLabel>Paste Telegram Worker Generated Link / Raw Video Link</FieldLabel>
                <p className="mt-1 text-sm leading-6 text-white/58">
                  Forward the movie file to the request Telegram bot on the 6-vCPU VPS. When the bot
                  replies with the finished R2 MP4 link, paste that link here and publish the matched
                  metadata.
                </p>
                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px]">
                  <TextInput
                    value={selectedEdit.sourceUrl}
                    onChange={(event) =>
                      updateSelectedEdit({
                        sourceUrl: event.target.value,
                      })
                    }
                    placeholder="https://media.ugmovies247.com/requested/.../video.mp4"
                  />
                  <TextInput
                    value={selectedEdit.sourceFileName}
                    onChange={(event) => updateSelectedEdit({ sourceFileName: event.target.value })}
                    placeholder="Optional file name..."
                  />
                </div>
                <button
                  type="button"
                  disabled={actionBusy || !selectedEdit.sourceUrl.trim()}
                  onClick={() => onRequestAction(selectedRequest.id, 'fulfill')}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-sky-500 px-5 py-4 text-xs font-black uppercase tracking-[0.2em] text-white shadow-[0_16px_36px_rgba(14,165,233,0.22)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <UploadCloud size={16} />
                  Initiate Processing Queue
                </button>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[30px] border border-amber-300/15 bg-amber-400/[0.06] p-5">
                  <FieldLabel>Scenario 2: VJ Variance</FieldLabel>
                  <SelectInput
                    className="mb-3"
                    defaultValue=""
                    onChange={(event) => {
                      const value = event.target.value;

                      if (!value) {
                        return;
                      }

                      updateSelectedEdit({ customReply: value });
                    }}
                  >
                    <option value="">Choose a VJ variance preset...</option>
                    <option value="We don't have the VJ Emmy version, but we are uploading the VJ Junior version for you now!">
                      VJ Emmy requested, VJ Junior available
                    </option>
                    <option value="We don't have the VJ Junior version, but we are uploading the VJ Emmy version for you now!">
                      VJ Junior requested, VJ Emmy available
                    </option>
                    <option value="We found a different translation version for your request and it is being uploaded now.">
                      Other translation version available
                    </option>
                  </SelectInput>
                  <TextArea
                    rows={4}
                    value={selectedEdit.customReply}
                    onChange={(event) => updateSelectedEdit({ customReply: event.target.value })}
                    placeholder="Example: We don't have the VJ Emmy version, but we are uploading the VJ Junior version for you now!"
                  />
                  <button
                    type="button"
                    disabled={actionBusy || !selectedEdit.customReply.trim()}
                    onClick={() => onRequestAction(selectedRequest.id, 'vjVariance')}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-amber-500 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-black disabled:opacity-50"
                  >
                    <MessageSquareText size={14} />
                    Send VJ Variance
                  </button>
                </div>
                <div className="rounded-[30px] border border-red-300/15 bg-red-500/[0.06] p-5">
                  <FieldLabel>Scenario 1: Reject / Unavailable</FieldLabel>
                  <TextArea
                    rows={4}
                    value={selectedEdit.rejectionMessage}
                    onChange={(event) => updateSelectedEdit({ rejectionMessage: event.target.value })}
                    placeholder="Optional polite unavailable message..."
                  />
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => onRequestAction(selectedRequest.id, 'reject')}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#D90429] px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-50"
                  >
                    <XCircle size={14} />
                    Reject & Notify
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {activeConsoleTab === 'monitor' && (
        <div className="space-y-4">
          {workerError && (
            <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              {workerError}
            </div>
          )}
          {workerJobs.map((job) => (
            <article
              key={job.id}
              className="rounded-[28px] border border-white/10 bg-[#0C1017] p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-lg font-black text-white">{job.title}</h3>
                    <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusClassName(job.status)}`}>
                      {job.status}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-white/55">{job.currentStage || 'Waiting for worker heartbeat'}</div>
                  <div className="mt-2 text-xs text-white/38">
                    User: {job.userEmail || 'Unknown'} | Movie ID: {job.movieId || 'pending'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black text-white">{Math.round(job.progress || 0)}%</div>
                  <div className="mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                    {formatDate(job.updatedAt)}
                  </div>
                </div>
              </div>
              <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#D90429] via-red-400 to-sky-400 transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }}
                />
              </div>
              {job.errorMessage && (
                <div className="mt-4 rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {job.errorMessage}
                </div>
              )}
              {job.publicVideoUrl && (
                <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-xs text-emerald-100">
                  Telegram worker link ready: {job.publicVideoUrl}
                </div>
              )}
            </article>
          ))}

          {!workerJobs.length && (
            <div className="rounded-3xl border border-white/10 bg-black/20 p-8 text-center text-sm text-white/55">
              No request worker jobs yet. Once an admin queues a request, the secondary VPS progress will appear here.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
