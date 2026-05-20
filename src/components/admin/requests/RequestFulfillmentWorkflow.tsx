'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  Film,
  Gauge,
  ImagePlus,
  Loader2,
  PlayCircle,
  Save,
  Search,
  Tv,
  UploadCloud,
} from 'lucide-react';
import type { AdminCategory, AdminRequest, RequestProcessingJob } from '@/types/admin';
import { parseApiResponse, uploadPosterToAdmin } from '@/lib/admin/directUploadClient';
import { CategoryChecklist } from '@/components/admin/controlCenterEditors';
import { Card, FieldLabel, TextArea, TextInput } from '@/components/admin/controlCenterFields';

type RequestDraft = {
  contentType: 'movie' | 'series';
  movieId: string;
  title: string;
  originalTitle: string;
  description: string;
  genres: string;
  categories: string[];
  vj: string;
  releaseDate: string;
  releaseYear: string;
  tmdbId: string;
  nativeBackdrop: string;
  nativePoster: string;
  overridePoster: string;
  overrideBackdrop: string;
  seasonNumber: string;
  seasonTitle: string;
  episodeNumber: string;
  episodeTitle: string;
  episodeDescription: string;
  episodeOverrideBackdrop: string;
  sourceUrl: string;
  sourceFileName: string;
  adminNotes: string;
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

type TmdbSeasonEpisode = {
  episode_number?: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
};

type TmdbSeasonDetails = {
  episodes?: TmdbSeasonEpisode[];
};

const REQUEST_DRAFT_STORAGE_PREFIX = 'ugmovies247.requestUploaderDraft.v1.';

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function splitCommaList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildTmdbImageUrl(path?: string | null, size = 'w1280') {
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

function getYearFromDate(value: string) {
  const match = value.match(/^(\d{4})/);
  return match ? match[1] : '';
}

function isGenericEpisodeTitle(value: string, episodeNumber: number) {
  const normalized = value.trim().toLowerCase();

  return !normalized || normalized === `episode ${episodeNumber}` || /^episode\s+\d+$/i.test(value);
}

function safeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function createStableRequestMovieId(requestId: string, title: string) {
  return `request-${safeSlug(title) || 'title'}-${requestId.slice(0, 10)}`;
}

function getRequestType(request: AdminRequest | null | undefined): 'movie' | 'series' {
  return request?.requestType === 'series' || request?.contentType === 'series' ? 'series' : 'movie';
}

function getRequestTypeLabel(request: AdminRequest | null | undefined) {
  return getRequestType(request) === 'series' ? 'series' : 'movie';
}

function getRequester(request: AdminRequest) {
  return request.userEmail || request.requesterEmail || request.requesterName || 'Unknown user';
}

function statusClassName(status: string) {
  if (status === 'uploaded') return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100';
  if (status === 'rejected' || status === 'closed') return 'border-red-300/25 bg-red-500/10 text-red-100';
  if (status === 'processing') return 'border-sky-300/25 bg-sky-400/10 text-sky-100';
  return 'border-white/10 bg-white/5 text-white/70';
}

function buildDraftFromRequest(request: AdminRequest): RequestDraft {
  const contentType = getRequestType(request);
  const title = request.title || request.movieTitle || '';
  const seasonNumber = request.seasonNumber ? String(request.seasonNumber) : '1';
  const episodeNumber = request.episodeNumber ? String(request.episodeNumber) : '1';

  return {
    contentType,
    movieId: request.movieId || '',
    title,
    originalTitle: request.originalTitle || title,
    description: request.description || request.overview || request.notes || '',
    genres: (request.genres || []).join(', '),
    categories: request.category || [],
    vj: request.preferredVj || '',
    releaseDate: request.releaseDate || '',
    releaseYear: request.releaseYear ? String(request.releaseYear) : '',
    tmdbId: request.tmdbId ? String(request.tmdbId) : '',
    nativeBackdrop: request.backdrop || request.banner || request.poster || '',
    nativePoster: request.poster || '',
    overridePoster: '',
    overrideBackdrop: request.overriddenBackdrop || '',
    seasonNumber,
    seasonTitle: request.seasonTitle || `Season ${seasonNumber}`,
    episodeNumber,
    episodeTitle: request.episodeTitle || `Episode ${episodeNumber}`,
    episodeDescription: request.description || request.overview || request.notes || '',
    episodeOverrideBackdrop: '',
    sourceUrl: request.sourceUrl || '',
    sourceFileName: request.sourceFileName || '',
    adminNotes: request.adminNotes || '',
  };
}

function storageKey(requestId: string) {
  return `${REQUEST_DRAFT_STORAGE_PREFIX}${requestId}`;
}

function readStoredDraft(requestId: string) {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(storageKey(requestId));
    return raw ? (JSON.parse(raw) as Partial<RequestDraft>) : null;
  } catch {
    return null;
  }
}

function writeStoredDraft(requestId: string, draft: RequestDraft) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(storageKey(requestId), JSON.stringify(draft));
  } catch {
    // Draft persistence is a convenience; the workflow can continue in-memory.
  }
}

function mergeDraft(request: AdminRequest, stored: Partial<RequestDraft> | null): RequestDraft {
  return {
    ...buildDraftFromRequest(request),
    ...(stored || {}),
    contentType: getRequestType(request),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }

  return payload;
}

async function loadRequests() {
  const payload = await fetchJson<{ requests?: AdminRequest[] }>('/api/admin/requests');
  return payload.requests || [];
}

async function loadCategories() {
  const payload = await fetchJson<{ categories?: AdminCategory[] }>('/api/admin/categories');
  return payload.categories || [];
}

async function loadRequestJobs() {
  const payload = await fetchJson<{ jobs?: RequestProcessingJob[] }>('/api/admin/request-jobs');
  return payload.jobs || [];
}

async function loadRequest(requestId: string) {
  const requests = await loadRequests();
  const request = requests.find((entry) => entry.id === requestId);

  if (!request) {
    throw new Error('Request not found.');
  }

  return request;
}

function getImageDimensions(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('That image could not be inspected.'));
    };
    image.src = objectUrl;
  });
}

async function assertLandscape(file: File) {
  const dimensions = await getImageDimensions(file);

  if (dimensions.width <= dimensions.height) {
    throw new Error('Please choose a landscape backdrop. Portrait and square images are blocked.');
  }

  if (dimensions.width / dimensions.height < 1.45) {
    throw new Error('Please choose a wider horizontal backdrop.');
  }
}

async function uploadLandscapeFile(file: File | null) {
  if (!file) return '';

  await assertLandscape(file);
  const uploaded = await uploadPosterToAdmin(file);
  return uploaded.publicUrl;
}

