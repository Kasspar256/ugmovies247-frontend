'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  PencilLine,
  Plus,
  Save,
  Search,
  UploadCloud,
} from 'lucide-react';
import type { AdminCategory, AdminLibraryAsset } from '@/types/admin';
import type { Episode, Movie, Season } from '@/types/movie';
import {
  parseApiResponse,
  type MultipartUploadStats,
  isMp4TrailerFile,
  uploadMultipartFileToAdmin,
  uploadPosterToAdmin,
  uploadTrailerVideoToAdmin,
} from '@/lib/admin/directUploadClient';
import { clearAdminFetchCache, fetchAdminJson } from '@/lib/admin/fetchAdminJson';
import { CategoryChecklist, SourceEditor } from '@/components/admin/controlCenterEditors';
import {
  Card,
  FieldLabel,
  TextArea,
  TextInput,
} from '@/components/admin/controlCenterFields';
import type { DraftVideoSource } from '@/components/admin/controlCenterUtils';

const SERIES_CATEGORY_OPTIONS = [
  { name: 'Latest series', label: 'Latest series' },
  { name: 'Ongoing Series', label: 'Ongoing Series' },
  { name: 'VJ JUNIOR SERIES', label: 'VJ JUNIOR SERIES' },
  { name: 'Asian series', label: 'Asian series' },
  { name: 'Western series', label: 'Western series' },
  { name: 'Other vjs', label: 'Other vjs' },
  { name: 'Trending on tiktok', label: 'Tag as Trending on TikTok' },
] as const;

type SeriesFormState = {
  tmdbId: string;
  title: string;
  description: string;
  releaseYear: string;
  language: string;
  vj: string;
  genres: string;
  tags: string;
  categories: string[];
  nativeBackdrop: string;
  overriddenBackdrop: string;
  backdropFile: File | null;
  mainSeriesTrailerUrl: string;
  trailerFile: File | null;
};

type EpisodeFormState = {
  episodeNumber: string;
  title: string;
  description: string;
  source: DraftVideoSource;
  overriddenBackdrop: string;
  backdropFile: File | null;
  episodeTrailerUrl: string;
  trailerFile: File | null;
};

type TmdbTvResult = {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  original_language?: string;
};

type TmdbTvDetails = TmdbTvResult & {
  spoken_languages?: Array<{
    english_name?: string;
    name?: string;
  }>;
  genres?: Array<{
    id: number;
    name: string;
  }>;
  keywords?: {
    results?: Array<{
      id: number;
      name: string;
    }>;
  };
};

function splitCommaList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseReleaseYear(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1800 ? parsed : null;
}

function parseTmdbId(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function createEmptySource(): DraftVideoSource {
  return {
    mode: 'url',
    url: '',
    file: null,
    sourceType: 'remote_link',
  };
}

function buildTmdbImageUrl(path?: string | null, size = 'w1280') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
}

function getTmdbLanguageLabel(details: TmdbTvDetails) {
  const spokenLanguage = details.spoken_languages?.find(
    (language) => language.english_name || language.name
  );

  return spokenLanguage?.english_name || spokenLanguage?.name || details.original_language || '';
}

function getTmdbKeywordList(details: TmdbTvDetails) {
  return (details.keywords?.results || [])
    .map((keyword) => keyword.name)
    .filter(Boolean)
    .slice(0, 10);
}

function getSeriesEpisodeCount(series: Movie) {
  return (series.seasons || []).reduce(
    (total, season) => total + (season.episodes || []).length,
    0
  );
}

function getEffectiveSeriesBackdrop(series: Movie | null | undefined) {
  if (!series) return '';

  const firstSeason = series.seasons?.[0];
  const firstEpisode = firstSeason?.episodes?.[0];
  return (
    series.overriddenBackdrop ||
    series.poster ||
    firstSeason?.poster ||
    firstEpisode?.overriddenBackdrop ||
    firstEpisode?.thumbnail ||
    firstEpisode?.poster ||
    ''
  );
}

function getEffectiveEpisodeBackdrop(
  series: Movie,
  season: Season | null | undefined,
  episode: Episode | null | undefined
) {
  return (
    episode?.overriddenBackdrop ||
    series.overriddenBackdrop ||
    episode?.thumbnail ||
    episode?.poster ||
    season?.poster ||
    series.poster ||
    ''
  );
}

function sortSeasons(seasons: Season[]) {
  return [...seasons].sort((left, right) => left.seasonNumber - right.seasonNumber);
}

function sortEpisodes(episodes: Episode[]) {
  return [...episodes].sort((left, right) => left.episodeNumber - right.episodeNumber);
}

function findSeason(series: Movie | null, seasonNumber: number) {
  return (series?.seasons || []).find(
    (season) => Number(season.seasonNumber) === Number(seasonNumber)
  );
}

function findEpisode(series: Movie | null, seasonNumber: number, episodeNumber: number) {
  return findSeason(series, seasonNumber)?.episodes?.find(
    (episode) => Number(episode.episodeNumber) === Number(episodeNumber)
  );
}

function getNextSeasonNumber(series: Movie | null) {
  const lastSeason = sortSeasons(series?.seasons || []).slice(-1)[0];
  return (lastSeason?.seasonNumber || 0) + 1;
}