function RequestShell({
  title,
  eyebrow = 'Requests Uploader',
  subtitle,
  backHref = '/admin/requests',
  action,
  children,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  backHref?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-svh bg-[#0B0C10] px-3 pb-24 pt-4 text-white min-[390px]:px-4 md:px-8 md:pt-7">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-white/10 bg-[#11141C] p-4 shadow-[0_20px_55px_rgba(0,0,0,0.35)] md:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href={backHref}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
                aria-label="Go back"
              >
                <ArrowLeft size={20} />
              </Link>
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#D90429]">
                  {eyebrow}
                </div>
                <h1 className="mt-1 truncate text-2xl font-black uppercase tracking-[0.1em] text-white md:text-4xl">
                  {title}
                </h1>
              </div>
            </div>
            {action}
          </div>
          {subtitle ? <p className="mt-4 text-sm leading-6 text-white/62">{subtitle}</p> : null}
        </header>
        {children}
      </div>
    </main>
  );
}

function StatusMessage({ message, tone }: { message: string; tone: 'success' | 'error' }) {
  if (!message) return null;

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm font-semibold leading-6 ${
        tone === 'success'
          ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
          : 'border-amber-300/20 bg-amber-400/10 text-amber-100'
      }`}
    >
      {message}
    </div>
  );
}

function LoadingCard() {
  return (
    <Card title="Loading" description="Fetching request data.">
      <div className="flex items-center gap-2 text-sm font-semibold text-white/60">
        <Loader2 size={16} className="animate-spin" />
        Loading...
      </div>
    </Card>
  );
}

function LandscapeBackdropInput({
  label,
  value,
  fallbackPreview,
  file,
  onFileChange,
}: {
  label: string;
  value: string;
  fallbackPreview?: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const preview = previewUrl || value || fallbackPreview || '';

  const handleFileChange = async (input: HTMLInputElement) => {
    const nextFile = input.files?.[0] || null;
    setError('');

    if (!nextFile) {
      onFileChange(null);
      return;
    }

    try {
      await assertLandscape(nextFile);
      onFileChange(nextFile);
    } catch (validationError) {
      input.value = '';
      onFileChange(null);
      setError(validationError instanceof Error ? validationError.message : 'Please choose a landscape image.');
    }
  };

  return (
    <div className="space-y-3">
      <FieldLabel>{label}</FieldLabel>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
        <div className="relative aspect-video bg-[#080B11]">
          {preview ? (
            <img src={preview} alt={label} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-5 text-center text-sm font-semibold text-white/40">
              Landscape backdrop preview
            </div>
          )}
        </div>
      </div>
      <div className="rounded-2xl border border-dashed border-white/15 bg-[#0C1017] p-3">
        <div className="relative min-h-14 overflow-hidden rounded-2xl bg-[#D90429] shadow-[0_12px_26px_rgba(217,4,41,0.22)]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.18em] text-white">
            <ImagePlus size={17} />
            Choose Backdrop
          </div>
          <input
            type="file"
            accept="image/*"
            aria-label={label}
            onChange={(event) => {
              const input = event.target as HTMLInputElement;
              void handleFileChange(input);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-[0.01]"
            style={{ fontSize: 96, WebkitAppearance: 'none' }}
          />
        </div>
        <div className="mt-2 break-words text-center text-xs font-semibold text-white/55">
          {file ? file.name : 'No file selected'}
        </div>
      </div>
      {error ? <div className="text-sm font-semibold text-amber-100">{error}</div> : null}
    </div>
  );
}

function CatalogPosterInput({
  value,
  fallbackPreview,
  file,
  onFileChange,
}: {
  value: string;
  fallbackPreview?: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const preview = previewUrl || value || fallbackPreview || '';

  return (
    <div className="space-y-3">
      <FieldLabel>Override Catalog Poster</FieldLabel>
      <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[180px] overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <div className="relative aspect-[2/3] bg-[#080B11]">
            {preview ? (
              <img src={preview} alt="Catalog poster preview" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs font-semibold text-white/40">
                Poster preview
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col justify-center gap-3">
          <input
            type="file"
            accept="image/*"
            onChange={(event) => onFileChange(event.target.files?.[0] || null)}
            className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0C1017] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
          />
          <p className="text-xs leading-5 text-white/45">
            This poster is used in catalog grids and search cards. Player backdrops stay separate.
          </p>
          <div className="break-words text-xs font-semibold text-white/55">
            {file ? file.name : 'No file selected'}
          </div>
        </div>
      </div>
    </div>
  );
}

function TmdbLookup({
  mediaType,
  draft,
  setDraft,
}: {
  mediaType: 'movie' | 'tv';
  draft: RequestDraft;
  setDraft: (updater: (current: RequestDraft) => RequestDraft) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSearch = async () => {
    const searchTerm = query.trim() || draft.title.trim();

    if (!searchTerm) {
      setMessage('Enter a title before searching TMDb.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const payload = await fetchJson<TmdbResult[]>(
        `/api/admin/tmdb?mediaType=${mediaType}&title=${encodeURIComponent(searchTerm)}`
      );
      setResults(Array.isArray(payload) ? payload : []);
      setMessage(Array.isArray(payload) && payload.length ? '' : 'No TMDb results matched that title.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'TMDb search failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePick = async (result: TmdbResult) => {
    setLoading(true);
    setMessage('');

    try {
      const details = await fetchJson<TmdbDetails>(
        `/api/admin/tmdb?mediaType=${mediaType}&tmdbId=${encodeURIComponent(String(result.id))}`
      );
      const releaseDate = getTmdbDate(details) || getTmdbDate(result);
      const backdrop = buildTmdbImageUrl(details.backdrop_path || result.backdrop_path);
      const poster = buildTmdbImageUrl(details.poster_path || result.poster_path, 'w780');

      setDraft((current) => ({
        ...current,
        title: getTmdbTitle(details) || getTmdbTitle(result) || current.title,
        originalTitle: getTmdbOriginalTitle(details) || getTmdbOriginalTitle(result) || current.originalTitle,
        description: details.overview || result.overview || current.description,
        episodeDescription: current.episodeDescription || details.overview || result.overview || '',
        genres: details.genres?.map((genre) => genre.name).filter(Boolean).join(', ') || current.genres,
        releaseDate,
        releaseYear: getYearFromDate(releaseDate) || current.releaseYear,
        tmdbId: String(details.id || result.id),
        nativeBackdrop: backdrop || current.nativeBackdrop,
        nativePoster: poster || current.nativePoster,
      }));
      setQuery(getTmdbTitle(details) || getTmdbTitle(result));
      setResults([]);
      setMessage('TMDb metadata applied. Manual backdrop override remains optional.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to apply TMDb details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="TMDb Metadata"
      description="Search first, choose the correct match, then override only the landscape backdrop if needed."
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/38" size={18} />
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={draft.title || 'Search TMDb by title'}
            className="pl-12"
          />
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void handleSearch()}
          className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10 disabled:opacity-55"
        >
          {loading ? 'Searching...' : 'Search TMDb'}
        </button>
      </div>

      {message ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-white/70">
          {message}
        </div>
      ) : null}

      {results.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {results.slice(0, 8).map((result) => {
            const image = buildTmdbImageUrl(result.backdrop_path) || buildTmdbImageUrl(result.poster_path, 'w500');

            return (
              <button
                key={result.id}
                type="button"
                onClick={() => void handlePick(result)}
                className="overflow-hidden rounded-2xl border border-white/10 bg-[#0C1017] text-left transition-colors hover:border-[#D90429]/45"
              >
                <div className="relative aspect-video bg-black/30">
                  {image ? (
                    <img src={image} alt={getTmdbTitle(result)} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-white/35">
                      No backdrop
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <div className="line-clamp-2 text-sm font-black text-white">{getTmdbTitle(result)}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
                      {getTmdbDate(result)?.slice(0, 4) || 'No year'}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}

function MetadataFields({
  draft,
  categories,
  setDraft,
  includeEpisodeDescription = false,
}: {
  draft: RequestDraft;
  categories: AdminCategory[];
  setDraft: (updater: (current: RequestDraft) => RequestDraft) => void;
  includeEpisodeDescription?: boolean;
}) {
  const toggleCategory = (name: string) => {
    setDraft((current) => ({
      ...current,
      categories: current.categories.includes(name)
        ? current.categories.filter((entry) => entry !== name)
        : [...current.categories, name],
    }));
  };

  return (
    <Card title="Metadata" description="Keep this focused. The request worker uses this data when it builds the catalog entry.">
      <div className="grid gap-4">
        <div>
          <FieldLabel>Title</FieldLabel>
          <TextInput
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            placeholder="Requested title"
          />
        </div>
        <div>
          <FieldLabel>Description</FieldLabel>
          <TextArea
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            rows={4}
            placeholder="Movie or series description"
          />
        </div>
        {includeEpisodeDescription ? (
          <div>
            <FieldLabel>Episode Description</FieldLabel>
            <TextArea
              value={draft.episodeDescription}
              onChange={(event) => setDraft((current) => ({ ...current, episodeDescription: event.target.value }))}
              rows={3}
              placeholder="Optional episode-specific description"
            />
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <FieldLabel>Genres</FieldLabel>
            <TextInput
              value={draft.genres}
              onChange={(event) => setDraft((current) => ({ ...current, genres: event.target.value }))}
              placeholder="Action, Drama, Thriller"
            />
          </div>
          <div>
            <FieldLabel>VJ / Translation</FieldLabel>
            <TextInput
              value={draft.vj}
              onChange={(event) => setDraft((current) => ({ ...current, vj: event.target.value }))}
              placeholder="VJ Emmy, VJ Junior..."
            />
          </div>
          <div>
            <FieldLabel>Release Date</FieldLabel>
            <TextInput
              value={draft.releaseDate}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  releaseDate: event.target.value,
                  releaseYear: getYearFromDate(event.target.value) || current.releaseYear,
                }))
              }
              placeholder="YYYY-MM-DD"
            />
          </div>
          <div>
            <FieldLabel>Release Year</FieldLabel>
            <TextInput
              value={draft.releaseYear}
              onChange={(event) => setDraft((current) => ({ ...current, releaseYear: event.target.value }))}
              placeholder="2026"
            />
          </div>
        </div>
        <div>
          <FieldLabel>Browse Categories</FieldLabel>
          <CategoryChecklist
            categories={categories}
            selected={draft.categories}
            onToggle={toggleCategory}
            className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
          />
        </div>
      </div>
    </Card>
  );
}

async function patchRequestMovieId(
  requestId: string,
  draft: RequestDraft,
  movieId: string,
  status: AdminRequest['status']
) {
  const response = await fetch('/api/admin/requests', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: requestId,
      status,
      adminNotes: draft.adminNotes,
      movieId,
    }),
  });
  const result = await parseApiResponse(response);

  if (!result.ok) {
    throw new Error(result.payload.error || 'Failed to reserve request movie ID.');
  }
}

async function queueRequestFulfillment(requestId: string, draft: RequestDraft, options?: { movieId?: string }) {
  const response = await fetch('/api/admin/requests', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: requestId,
      action: 'fulfill',
      sourceUrl: draft.sourceUrl,
      sourceFileName: draft.sourceFileName,
      adminNotes: draft.adminNotes,
      title: draft.title,
      originalTitle: draft.originalTitle,
      description: draft.description,
      episodeDescription:
        draft.contentType === 'series' ? draft.episodeDescription : '',
      overview: draft.description,
      poster:
        draft.contentType === 'series'
          ? draft.episodeOverrideBackdrop || draft.overrideBackdrop || draft.nativeBackdrop || draft.nativePoster
          : draft.overridePoster || draft.nativePoster || draft.overrideBackdrop || draft.nativeBackdrop,
      backdrop: draft.overrideBackdrop || draft.nativeBackdrop,
      banner: draft.overrideBackdrop || draft.nativeBackdrop,
      overriddenBackdrop: draft.contentType === 'series' ? draft.overrideBackdrop : '',
      episodeOverriddenBackdrop:
        draft.contentType === 'series' ? draft.episodeOverrideBackdrop : '',
      genres: splitCommaList(draft.genres),
      category: draft.categories,
      vj: draft.vj,
      releaseDate: draft.releaseDate,
      releaseYear: draft.releaseYear,
      tmdbId: draft.tmdbId,
      contentType: draft.contentType,
      seasonNumber: draft.seasonNumber,
      episodeNumber: draft.episodeNumber,
      seasonTitle: draft.seasonTitle,
      episodeTitle: draft.episodeTitle,
      movieId: options?.movieId || draft.movieId,
    }),
  });
  const result = await parseApiResponse(response);

  if (!result.ok) {
    throw new Error(result.payload.error || 'Failed to queue request.');
  }

  return result.payload as { movieId?: string; processingJobId?: string };
}

async function patchPlayerBackdrop(movieId: string, playerBackdrop: string) {
  const response = await fetch(`/api/admin/movies/${encodeURIComponent(movieId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      overriddenPlayerBackdrop: playerBackdrop,
    }),
  });
  const result = await parseApiResponse(response);

  if (!result.ok) {
    throw new Error(result.payload.error || 'Failed to save player backdrop override.');
  }
}

function formatJobProgress(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 0;
}

type DisplayQueueStage =
  | 'queued'
  | 'downloading'
  | 'inspecting'
  | 'processing'
  | 'uploading'
  | 'ready'
  | 'failed';

const QUEUE_STAGES: Array<{ id: DisplayQueueStage; label: string }> = [
  { id: 'queued', label: 'Queued' },
  { id: 'downloading', label: 'Downloading' },
  { id: 'inspecting', label: 'Inspecting' },
  { id: 'processing', label: 'Processing' },
  { id: 'uploading', label: 'Uploading' },
  { id: 'ready', label: 'Ready' },
  { id: 'failed', label: 'Failed' },
];

function getDisplayJobStage(job: RequestProcessingJob): DisplayQueueStage {
  if (job.status === 'uploaded' || job.status === 'ready') return 'ready';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'inspecting') return 'inspecting';
  if (job.status === 'processing') return 'processing';
  if (job.status === 'uploading') return 'uploading';
  if (job.status === 'downloading') return 'downloading';
  return 'queued';
}

function isActiveJob(job: RequestProcessingJob) {
  return ['claimed', 'downloading', 'inspecting', 'processing', 'uploading'].includes(job.status);
}

function useLiveRequestJobs() {
  const [jobs, setJobs] = useState<RequestProcessingJob[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const nextJobs = await loadRequestJobs();

        if (active) {
          setJobs(nextJobs);
          setErrorMessage('');
        }
      } catch (error) {
        if (active) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Failed to load live request processing queue.'
          );
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return { jobs, errorMessage };
}