function getNextEpisodeNumber(series: Movie | null, seasonNumber: number) {
  const lastEpisode = sortEpisodes(findSeason(series, seasonNumber)?.episodes || []).slice(-1)[0];
  return (lastEpisode?.episodeNumber || 0) + 1;
}

function buildSeriesFormState(series?: Movie | null): SeriesFormState {
  return {
    tmdbId: series?.tmdb_id ? String(series.tmdb_id) : '',
    title: series?.title || '',
    description: series?.description || series?.overview || '',
    releaseYear: series?.releaseYear
      ? String(series.releaseYear)
      : series?.release_date?.slice(0, 4) || '',
    language: series?.language || '',
    vj: series?.vj || 'Unknown',
    genres: (series?.genres || []).join(', '),
    tags: (series?.tags || []).join(', '),
    categories: series?.category || [],
    nativeBackdrop: series?.poster || '',
    overriddenBackdrop: series?.overriddenBackdrop || '',
    backdropFile: null,
    mainSeriesTrailerUrl: series?.mainSeriesTrailerUrl || '',
    trailerFile: null,
  };
}

function getImageSize(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be inspected.'));
    };
    image.src = url;
  });
}

async function validateLandscapeFile(file: File) {
  const size = await getImageSize(file);

  if (size.width <= size.height) {
    throw new Error('Please upload a landscape image. Portrait and square images are blocked.');
  }
}

async function uploadLandscapeBackdrop(file: File | null, existingUrl: string) {
  if (!file) {
    return existingUrl.trim();
  }

  await validateLandscapeFile(file);
  const uploaded = await uploadPosterToAdmin(file);
  return uploaded.publicUrl;
}

function SeriesShell({
  title,
  subtitle,
  backHref,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-24 pt-6 text-white md:px-8 lg:px-10">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-white/10 bg-[#11141C] p-4 shadow-[0_20px_55px_rgba(0,0,0,0.35)] md:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {backHref ? (
                <Link
                  href={backHref}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
                  aria-label="Go back"
                >
                  <ArrowLeft size={20} />
                </Link>
              ) : null}
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#D90429]">
                  Series Admin
                </div>
                <h1 className="mt-1 truncate text-2xl font-black uppercase tracking-[0.12em] text-white md:text-4xl">
                  {title}
                </h1>
              </div>
            </div>
            {action}
          </div>
          {subtitle ? (
            <p className="mt-4 text-sm leading-6 text-white/62">{subtitle}</p>
          ) : null}
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

function LandscapeBackdropField({
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

  const handleFile = async (input: HTMLInputElement, nextFile: File | null) => {
    setError('');

    if (!nextFile) {
      onFileChange(null);
      return;
    }

    try {
      await validateLandscapeFile(nextFile);
      onFileChange(nextFile);
    } catch (validationError) {
      onFileChange(null);
      input.value = '';
      setError(
        validationError instanceof Error
          ? validationError.message
          : 'Please upload a landscape image.'
      );
    }
  };

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return undefined;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  const preview = previewUrl || value || fallbackPreview || '';

  return (
    <div className="space-y-3">
      <FieldLabel>{label}</FieldLabel>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
        <div className="relative aspect-video w-full bg-[#080B11]">
          {preview ? (
            <img src={preview} alt={label} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white/40">
              Landscape backdrop preview
            </div>
          )}
        </div>
      </div>
      <div className="rounded-2xl border border-dashed border-white/15 bg-[#0C1017] p-3">
        <div className="relative min-h-16 w-full overflow-hidden rounded-2xl bg-[#D90429] shadow-[0_12px_26px_rgba(217,4,41,0.22)] active:scale-[0.99]">
          <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center gap-3 px-4 py-4 text-center text-xs font-black uppercase tracking-[0.2em] text-white">
            <UploadCloud size={18} />
            Choose Backdrop
          </div>
          <input
            type="file"
            accept="image/*"
            aria-label="Choose backdrop"
            onChange={(event) => {
              const input = event.currentTarget;
              void handleFile(input, input.files?.[0] || null);
            }}
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-[0.01]"
            style={{
              fontSize: 96,
              WebkitAppearance: 'none',
            }}
          />
        </div>
        <div className="mt-3 break-words text-center text-xs font-semibold text-white/55">
          {file ? file.name : 'No file selected'}
        </div>
      </div>
      {file ? (
        <div className="rounded-2xl border border-[#D90429]/20 bg-[#17070B] px-4 py-3 text-xs leading-6 text-white/78">
          Pending landscape override: {file.name}
        </div>
      ) : null}
      {error ? <div className="text-sm font-semibold text-amber-100">{error}</div> : null}
    </div>
  );
}

function TrailerVideoField({
  label = 'Upload Trailer Video',
  value,
  file,
  onFileChange,
}: {
  label?: string;
  value: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
}) {
  const [error, setError] = useState('');

  const handleFile = (input: HTMLInputElement, nextFile: File | null) => {
    setError('');

    if (!nextFile) {
      onFileChange(null);
      return;
    }

    if (!isMp4TrailerFile(nextFile)) {
      onFileChange(null);
      input.value = '';
      setError('Trailer uploads must be MP4 video files.');
      return;
    }

    onFileChange(nextFile);
  };

  return (
    <div className="space-y-3">
      <FieldLabel>{label}</FieldLabel>
      <input
        type="file"
        accept="video/mp4,.mp4"
        onChange={(event) => {
          const input = event.currentTarget;
          handleFile(input, input.files?.[0] || null);
        }}
        className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0C1017] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
      />
      <div className="rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-4 text-xs leading-6 text-white/58">
        {file ? (
          <span className="font-bold text-white">{file.name}</span>
        ) : value ? (
          <span className="break-all">{value}</span>
        ) : (
          'No trailer is saved yet. Upload an MP4 from phone storage.'
        )}
      </div>
      {error ? <div className="text-sm font-semibold text-amber-100">{error}</div> : null}
    </div>
  );
}

function NativeBackdropField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-3">
      <FieldLabel>Native TMDb Backdrop</FieldLabel>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
        <div className="relative aspect-video w-full bg-[#080B11]">
          {value ? (
            <img src={value} alt="Native TMDb backdrop" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-5 text-center text-sm font-semibold text-white/40">
              Search TMDb to fill the original landscape backdrop.
            </div>
          )}
        </div>
      </div>
      <TextInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="TMDb backdrop URL"
      />
      <div className="rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-xs leading-6 text-white/58">
        This is the native imported backdrop. Manual overrides are saved separately so the original
        metadata stays intact.
      </div>
    </div>
  );
}

function TmdbSeriesLookup({
  form,
  setForm,
}: {
  form: SeriesFormState;
  setForm: React.Dispatch<React.SetStateAction<SeriesFormState>>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbTvResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSearch = async () => {
    const searchTerm = query.trim() || form.title.trim();

    if (!searchTerm) {
      setMessage('Enter a series title before searching TMDb.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const response = await fetch(
        `/api/admin/tmdb?mediaType=tv&title=${encodeURIComponent(searchTerm)}`,
        {
          credentials: 'include',
          cache: 'no-store',
        }
      );
      const payload = (await response.json()) as
        | TmdbTvResult[]
        | { results?: TmdbTvResult[]; error?: string };

      if (!response.ok) {
        throw new Error(
          !Array.isArray(payload) && payload.error ? payload.error : 'TMDb search failed.'
        );
      }

      const nextResults = Array.isArray(payload) ? payload : payload.results || [];
      setResults(nextResults);
      setMessage(nextResults.length ? '' : 'No TMDb results matched that title.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'TMDb search failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePickResult = async (result: TmdbTvResult) => {
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch(
        `/api/admin/tmdb?mediaType=tv&tmdbId=${encodeURIComponent(String(result.id))}`,
        {
          credentials: 'include',
          cache: 'no-store',
        }
      );
      const payload = (await response.json()) as TmdbTvDetails | { error?: string };

      if (!response.ok || 'error' in payload) {
        throw new Error(
          'error' in payload && payload.error ? payload.error : 'Failed to load TMDb details.'
        );
      }

      const details = payload as TmdbTvDetails;
      const nativeBackdrop = buildTmdbImageUrl(details.backdrop_path || result.backdrop_path);

      setForm((current) => ({
        ...current,
        tmdbId: String(details.id || result.id),
        title: details.name || result.name || current.title,
        description: details.overview || result.overview || current.description,
        releaseYear:
          details.first_air_date?.slice(0, 4) ||
          result.first_air_date?.slice(0, 4) ||
          current.releaseYear,
        language: getTmdbLanguageLabel(details) || current.language,
        genres: details.genres?.map((genre) => genre.name).filter(Boolean).join(', ') || current.genres,
        tags: getTmdbKeywordList(details).join(', ') || current.tags,
        nativeBackdrop: nativeBackdrop || current.nativeBackdrop,
      }));
      setQuery(details.name || result.name || '');
      setResults([]);
      setMessage('TMDb metadata applied. Override backdrop is still optional.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load TMDb details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="TMDb Metadata"
      description="Search the official series database first, then override only the backdrop if needed."
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/38" size={18} />
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={form.title || 'Search TMDb by series title'}
            className="pl-12"
          />
        </div>
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={loading}
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
          {results.slice(0, 6).map((result) => {
            const image = buildTmdbImageUrl(result.backdrop_path);

            return (
              <button
                key={result.id}
                type="button"
                onClick={() => void handlePickResult(result)}
                className="overflow-hidden rounded-2xl border border-white/10 bg-[#0C1017] text-left transition-colors hover:border-[#D90429]/45"
              >
                <div className="relative aspect-video bg-black/30">
                  {image ? (
                    <img src={image} alt={result.name} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-white/35">
                      No backdrop
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <div className="line-clamp-2 text-sm font-black text-white">{result.name}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
                      {result.first_air_date?.slice(0, 4) || 'No year'}
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

function SeriesCard({ series }: { series: Movie }) {
  const backdrop = getEffectiveSeriesBackdrop(series);
  const episodeCount = getSeriesEpisodeCount(series);

  return (
    <Link
      href={`/admin/series/${series.id}/seasons`}
      className="group block overflow-hidden rounded-[24px] border border-white/10 bg-[#11141C] shadow-[0_18px_45px_rgba(0,0,0,0.32)] transition-transform active:scale-[0.99]"
    >
      <div className="relative aspect-video bg-[#080B11]">
        {backdrop ? (
          <img src={backdrop} alt={series.title} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/35">
            No backdrop
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h2 className="line-clamp-2 text-xl font-black leading-tight text-white">
            {series.title}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/70">
            <span>{formatCount(series.seasons?.length || 0, 'season', 'seasons')}</span>
            <span>{formatCount(episodeCount, 'episode', 'episodes')}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

async function loadSeries(seriesId: string) {
  const payload = await fetchAdminJson<{ movie?: Movie }>(`/api/admin/movies/${seriesId}`, {
    force: true,
  });
  const movie = payload.movie || null;

  if (!movie || movie.contentType !== 'series') {
    throw new Error('Series not found.');
  }

  return movie;
}

async function loadCategories() {
  const payload = await fetchAdminJson<{ categories?: AdminCategory[] }>('/api/admin/categories');
  return payload.categories || [];
}

async function loadLibraryAssets() {
  const payload = await fetchAdminJson<{ assets?: AdminLibraryAsset[] }>('/api/admin/library');
  return payload.assets || [];
}

function useManualSeriesCategories(categories: AdminCategory[]) {
  return useMemo(() => {
    const categoryMap = new Map(categories.map((category) => [category.name, category]));
    return SERIES_CATEGORY_OPTIONS.map((entry) => categoryMap.get(entry.name)).filter(
      (category): category is AdminCategory => Boolean(category)
    );
  }, [categories]);
}

function useCategoryLabelMap() {
  return useMemo<Map<string, string>>(
    () => new Map<string, string>(SERIES_CATEGORY_OPTIONS.map((entry) => [entry.name, entry.label])),
    []
  );
}

export function AdminSeriesHubView() {
  const [seriesItems, setSeriesItems] = useState<Movie[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;

    fetchAdminJson<{ movies?: Movie[] }>('/api/admin/movies', { force: true })
      .then((payload) => {
        if (!active) return;
        setSeriesItems((payload.movies || []).filter((movie) => movie.contentType === 'series'));
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load series.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredSeries = useMemo(() => {
    const needle = search.trim().toLowerCase();

    if (!needle) return seriesItems;

    return seriesItems.filter((series) =>
      `${series.title} ${series.vj || ''} ${(series.genres || []).join(' ')}`
        .toLowerCase()
        .includes(needle)
    );
  }, [search, seriesItems]);

  return (
    <SeriesShell
      title="Series"
      subtitle="Create, search, and manage series from a clean mobile-first workspace."
      backHref="/admin"
      action={
        <Link
          href="/admin/series/new"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#D90429] text-white shadow-[0_12px_28px_rgba(217,4,41,0.28)]"
          aria-label="Create New Series"
        >
          <Plus size={22} />
        </Link>
      }
    >
      <Card
        title="Series Hub"
        description="Search existing series or create a new shell, then manage seasons and episodes from focused pages."
        action={
          <Link
            href="/admin/series/new"
            className="hidden rounded-full bg-[#D90429] px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white md:inline-flex"
          >
            Create New Series
          </Link>
        }
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/38" size={18} />
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title, VJ, or genre"
            className="pl-12"
          />
        </div>
      </Card>

      <StatusMessage message={errorMessage} tone="error" />

      {loading ? (
        <Card title="Loading" description="Fetching the series catalog.">
          <div className="text-sm text-white/55">Loading series...</div>
        </Card>
      ) : filteredSeries.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredSeries.map((series) => (
            <SeriesCard key={series.id} series={series} />
          ))}
        </div>
      ) : (
        <Card title="No Series Found" description="Create your first series shell or clear the search field.">
          <Link
            href="/admin/series/new"
            className="inline-flex rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white"
          >
            Create New Series
          </Link>
        </Card>
      )}
    </SeriesShell>
  );
}

function SeriesDetailsFields({
  form,
  setForm,
  categories,
  fallbackPreview,
}: {
  form: SeriesFormState;
  setForm: React.Dispatch<React.SetStateAction<SeriesFormState>>;
  categories: AdminCategory[];
  fallbackPreview?: string;
}) {
  const manualSeriesCategories = useManualSeriesCategories(categories);
  const categoryLabelMap = useCategoryLabelMap();

  return (
    <div className="space-y-5">
      <div>
        <FieldLabel>Title</FieldLabel>
        <TextInput
          value={form.title}
          onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          placeholder="Series title"
        />
      </div>
      <div>
        <FieldLabel>Description</FieldLabel>
        <TextArea
          value={form.description}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          rows={5}
          placeholder="Series description"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <FieldLabel>Release Year</FieldLabel>
          <TextInput
            value={form.releaseYear}
            onChange={(event) => setForm((current) => ({ ...current, releaseYear: event.target.value }))}
            inputMode="numeric"
            placeholder="2026"
          />
        </div>
        <div>
          <FieldLabel>Language</FieldLabel>
          <TextInput
            value={form.language}
            onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}
            placeholder="Korean, English, Luganda..."
          />
        </div>
      </div>
      <div>
        <FieldLabel>VJ</FieldLabel>
        <TextInput
          value={form.vj}
          onChange={(event) => setForm((current) => ({ ...current, vj: event.target.value }))}
          placeholder="VJ IVO"
        />
      </div>
      <div>
        <FieldLabel>Genres</FieldLabel>
        <TextInput
          value={form.genres}
          onChange={(event) => setForm((current) => ({ ...current, genres: event.target.value }))}
          placeholder="Drama, Action, Romance"
        />
      </div>
      <div>
        <FieldLabel>Tags</FieldLabel>
        <TextInput
          value={form.tags}
          onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
          placeholder="Optional tags separated by commas"
        />
      </div>
      <div>
        <FieldLabel>Categories</FieldLabel>
        {manualSeriesCategories.length ? (
          <CategoryChecklist
            categories={manualSeriesCategories}
            selected={form.categories}
            onToggle={(name) =>
              setForm((current) => ({
                ...current,
                categories: current.categories.includes(name)
                  ? current.categories.filter((entry) => entry !== name)
                  : [...current.categories, name],
              }))
            }
            className="grid-cols-1"
            getLabel={(category) => categoryLabelMap.get(category.name) || category.name}
          />
        ) : (
          <div className="rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-4 text-sm text-white/55">
            Series categories are not loaded yet.
          </div>
        )}
      </div>
      <NativeBackdropField
        value={form.nativeBackdrop}
        onChange={(value) => setForm((current) => ({ ...current, nativeBackdrop: value }))}
      />
      <LandscapeBackdropField
        label="Override Backdrop"
        value={form.overriddenBackdrop}
        fallbackPreview={fallbackPreview}
        file={form.backdropFile}
        onFileChange={(file) => setForm((current) => ({ ...current, backdropFile: file }))}
      />
      <TrailerVideoField
        value={form.mainSeriesTrailerUrl}
        file={form.trailerFile}
        onFileChange={(file) => setForm((current) => ({ ...current, trailerFile: file }))}
      />
    </div>
  );
}

export function AdminSeriesCreateView() {
  const router = useRouter();
  const [form, setForm] = useState<SeriesFormState>(() => buildSeriesFormState(null));
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    void loadCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const handleCreate = async () => {
    if (!form.title.trim()) {
      setErrorMessage('Series title is required.');
      return;
    }

    setSaving(true);
    setErrorMessage('');

    try {
      const overriddenBackdrop = await uploadLandscapeBackdrop(form.backdropFile, form.overriddenBackdrop);
      const uploadedTrailer = form.trailerFile
        ? await uploadTrailerVideoToAdmin(form.trailerFile)
        : null;
      const response = await fetch('/api/admin/movies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movie: {
            contentType: 'series',
            title: form.title.trim(),
            description: form.description.trim(),
            overview: form.description.trim(),
            poster: form.nativeBackdrop.trim(),
            overriddenBackdrop,
            mainSeriesTrailerUrl: uploadedTrailer?.publicUrl || form.mainSeriesTrailerUrl.trim(),
            tmdb_id: parseTmdbId(form.tmdbId),
            releaseYear: parseReleaseYear(form.releaseYear),
            language: form.language.trim(),
            vj: form.vj.trim() || 'Unknown',
            genres: splitCommaList(form.genres),
            tags: splitCommaList(form.tags),
            category: form.categories,
            accessTier: 'premium',
            seasons: [],
          },
        }),
      });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to create series.');
      }

      clearAdminFetchCache('/api/admin/movies');
      const nextSeriesId = String(result.payload.movie?.id || '');
      router.push(nextSeriesId ? `/admin/series/${nextSeriesId}/seasons` : '/admin/series');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create series.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SeriesShell
      title="New Series"
      subtitle="Create the shell first. Episodes are added from the season manager after this step."
      backHref="/admin/series"
    >
      <StatusMessage message={errorMessage} tone="error" />
      <TmdbSeriesLookup form={form} setForm={setForm} />
      <Card title="Series Details" description="Only landscape backdrops are accepted.">
        <SeriesDetailsFields form={form} setForm={setForm} categories={categories} />
      </Card>
      <div className="pointer-events-none sticky bottom-4 z-20">
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={saving}
          className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D90429] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-[0_16px_40px_rgba(217,4,41,0.28)] disabled:cursor-not-allowed disabled:opacity-55"
        >
          <Save size={18} />
          {saving ? 'Creating...' : 'Create Series'}
        </button>
      </div>
    </SeriesShell>
  );
}

export function AdminSeriesDetailsView({ seriesId }: { seriesId: string }) {
  const [series, setSeries] = useState<Movie | null>(null);
  const [form, setForm] = useState<SeriesFormState>(() => buildSeriesFormState(null));
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;

    Promise.all([loadSeries(seriesId), loadCategories()])
      .then(([nextSeries, nextCategories]) => {
        if (!active) return;
        setSeries(nextSeries);
        setForm(buildSeriesFormState(nextSeries));
        setCategories(nextCategories);
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load series.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [seriesId]);

  const handleSave = async () => {
    if (!series) return;

    if (!form.title.trim()) {
      setErrorMessage('Series title is required.');
      return;
    }

    setSaving(true);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const overriddenBackdrop = await uploadLandscapeBackdrop(form.backdropFile, form.overriddenBackdrop);
      const uploadedTrailer = form.trailerFile
        ? await uploadTrailerVideoToAdmin(form.trailerFile)
        : null;
      const response = await fetch(`/api/admin/movies/${series.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          poster: form.nativeBackdrop.trim(),
          overriddenBackdrop,
          mainSeriesTrailerUrl: uploadedTrailer?.publicUrl || form.mainSeriesTrailerUrl.trim(),
          tmdb_id: parseTmdbId(form.tmdbId),
          vj: form.vj.trim() || 'Unknown',
          releaseYear: parseReleaseYear(form.releaseYear),
          language: form.language.trim(),
          genres: splitCommaList(form.genres),
          tags: splitCommaList(form.tags),
          category: form.categories,
          is_trending_tiktok:
            Boolean(series.is_trending_tiktok) ||
            form.categories.some((entry) => entry.toLowerCase() === 'trending on tiktok'),
        }),
      });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to save series details.');
      }

      clearAdminFetchCache('/api/admin/movies');
      const refreshed = await loadSeries(seriesId);
      setSeries(refreshed);
      setForm(buildSeriesFormState(refreshed));
      setStatusMessage('Series details saved.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save series details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SeriesShell
      title="Details"
      subtitle={series?.title || 'Edit the main metadata and backdrop override.'}
      backHref={`/admin/series/${seriesId}/seasons`}
    >
      <StatusMessage message={statusMessage} tone="success" />
      <StatusMessage message={errorMessage} tone="error" />
      {loading ? (
        <Card title="Loading" description="Fetching series details.">
          <div className="text-sm text-white/55">Loading...</div>
        </Card>
      ) : series ? (
        <>
          <TmdbSeriesLookup form={form} setForm={setForm} />
          <Card title="Series Details" description="Override the landscape backdrop without destroying native metadata.">
            <SeriesDetailsFields
              form={form}
              setForm={setForm}
              categories={categories}
              fallbackPreview={getEffectiveSeriesBackdrop(series)}
            />
          </Card>
          <div className="pointer-events-none sticky bottom-4 z-20">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D90429] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-[0_16px_40px_rgba(217,4,41,0.28)] disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Save size={18} />
              {saving ? 'Saving...' : 'Save Details'}
            </button>
          </div>
        </>
      ) : null}
    </SeriesShell>
  );
}

export function AdminSeriesSeasonsView({ seriesId }: { seriesId: string }) {
  const searchParams = useSearchParams();
  const [series, setSeries] = useState<Movie | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;

    loadSeries(seriesId)
      .then((nextSeries) => {
        if (active) setSeries(nextSeries);
      })
      .catch((error) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Failed to load series.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [seriesId]);

  const nextSeasonNumber = getNextSeasonNumber(series);
  const queuedCount = Number(searchParams.get('queued') || 0);
  const episodeSaved = searchParams.get('episodeSaved') === '1';

  return (
    <SeriesShell
      title="Seasons"
      subtitle={series?.title || 'Manage seasons and episodes.'}
      backHref="/admin/series"
      action={
        <div className="flex shrink-0 gap-2">
          <Link
            href="/admin/processing"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
            aria-label="Open processing queue"
          >
            <UploadCloud size={18} />
          </Link>
          <Link
            href={`/admin/series/${seriesId}/details`}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
            aria-label="Edit series details"
          >
            <PencilLine size={18} />
          </Link>
        </div>
      }
    >
      <StatusMessage message={errorMessage} tone="error" />
      {episodeSaved ? (
        <Card
          title={queuedCount > 0 ? 'Episode Queued' : 'Episode Saved'}
          description={
            queuedCount > 0
              ? 'The episode was added to the processing queue. It will appear publicly after the worker finishes processing and marks it ready.'
              : 'The episode was saved. No new processing job was needed for this update.'
          }
          action={
            <Link
              href="/admin/processing"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white"
            >
              Processing Queue
            </Link>
          }
        >
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-white/65">
            {queuedCount > 0
              ? `${queuedCount} video job${queuedCount === 1 ? '' : 's'} queued for this save.`
              : 'Metadata-only updates stay on the series page.'}
          </div>
        </Card>
      ) : null}
      {loading ? (
        <Card title="Loading" description="Fetching seasons.">
          <div className="text-sm text-white/55">Loading...</div>
        </Card>
      ) : series ? (
        <>
          <Card
            title="Season Manager"
            description="Open one season at a time and add or edit episodes from focused pages."
            action={
              <Link
                href={`/admin/series/${seriesId}/seasons/${nextSeasonNumber}/episodes/new`}
                className="rounded-full bg-[#D90429] px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white"
              >
                Add Season
              </Link>
            }
          >
            <div className="relative mb-5 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
              <div className="relative aspect-video">
                {getEffectiveSeriesBackdrop(series) ? (
                  <img
                    src={getEffectiveSeriesBackdrop(series)}
                    alt={series.title}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-white/40">
                    No backdrop
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <h2 className="text-2xl font-black text-white">{series.title}</h2>
                  <p className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-white/60">
                    {formatCount(series.seasons?.length || 0, 'season', 'seasons')} |{' '}
                    {formatCount(getSeriesEpisodeCount(series), 'episode', 'episodes')}
                  </p>
                </div>
              </div>
            </div>
            <div className="grid gap-3">
              {sortSeasons(series.seasons || []).map((season) => (
                <div key={season.seasonNumber} className="rounded-2xl border border-white/10 bg-[#0C1017] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-black text-white">
                        {season.title || `Season ${season.seasonNumber}`}
                      </h3>
                      <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
                        {formatCount(season.episodes?.length || 0, 'episode', 'episodes')}
                      </p>
                    </div>
                    <Link
                      href={`/admin/series/${seriesId}/seasons/${season.seasonNumber}/episodes/new`}
                      className="shrink-0 rounded-full border border-[#D90429]/40 bg-[#17070B] px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white"
                    >
                      Add EP
                    </Link>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {sortEpisodes(season.episodes || []).map((episode) => (
                      <Link
                        key={episode.episodeNumber}
                        href={`/admin/series/${seriesId}/seasons/${season.seasonNumber}/episodes/${episode.episodeNumber}`}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#11141C] p-2"
                      >
                        <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-black/30">
                          {getEffectiveEpisodeBackdrop(series, season, episode) ? (
                            <img
                              src={getEffectiveEpisodeBackdrop(series, season, episode)}
                              alt={episode.title}
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#D90429]">
                            EP {episode.episodeNumber}
                          </div>
                          <div className="mt-1 line-clamp-2 text-sm font-bold text-white">
                            {episode.title || `Episode ${episode.episodeNumber}`}
                          </div>
                        </div>
                      </Link>
                    ))}
                    {!season.episodes?.length ? (
                      <Link
                        href={`/admin/series/${seriesId}/seasons/${season.seasonNumber}/episodes/new`}
                        className="rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-4 text-center text-sm font-semibold text-white/55"
                      >
                        Add the first episode
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
              {!series.seasons?.length ? (
                <Link
                  href={`/admin/series/${seriesId}/seasons/1/episodes/new`}
                  className="rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-8 text-center text-sm font-semibold text-white/65"
                >
                  Add Season 1 Episode 1
                </Link>
              ) : null}
            </div>
          </Card>
        </>
      ) : null}
    </SeriesShell>
  );
}

function getEpisodeSourceUrl(episode: Episode | null | undefined) {
  if (!episode) return '';
  return episode.sourceType === 'direct_url' && !episode.video_url
    ? ''
    : episode.sourceUrl || episode.video_url || '';
}

function buildEpisodeFormState(
  series: Movie | null,
  seasonNumber: number,
  episodeNumber?: number
): EpisodeFormState {
  const existingEpisode =
    episodeNumber !== undefined ? findEpisode(series, seasonNumber, episodeNumber) : null;
  const nextEpisodeNumber =
    episodeNumber !== undefined ? episodeNumber : getNextEpisodeNumber(series, seasonNumber);

  return {
    episodeNumber: String(existingEpisode?.episodeNumber || nextEpisodeNumber),
    title: existingEpisode?.title || `Episode ${nextEpisodeNumber}`,
    description: existingEpisode?.description || existingEpisode?.overview || '',
    source: {
      mode: 'url',
      url: getEpisodeSourceUrl(existingEpisode),
      file: null,
      sourceType: existingEpisode?.sourceType,
    },
    overriddenBackdrop: existingEpisode?.overriddenBackdrop || '',
    backdropFile: null,
    episodeTrailerUrl: existingEpisode?.episodeTrailerUrl || '',
    trailerFile: null,
  };
}

async function resolveEpisodeSource(
  form: EpisodeFormState,
  existingEpisode: Episode | null | undefined,
  onStats: (stats: MultipartUploadStats | null) => void
) {
  const currentUrl = getEpisodeSourceUrl(existingEpisode);

  if (form.source.mode === 'file' && form.source.file) {
    const uploaded = await uploadMultipartFileToAdmin({
      file: form.source.file,
      stage: 'final',
      onProgress: () => undefined,
      onStats,
    });

    return {
      video_url: uploaded.publicUrl,
      sourceUrl: uploaded.publicUrl,
      sourceFileName: uploaded.fileName,
      fileSizeBytes: uploaded.fileSizeBytes,
      sourceType: 'direct_upload' as const,
      sourcePipeline: 'direct_upload' as const,
    };
  }

  const nextUrl = form.source.url.trim();

  if (existingEpisode && nextUrl === currentUrl) {
    return {
      video_url: existingEpisode.video_url || '',
      sourceUrl: existingEpisode.sourceUrl || existingEpisode.video_url || '',
      sourceFileName: existingEpisode.sourceFileName || '',
      fileSizeBytes: existingEpisode.fileSizeBytes || 0,
      sourceType: existingEpisode.sourceType || 'direct_upload',
      sourcePipeline: existingEpisode.sourcePipeline || 'direct_upload',
      jobStatus: existingEpisode.jobStatus,
      processingProgress: existingEpisode.processingProgress,
      playbackType: existingEpisode.playbackType || 'mp4',
      masterPlaylistUrl: existingEpisode.masterPlaylistUrl || '',
      availableRenditions: existingEpisode.availableRenditions || [],
    };
  }

  return {
    video_url: nextUrl,
    sourceUrl: nextUrl,
    sourceFileName: nextUrl.split('/').pop() || '',
    fileSizeBytes: 0,
    sourceType: 'direct_upload' as const,
    sourcePipeline: 'direct_upload' as const,
  };
}

export function AdminSeriesEpisodeEditorView({
  seriesId,
  seasonNumber,
  episodeNumber,
}: {
  seriesId: string;
  seasonNumber: number;
  episodeNumber?: number;
}) {
  const router = useRouter();
  const [series, setSeries] = useState<Movie | null>(null);
  const [libraryAssets, setLibraryAssets] = useState<AdminLibraryAsset[]>([]);
  const [form, setForm] = useState<EpisodeFormState>(() =>
    buildEpisodeFormState(null, seasonNumber, episodeNumber)
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadStats, setUploadStats] = useState<MultipartUploadStats | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([loadSeries(seriesId), loadLibraryAssets()])
      .then(([nextSeries, nextAssets]) => {
        if (!active) return;
        setSeries(nextSeries);
        setLibraryAssets(nextAssets);
        setForm(buildEpisodeFormState(nextSeries, seasonNumber, episodeNumber));
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load episode editor.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [seriesId, seasonNumber, episodeNumber]);

  const existingSeason = findSeason(series, seasonNumber);
  const existingEpisode =
    episodeNumber !== undefined ? findEpisode(series, seasonNumber, episodeNumber) : null;
  const editing = Boolean(existingEpisode);

  const handleSave = async () => {
    if (!series) return;

    const nextEpisodeNumber = Number(form.episodeNumber);

    if (!Number.isFinite(nextEpisodeNumber) || nextEpisodeNumber <= 0) {
      setErrorMessage('Episode number is required.');
      return;
    }

    if (!form.title.trim()) {
      setErrorMessage('Episode title is required.');
      return;
    }

    if (!form.source.file && !form.source.url.trim()) {
      setErrorMessage('Episode video URL or file is required.');
      return;
    }

    setSaving(true);
    setErrorMessage('');
    setUploadStats(null);

    try {
      const overriddenBackdrop = await uploadLandscapeBackdrop(form.backdropFile, form.overriddenBackdrop);
      const uploadedTrailer = form.trailerFile
        ? await uploadTrailerVideoToAdmin(form.trailerFile)
        : null;
      const sourceFields = await resolveEpisodeSource(form, existingEpisode, setUploadStats);
      const nextEpisode: Episode = {
        ...(existingEpisode || {}),
        episodeNumber: nextEpisodeNumber,
        title: form.title.trim() || `Episode ${nextEpisodeNumber}`,
        description: form.description.trim(),
        overview: form.description.trim(),
        poster: existingEpisode?.poster || '',
        thumbnail: existingEpisode?.thumbnail || '',
        overriddenBackdrop,
        episodeTrailerUrl: uploadedTrailer?.publicUrl || form.episodeTrailerUrl.trim(),
        accessTier: existingEpisode?.accessTier || series.accessTier || 'premium',
        subscriptionRequired: existingEpisode?.subscriptionRequired ?? series.accessTier !== 'free',
        isLocked: false,
        ...sourceFields,
      } as Episode;
      const response = await fetch(
        `/api/admin/movies/${series.id}?seasonNumber=${seasonNumber}&episodeNumber=${
          editing ? episodeNumber : nextEpisodeNumber
        }`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            seasonTitle: existingSeason?.title || `Season ${seasonNumber}`,
            episode: nextEpisode,
          }),
        }
      );
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to save episode.');
      }

      clearAdminFetchCache('/api/admin/movies');
      const queuedNormalizationCount = Number(result.payload.queuedNormalizationCount || 0);
      router.push(
        `/admin/series/${series.id}/seasons?episodeSaved=1&queued=${queuedNormalizationCount}`
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save episode.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SeriesShell
      title={editing ? 'Edit Episode' : 'New Episode'}
      subtitle={series?.title || `Season ${seasonNumber}`}
      backHref={`/admin/series/${seriesId}/seasons`}
    >
      <StatusMessage message={errorMessage} tone="error" />
      {loading ? (
        <Card title="Loading" description="Fetching episode details.">
          <div className="text-sm text-white/55">Loading...</div>
        </Card>
      ) : (
        <>
          <Card title={`Season ${seasonNumber}`} description="Edit one episode at a time.">
            <div className="space-y-5">
              <div>
                <FieldLabel>Episode Number</FieldLabel>
                <TextInput
                  value={form.episodeNumber}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, episodeNumber: event.target.value }))
                  }
                  inputMode="numeric"
                />
              </div>
              <div>
                <FieldLabel>Episode Title</FieldLabel>
                <TextInput
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Episode title"
                />
              </div>
              <div>
                <FieldLabel>Description</FieldLabel>
                <TextArea
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  rows={4}
                  placeholder="Optional episode description"
                />
              </div>
              <LandscapeBackdropField
                label="Episode Backdrop Override"
                value={form.overriddenBackdrop}
                fallbackPreview={getEffectiveSeriesBackdrop(series)}
                file={form.backdropFile}
                onFileChange={(file) => setForm((current) => ({ ...current, backdropFile: file }))}
              />
              <TrailerVideoField
                value={form.episodeTrailerUrl}
                file={form.trailerFile}
                onFileChange={(file) => setForm((current) => ({ ...current, trailerFile: file }))}
              />
              <SourceEditor
                title="Episode Video"
                source={form.source}
                onChange={(source) => setForm((current) => ({ ...current, source }))}
                libraryAssets={libraryAssets}
                helpText="Pasted MP4 links and uploaded files use the existing processing pipeline before going live."
              />
            </div>
          </Card>
          {uploadStats ? (
            <Card title="Upload Progress">
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#D90429]"
                  style={{
                    width: `${
                      uploadStats.totalBytes > 0
                        ? Math.max(
                            0,
                            Math.min(100, (uploadStats.uploadedBytes / uploadStats.totalBytes) * 100)
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
            </Card>
          ) : null}
          <div className="pointer-events-none sticky bottom-4 z-20">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D90429] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-[0_16px_40px_rgba(217,4,41,0.28)] disabled:cursor-not-allowed disabled:opacity-55"
            >
              <UploadCloud size={18} />
              {saving ? 'Saving...' : editing ? 'Save Episode' : 'Add Episode'}
            </button>
          </div>
        </>
      )}
    </SeriesShell>
  );
}