async function patchRequestAction(body: Record<string, unknown>) {
  const response = await fetch('/api/admin/requests', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await parseApiResponse(response);

  if (!result.ok) {
    throw new Error(result.payload.error || 'Request action failed.');
  }
}

function RequestProcessingQueuePanel({
  jobs,
  errorMessage,
}: {
  jobs: RequestProcessingJob[];
  errorMessage: string;
}) {
  const groupedJobs = QUEUE_STAGES.map((stage) => ({
    ...stage,
    jobs: jobs.filter((job) => getDisplayJobStage(job) === stage.id),
  }));
  const activeCount = jobs.filter(isActiveJob).length;

  const renderJob = (job: RequestProcessingJob) => {
    const progress = formatJobProgress(job.progress);
    const stage = getDisplayJobStage(job);
    const currentStageIndex = QUEUE_STAGES.findIndex((entry) => entry.id === stage);
    const stageLabel = QUEUE_STAGES[currentStageIndex]?.label || 'Queued';

    return (
      <div key={job.id} className="rounded-2xl border border-white/10 bg-[#0C1017] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="line-clamp-2 text-sm font-black text-white">{job.title || 'Untitled request job'}</div>
            <div className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/42">
              {job.contentType || 'movie'} / {stageLabel}
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black text-white/70">
            {progress}%
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[#D90429]" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1">
          {QUEUE_STAGES.map((entry, index) => {
            const isComplete = stage !== 'failed' && index < currentStageIndex;
            const isCurrent = entry.id === stage;

            return (
              <div key={entry.id} className="space-y-1">
                <div
                  className={`h-1.5 rounded-full ${
                    isCurrent
                      ? entry.id === 'failed'
                        ? 'bg-red-400'
                        : 'bg-[#D90429]'
                      : isComplete
                        ? 'bg-white/45'
                        : 'bg-white/10'
                  }`}
                />
                <div className="hidden truncate text-[8px] font-black uppercase tracking-[0.12em] text-white/38 min-[480px]:block">
                  {entry.label}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 line-clamp-2 text-xs leading-5 text-white/55">
          {job.currentStage || job.errorMessage || 'Waiting for worker update'}
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Live Processing Queue"
      description="Live request worker status across queued, downloading, inspecting, processing, uploading, ready, and failed stages."
    >
      <StatusMessage message={errorMessage} tone="error" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {QUEUE_STAGES.map((stage) => {
          const count = groupedJobs.find((entry) => entry.id === stage.id)?.jobs.length || 0;

          return (
            <div key={stage.id} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/45">
                {stage.label}
              </div>
              <div className="mt-1 text-xl font-black text-white">{count}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-semibold text-white/55">
        {activeCount} request job{activeCount === 1 ? '' : 's'} currently moving through the worker.
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {groupedJobs.map((stage) => (
          <section key={stage.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white/70">{stage.label}</h3>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black text-white/55">
                {stage.jobs.length}
              </span>
            </div>
            {stage.jobs.length ? (
              stage.jobs.slice(0, 8).map(renderJob)
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/45">
                No {stage.label.toLowerCase()} request jobs right now.
              </div>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}

function RequestQuickActions({
  request,
  onComplete,
}: {
  request: AdminRequest;
  onComplete: () => void;
}) {
  const [alternativeVj, setAlternativeVj] = useState('');
  const [busyAction, setBusyAction] = useState<'vj' | 'unavailable' | ''>('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const title = request.title || request.movieTitle || 'this title';
  const requestType = getRequestTypeLabel(request);

  const sendAlternativeVj = async () => {
    const cleanVj = alternativeVj.trim();

    if (!cleanVj) {
      setErrorMessage('Enter the VJ version you are processing before notifying the user.');
      return;
    }

    setBusyAction('vj');
    setErrorMessage('');
    setMessage('');

    try {
      await patchRequestAction({
        id: request.id,
        action: 'vjVariance',
        message: `We currently do not have "${title}" by your requested VJ${
          request.preferredVj ? ` (${request.preferredVj})` : ''
        }, but we are processing it via ${cleanVj} for you.`,
      });
      setMessage('Alternative VJ notification sent.');
      onComplete();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send VJ option notification.');
    } finally {
      setBusyAction('');
    }
  };

  const markUnavailable = async () => {
    setBusyAction('unavailable');
    setErrorMessage('');
    setMessage('');

    try {
      await patchRequestAction({
        id: request.id,
        action: 'reject',
        message: `Sorry, "${title}" is not available right now. We could not find a safe playable copy of this ${requestType}. Please submit a brand new request and our team will review it again.`,
      });
      setMessage('Unavailable notification sent and request cleared.');
      onComplete();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to mark request unavailable.');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <TextInput
          value={alternativeVj}
          onChange={(event) => setAlternativeVj(event.target.value)}
          placeholder="Available VJ, e.g. VJ Ice P"
          className="text-xs"
        />
        <button
          type="button"
          disabled={busyAction !== ''}
          onClick={() => void sendAlternativeVj()}
          className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 disabled:opacity-55"
        >
          {busyAction === 'vj' ? 'Sending...' : 'Notify VJ Option'}
        </button>
      </div>
      <button
        type="button"
        disabled={busyAction !== ''}
        onClick={() => void markUnavailable()}
        className="mt-2 w-full rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-red-100 disabled:opacity-55"
      >
        {busyAction === 'unavailable' ? 'Sending...' : 'Mark Unavailable'}
      </button>
      {message ? <div className="mt-3 text-xs font-semibold text-emerald-100">{message}</div> : null}
      {errorMessage ? <div className="mt-3 text-xs font-semibold text-amber-100">{errorMessage}</div> : null}
    </div>
  );
}

function useRequestDraft(requestId: string) {
  const [request, setRequest] = useState<AdminRequest | null>(null);
  const [draft, setDraftState] = useState<RequestDraft | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;

    Promise.all([loadRequest(requestId), loadCategories().catch(() => [])])
      .then(([nextRequest, nextCategories]) => {
        if (!active) return;
        const nextDraft = mergeDraft(nextRequest, readStoredDraft(requestId));
        setRequest(nextRequest);
        setDraftState(nextDraft);
        setCategories(nextCategories);
      })
      .catch((error) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Failed to load request.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [requestId]);

  const setDraft = useCallback(
    (updater: (current: RequestDraft) => RequestDraft) => {
      setDraftState((current) => {
        if (!current) return current;
        const nextDraft = updater(current);
        writeStoredDraft(requestId, nextDraft);
        return nextDraft;
      });
    },
    [requestId]
  );

  return {
    request,
    draft,
    categories,
    loading,
    errorMessage,
    setErrorMessage,
    setDraft,
  };
}

export function AdminRequestsHubView() {
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'movie' | 'series'>('all');

  const refreshRequests = useCallback(async () => {
    const nextRequests = await loadRequests();
    setRequests(nextRequests);
    return nextRequests;
  }, []);

  useEffect(() => {
    let active = true;

    loadRequests()
      .then((nextRequests) => {
        if (active) setRequests(nextRequests);
      })
      .catch((error) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Failed to load requests.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const activeRequests = useMemo(
    () =>
      requests.filter(
        (request) => !['uploaded', 'rejected', 'closed'].includes(String(request.status || '').toLowerCase())
      ),
    [requests]
  );
  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase();

    return activeRequests.filter((request) => {
      const type = getRequestType(request);

      if (filter !== 'all' && type !== filter) return false;
      if (!query) return true;

      return `${request.title} ${request.movieTitle || ''} ${getRequester(request)} ${request.preferredVj || ''} ${
        request.notes || ''
      }`
        .toLowerCase()
        .includes(query);
    });
  }, [activeRequests, filter, search]);

  return (
    <main className="min-h-svh bg-[#0B0C10] px-3 pb-24 pt-4 text-white min-[390px]:px-4 md:px-8 md:pt-7">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-[28px] border border-white/10 bg-[#11141C] p-4 shadow-[0_20px_55px_rgba(0,0,0,0.35)] md:p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href="/admin"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
                aria-label="Back to admin"
              >
                <ArrowLeft size={20} />
              </Link>
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#D90429]">
                  Requests Uploader
                </div>
                <h1 className="mt-1 text-3xl font-black uppercase tracking-[0.14em] text-white md:text-5xl">
                  Requests
                </h1>
                <p className="mt-3 text-sm leading-6 text-white/62">
                  Pick one user request and complete it from a focused mobile workflow.
                </p>
              </div>
            </div>
            <Link
              href="/admin/requests/queue"
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#D90429]/30 bg-[#D90429]/12 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white transition hover:bg-[#D90429]"
            >
              <Gauge size={15} />
              Processing Queue
            </Link>
          </div>
        </header>

        <StatusMessage message={errorMessage} tone="error" />

        <Card title="Request Hub" description="Search active viewer requests, then open the right fulfillment flow.">
          <div className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/38" size={18} />
              <TextInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by title, requester, VJ, or notes"
                className="pl-12"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['all', 'All'],
                ['movie', 'Movies'],
                ['series', 'Series'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id as 'all' | 'movie' | 'series')}
                  className={`rounded-full px-3 py-3 text-xs font-black uppercase tracking-[0.16em] ${
                    filter === id
                      ? 'bg-[#D90429] text-white'
                      : 'border border-white/10 bg-white/5 text-white/65'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {loading ? <LoadingCard /> : null}

        <div className="grid gap-4 md:grid-cols-2">
          {filteredRequests.map((request) => {
            const type = getRequestType(request);
            const href =
              type === 'series'
                ? `/admin/requests/${request.id}/series/details`
                : `/admin/requests/${request.id}/movie`;

            return (
              <article
                key={request.id}
                className="rounded-[28px] border border-white/10 bg-[#11141C] p-4 shadow-[0_16px_44px_rgba(0,0,0,0.3)] transition hover:border-[#D90429]/45"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#D90429] text-white">
                        {type === 'series' ? <Tv size={17} /> : <Film size={17} />}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/70">
                        {type}
                      </span>
                    </div>
                    <h2 className="mt-4 line-clamp-2 text-xl font-black leading-tight text-white">
                      {request.title || request.movieTitle || 'Untitled request'}
                    </h2>
                    <p className="mt-2 text-xs font-semibold text-white/50">{getRequester(request)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusClassName(request.status)}`}>
                    {request.status}
                  </span>
                </div>
                <p className="mt-4 line-clamp-3 min-h-[66px] text-sm leading-6 text-white/58">
                  {request.notes || request.description || request.overview || 'No requester note was provided.'}
                </p>
                <div className="mt-4 grid gap-2 text-xs text-white/45">
                  <div>Preferred VJ: {request.preferredVj || 'Not specified'}</div>
                  <div>Stage: {request.currentStage || request.workerStatus || 'Waiting'}</div>
                </div>
                <Link
                  href={href}
                  className="mt-5 flex items-center justify-center gap-2 rounded-full bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-[#D90429]"
                >
                  <PlayCircle size={15} />
                  Fulfill Request
                </Link>
                <RequestQuickActions request={request} onComplete={() => void refreshRequests()} />
              </article>
            );
          })}
        </div>

        {!loading && !filteredRequests.length ? (
          <Card title="No Requests" description="No active requests matched this view.">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-white/55">
              Try another filter or search term.
            </div>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

export function AdminRequestQueueView() {
  const { jobs, errorMessage } = useLiveRequestJobs();

  return (
    <RequestShell
      title="Processing Queue"
      subtitle="Track request worker jobs without crowding the request hub."
      action={
        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
          {jobs.length} jobs
        </div>
      }
    >
      <RequestProcessingQueuePanel jobs={jobs} errorMessage={errorMessage} />
    </RequestShell>
  );
}

export function AdminRequestMovieFulfillmentView({ requestId }: { requestId: string }) {
  const router = useRouter();
  const { request, draft, categories, loading, errorMessage, setErrorMessage, setDraft } = useRequestDraft(requestId);
  const [statusMessage, setStatusMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [catalogPosterFile, setCatalogPosterFile] = useState<File | null>(null);
  const [playerBackdropFile, setPlayerBackdropFile] = useState<File | null>(null);

  const handleQueue = async () => {
    if (!request || !draft) return;

    if (!draft.title.trim()) {
      setErrorMessage('Title is required.');
      return;
    }

    if (!draft.sourceUrl.trim()) {
      setErrorMessage('Paste the video stream URL before queuing this request.');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const catalogPoster = catalogPosterFile
        ? (await uploadPosterToAdmin(catalogPosterFile)).publicUrl
        : '';
      const playerBackdrop = await uploadLandscapeFile(playerBackdropFile);
      const nextDraft = {
        ...draft,
        overridePoster: catalogPoster || draft.overridePoster,
      };
      const nextMovieId =
        draft.movieId.trim() || request.movieId || createStableRequestMovieId(request.id, draft.title);

      if (playerBackdrop || !request.movieId) {
        await patchRequestMovieId(request.id, nextDraft, nextMovieId, request.status);
      }

      const queued = await queueRequestFulfillment(
        request.id,
        { ...nextDraft, movieId: nextMovieId },
        { movieId: nextMovieId }
      );

      if (playerBackdrop) {
        await patchPlayerBackdrop(nextMovieId, playerBackdrop);
      }

      setStatusMessage('Movie request queued on the request worker.');
      writeStoredDraft(request.id, { ...nextDraft, movieId: queued.movieId || nextMovieId });
      router.push('/admin/requests');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to queue movie request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <RequestShell
      title="Movie Request"
      subtitle={request?.title || 'Fulfill this requested movie.'}
      action={<Film size={22} className="text-[#D90429]" />}
    >
      <StatusMessage message={errorMessage} tone="error" />
      <StatusMessage message={statusMessage} tone="success" />
      {loading || !draft ? (
        <LoadingCard />
      ) : (
        <>
          <TmdbLookup mediaType="movie" draft={draft} setDraft={setDraft} />
          <MetadataFields draft={draft} categories={categories} setDraft={setDraft} />
          <Card
            title="Catalog Poster"
            description="Optional poster used in browse, search, and catalog cards for this requested movie."
          >
            <CatalogPosterInput
              value={draft.overridePoster}
              fallbackPreview={draft.nativePoster}
              file={catalogPosterFile}
              onFileChange={setCatalogPosterFile}
            />
          </Card>
          <Card
            title="Player Backdrop"
            description="Optional landscape image used on the movie player. It does not replace catalog posters."
          >
            <LandscapeBackdropInput
              label="Override Player Backdrop"
              value=""
              fallbackPreview={draft.overrideBackdrop || draft.nativeBackdrop}
              file={playerBackdropFile}
              onFileChange={setPlayerBackdropFile}
            />
          </Card>
          <Card title="Video Stream" description="Paste the finished request worker or direct MP4 link.">
            <div className="grid gap-4">
              <div>
                <FieldLabel>Video Stream URL</FieldLabel>
                <TextInput
                  value={draft.sourceUrl}
                  onChange={(event) => setDraft((current) => ({ ...current, sourceUrl: event.target.value }))}
                  placeholder="https://media.ugmovies247.com/requested/video.mp4"
                />
              </div>
              <div>
                <FieldLabel>Source File Name</FieldLabel>
                <TextInput
                  value={draft.sourceFileName}
                  onChange={(event) => setDraft((current) => ({ ...current, sourceFileName: event.target.value }))}
                  placeholder="Optional file name"
                />
              </div>
            </div>
          </Card>
          <div className="pointer-events-none sticky bottom-4 z-20">
            <button
              type="button"
              onClick={() => void handleQueue()}
              disabled={submitting}
              className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D90429] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-[0_16px_40px_rgba(217,4,41,0.28)] disabled:cursor-not-allowed disabled:opacity-55"
            >
              <UploadCloud size={18} />
              {submitting ? 'Queueing...' : 'Queue Movie Request'}
            </button>
          </div>
        </>
      )}
    </RequestShell>
  );
}

export function AdminRequestSeriesDetailsView({ requestId }: { requestId: string }) {
  const router = useRouter();
  const { request, draft, categories, loading, errorMessage, setErrorMessage, setDraft } = useRequestDraft(requestId);
  const [backdropFile, setBackdropFile] = useState<File | null>(null);

  const handleSaveAndContinue = async () => {
    if (!request || !draft) return;

    if (!draft.title.trim()) {
      setErrorMessage('Series title is required.');
      return;
    }

    setErrorMessage('');

    try {
      const uploadedBackdrop = await uploadLandscapeFile(backdropFile);
      const nextDraft = {
        ...draft,
        overrideBackdrop: uploadedBackdrop || draft.overrideBackdrop,
        contentType: 'series' as const,
      };
      writeStoredDraft(request.id, nextDraft);
      router.push(`/admin/requests/${request.id}/series/seasons`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save series details.');
    }
  };

  return (
    <RequestShell
      title="Series Details"
      subtitle={request?.title || 'Prepare metadata for the requested series episode.'}
      action={<Tv size={22} className="text-[#D90429]" />}
    >
      <StatusMessage message={errorMessage} tone="error" />
      {loading || !draft ? (
        <LoadingCard />
      ) : (
        <>
          <TmdbLookup mediaType="tv" draft={draft} setDraft={setDraft} />
          <MetadataFields draft={draft} categories={categories} setDraft={setDraft} includeEpisodeDescription />
          <Card title="Series Backdrop" description="Landscape only. This image is used as the series/episode preview for this request job.">
            <LandscapeBackdropInput
              label="Series Backdrop Override"
              value={draft.overrideBackdrop}
              fallbackPreview={draft.nativeBackdrop || draft.nativePoster}
              file={backdropFile}
              onFileChange={setBackdropFile}
            />
          </Card>
          <div className="pointer-events-none sticky bottom-4 z-20">
            <button
              type="button"
              onClick={() => void handleSaveAndContinue()}
              className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D90429] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-[0_16px_40px_rgba(217,4,41,0.28)]"
            >
              <Save size={18} />
              Save Details
            </button>
          </div>
        </>
      )}
    </RequestShell>
  );
}

export function AdminRequestSeriesSeasonsView({ requestId }: { requestId: string }) {
  const router = useRouter();
  const { request, draft, loading, errorMessage, setErrorMessage, setDraft } = useRequestDraft(requestId);

  const handleContinue = () => {
    if (!request || !draft) return;

    const seasonNumber = Number(draft.seasonNumber);
    const episodeNumber = Number(draft.episodeNumber);

    if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) {
      setErrorMessage('Choose a valid season number.');
      return;
    }

    if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) {
      setErrorMessage('Choose a valid episode number.');
      return;
    }

    writeStoredDraft(request.id, draft);
    router.push(
      `/admin/requests/${request.id}/series/seasons/${seasonNumber}/episodes/${episodeNumber}`
    );
  };

  const handleAddNewSeason = () => {
    setDraft((current) => {
      const nextSeason = String(Math.max(1, Number(current.seasonNumber) || 1) + 1);
      return {
        ...current,
        seasonNumber: nextSeason,
        seasonTitle: `Season ${nextSeason}`,
        episodeNumber: '1',
        episodeTitle: 'Episode 1',
      };
    });
  };

  const handleAddEpisode = () => {
    setDraft((current) => {
      const nextEpisode = String(Math.max(0, Number(current.episodeNumber) || 0) + 1);

      return {
        ...current,
        episodeNumber: nextEpisode,
        episodeTitle: `Episode ${nextEpisode}`,
        episodeDescription: '',
        episodeOverrideBackdrop: '',
        sourceUrl: '',
        sourceFileName: '',
      };
    });
  };

  return (
    <RequestShell
      title="Season Manager"
      subtitle={request?.title || 'Select the exact season and episode for this request.'}
      backHref={`/admin/requests/${requestId}/series/details`}
    >
      <StatusMessage message={errorMessage} tone="error" />
      {loading || !draft ? (
        <LoadingCard />
      ) : (
        <>
          <Card
            title="Target Episode"
            description="Request backend supports one exact season/episode job at a time."
            action={
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleAddEpisode}
                  className="rounded-full border border-[#D90429]/30 bg-[#D90429]/12 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white"
                >
                  Add Episode
                </button>
                <button
                  type="button"
                  onClick={handleAddNewSeason}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white"
                >
                  Add Season
                </button>
              </div>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <FieldLabel>Season Number</FieldLabel>
                <TextInput
                  type="number"
                  min="1"
                  value={draft.seasonNumber}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      seasonNumber: event.target.value,
                      seasonTitle: current.seasonTitle || `Season ${event.target.value || 1}`,
                    }))
                  }
                />
              </div>
              <div>
                <FieldLabel>Episode Number</FieldLabel>
                <TextInput
                  type="number"
                  min="1"
                  value={draft.episodeNumber}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      episodeNumber: event.target.value,
                      episodeTitle: current.episodeTitle || `Episode ${event.target.value || 1}`,
                    }))
                  }
                />
              </div>
              <div>
                <FieldLabel>Season Title</FieldLabel>
                <TextInput
                  value={draft.seasonTitle}
                  onChange={(event) => setDraft((current) => ({ ...current, seasonTitle: event.target.value }))}
                />
              </div>
              <div>
                <FieldLabel>Episode Title</FieldLabel>
                <TextInput
                  value={draft.episodeTitle}
                  onChange={(event) => setDraft((current) => ({ ...current, episodeTitle: event.target.value }))}
                />
              </div>
            </div>
          </Card>
          <Card title="Preview" description="This is the request episode that will be queued.">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0C1017]">
              <div className="relative aspect-video">
                {draft.episodeOverrideBackdrop || draft.overrideBackdrop || draft.nativeBackdrop || draft.nativePoster ? (
                  <img
                    src={draft.episodeOverrideBackdrop || draft.overrideBackdrop || draft.nativeBackdrop || draft.nativePoster}
                    alt={draft.episodeTitle}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/15 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#D90429]">
                    Season {draft.seasonNumber} / EP {draft.episodeNumber}
                  </div>
                  <div className="mt-1 text-2xl font-black text-white">{draft.episodeTitle}</div>
                </div>
              </div>
            </div>
          </Card>
          <div className="pointer-events-none sticky bottom-4 z-20">
            <button
              type="button"
              onClick={handleContinue}
              className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D90429] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-[0_16px_40px_rgba(217,4,41,0.28)]"
            >
              <PlayCircle size={18} />
              Open Episode Editor
            </button>
          </div>
        </>
      )}
    </RequestShell>
  );
}

export function AdminRequestSeriesEpisodeView({
  requestId,
  seasonNumber,
  episodeNumber,
}: {
  requestId: string;
  seasonNumber: number;
  episodeNumber: number;
}) {
  const router = useRouter();
  const { request, draft, loading, errorMessage, setErrorMessage, setDraft } = useRequestDraft(requestId);
  const [episodeBackdropFile, setEpisodeBackdropFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [loadingTmdbEpisode, setLoadingTmdbEpisode] = useState(false);
  const [tmdbEpisodeMessage, setTmdbEpisodeMessage] = useState('');

  useEffect(() => {
    if (!draft) return;

    setDraft((current) => {
      const nextSeasonNumber = String(seasonNumber || current.seasonNumber || 1);
      const nextEpisodeNumber = String(episodeNumber || current.episodeNumber || 1);
      const nextSeasonTitle = current.seasonTitle || `Season ${nextSeasonNumber}`;
      const nextEpisodeTitle = current.episodeTitle || `Episode ${nextEpisodeNumber}`;

      if (
        current.seasonNumber === nextSeasonNumber &&
        current.episodeNumber === nextEpisodeNumber &&
        current.seasonTitle === nextSeasonTitle &&
        current.episodeTitle === nextEpisodeTitle
      ) {
        return current;
      }

      return {
        ...current,
        seasonNumber: nextSeasonNumber,
        episodeNumber: nextEpisodeNumber,
        seasonTitle: nextSeasonTitle,
        episodeTitle: nextEpisodeTitle,
      };
    });
  }, [
    draft,
    episodeNumber,
    seasonNumber,
    setDraft,
  ]);

  useEffect(() => {
    if (!draft?.tmdbId) {
      setLoadingTmdbEpisode(false);
      setTmdbEpisodeMessage('');
      return undefined;
    }

    const tmdbId = draft.tmdbId;
    const targetSeason = Number(seasonNumber || draft.seasonNumber || 1);
    const targetEpisode = Number(episodeNumber || draft.episodeNumber || 1);

    if (!Number.isFinite(targetSeason) || !Number.isFinite(targetEpisode)) {
      return undefined;
    }

    let active = true;
    setLoadingTmdbEpisode(true);
    setTmdbEpisodeMessage('Loading TMDb episode metadata...');

    fetchJson<TmdbSeasonDetails>(
      `/api/admin/tmdb?mediaType=tv&tmdbId=${encodeURIComponent(tmdbId)}&seasonNumber=${encodeURIComponent(String(targetSeason))}`
    )
      .then((seasonDetails) => {
        if (!active) return;

        const tmdbEpisode = (seasonDetails.episodes || []).find(
          (episode) => Number(episode.episode_number) === targetEpisode
        );

        if (!tmdbEpisode) {
          setTmdbEpisodeMessage('No TMDb metadata found for this exact episode.');
          return;
        }

        const stillBackdrop = buildTmdbImageUrl(tmdbEpisode.still_path);

        setDraft((current) => {
          const currentSeasonNumber = Number(current.seasonNumber || targetSeason);
          const currentEpisodeNumber = Number(current.episodeNumber || targetEpisode);

          if (
            current.tmdbId !== tmdbId ||
            currentSeasonNumber !== targetSeason ||
            currentEpisodeNumber !== targetEpisode
          ) {
            return current;
          }

          const currentEpisodeDescription = current.episodeDescription.trim();
          const seriesDescription = current.description.trim();
          const shouldUseTitle = isGenericEpisodeTitle(current.episodeTitle, targetEpisode);
          const shouldUseDescription =
            !currentEpisodeDescription ||
            Boolean(seriesDescription && currentEpisodeDescription === seriesDescription);

          return {
            ...current,
            episodeTitle: shouldUseTitle && tmdbEpisode.name ? tmdbEpisode.name : current.episodeTitle,
            episodeDescription:
              shouldUseDescription && tmdbEpisode.overview
                ? tmdbEpisode.overview
                : current.episodeDescription,
            episodeOverrideBackdrop: current.episodeOverrideBackdrop || stillBackdrop || '',
          };
        });

        setTmdbEpisodeMessage(
          tmdbEpisode.overview
            ? 'TMDb episode title, description, and still image applied where fields were empty.'
            : 'TMDb found this episode, but it has no description.'
        );
      })
      .catch((error) => {
        if (active) {
          setTmdbEpisodeMessage(error instanceof Error ? error.message : 'Failed to load TMDb episode metadata.');
        }
      })
      .finally(() => {
        if (active) setLoadingTmdbEpisode(false);
      });

    return () => {
      active = false;
    };
  }, [
    draft?.tmdbId,
    draft?.seasonNumber,
    draft?.episodeNumber,
    episodeNumber,
    seasonNumber,
    setDraft,
  ]);

  const handleQueue = async () => {
    if (!request || !draft) return;

    if (!draft.sourceUrl.trim()) {
      setErrorMessage('Paste the episode video stream URL before queuing this request.');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const uploadedEpisodeBackdrop = await uploadLandscapeFile(episodeBackdropFile);
      const nextDraft: RequestDraft = {
        ...draft,
        contentType: 'series',
        seasonNumber: String(seasonNumber || draft.seasonNumber || 1),
        episodeNumber: String(episodeNumber || draft.episodeNumber || 1),
        episodeOverrideBackdrop: uploadedEpisodeBackdrop || draft.episodeOverrideBackdrop,
      };
      const queued = await queueRequestFulfillment(request.id, nextDraft);
      writeStoredDraft(request.id, {
        ...nextDraft,
        movieId: queued.movieId || nextDraft.movieId || request.movieId || '',
        sourceUrl: '',
        sourceFileName: '',
        episodeDescription: '',
        episodeOverrideBackdrop: '',
      });
      setStatusMessage('Series episode request queued on the request worker.');
      router.push(`/admin/requests/${request.id}/series/seasons`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to queue series request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <RequestShell
      title="Episode Editor"
      subtitle={request?.title || `Season ${seasonNumber} Episode ${episodeNumber}`}
      backHref={`/admin/requests/${requestId}/series/seasons`}
    >
      <StatusMessage message={errorMessage} tone="error" />
      <StatusMessage message={statusMessage} tone="success" />
      {loading || !draft ? (
        <LoadingCard />
      ) : (
        <>
          <Card title={`Season ${seasonNumber} / Episode ${episodeNumber}`} description="Edit and queue this one requested episode.">
            <div className="grid gap-4">
              <div>
                <FieldLabel>Episode Title</FieldLabel>
                <TextInput
                  value={draft.episodeTitle}
                  onChange={(event) => setDraft((current) => ({ ...current, episodeTitle: event.target.value }))}
                  placeholder={`Episode ${episodeNumber}`}
                />
              </div>
              <div>
                <FieldLabel>Episode Description</FieldLabel>
                <TextArea
                  rows={4}
                  value={draft.episodeDescription}
                  onChange={(event) => setDraft((current) => ({ ...current, episodeDescription: event.target.value }))}
                  placeholder="Optional episode description"
                />
              </div>
              {draft.tmdbId ? (
                <div className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-semibold leading-5 text-white/58">
                  {loadingTmdbEpisode ? <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin" /> : null}
                  <span>{tmdbEpisodeMessage || 'TMDb episode metadata will be applied when available.'}</span>
                </div>
              ) : null}
              <LandscapeBackdropInput
                label="Episode Backdrop Override"
                value={draft.episodeOverrideBackdrop}
                fallbackPreview={draft.overrideBackdrop || draft.nativeBackdrop || draft.nativePoster}
                file={episodeBackdropFile}
                onFileChange={setEpisodeBackdropFile}
              />
            </div>
          </Card>
          <Card title="Episode Video" description="Paste the exact stream URL for this request episode.">
            <div className="grid gap-4">
              <div>
                <FieldLabel>Video Stream URL</FieldLabel>
                <TextInput
                  value={draft.sourceUrl}
                  onChange={(event) => setDraft((current) => ({ ...current, sourceUrl: event.target.value }))}
                  placeholder="https://media.ugmovies247.com/requested/episode.mp4"
                />
              </div>
              <div>
                <FieldLabel>Source File Name</FieldLabel>
                <TextInput
                  value={draft.sourceFileName}
                  onChange={(event) => setDraft((current) => ({ ...current, sourceFileName: event.target.value }))}
                  placeholder="Optional file name"
                />
              </div>
            </div>
          </Card>
          <div className="pointer-events-none sticky bottom-4 z-20">
            <button
              type="button"
              onClick={() => void handleQueue()}
              disabled={submitting}
              className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D90429] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-[0_16px_40px_rgba(217,4,41,0.28)] disabled:cursor-not-allowed disabled:opacity-55"
            >
              <UploadCloud size={18} />
              {submitting ? 'Queueing...' : 'Queue Episode Request'}
            </button>
          </div>
        </>
      )}
    </RequestShell>
  );
}
