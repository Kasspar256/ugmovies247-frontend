'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  FolderPlus,
  Gauge,
  PencilLine,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { AdminCategory } from '@/types/admin';
import type { Movie, Season } from '@/types/movie';
import {
  parseApiResponse,
  type MultipartUploadStats,
  uploadMultipartFileToAdmin,
  uploadPosterToAdmin,
} from '@/lib/admin/directUploadClient';
import { fetchAdminJson } from '@/lib/admin/fetchAdminJson';
import {
  Card,
  FieldLabel,
  SelectInput,
  TextArea,
  TextInput,
} from '@/components/admin/controlCenterFields';
import { CategoryChecklist } from '@/components/admin/controlCenterEditors';

type SeriesMode = 'upload-episode' | 'add-season' | 'create-series';
type SourceMode = 'upload' | 'link';

type TmdbTvResult = {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  first_air_date?: string;
  original_language?: string;
};

type TmdbTvDetails = {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  first_air_date?: string;
  original_language?: string;
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
  seasons?: Array<{
    id: number;
    season_number: number;
    name?: string;
    overview?: string;
    poster_path?: string | null;
  }>;
};

type TmdbSeasonDetails = {
  id: number;
  season_number: number;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  air_date?: string;
};

type EpisodeSourceDraft = {
  mode: SourceMode;
  file: File | null;
  url: string;
};

type UploadEpisodeDraft = {
  seasonNumber: string;
  episodeNumber: string;
  episodeTitle: string;
  episodeDescription: string;
  seasonPosterUrl: string;
  source: EpisodeSourceDraft;
};

type AddSeasonDraft = {
  seasonNumber: string;
  seasonTitle: string;
  seasonOverview: string;
  seasonPosterUrl: string;
  episodeNumber: string;
  episodeTitle: string;
  episodeDescription: string;
  source: EpisodeSourceDraft;
};

type CreateSeriesDraft = {
  tmdbId: number | null;
  title: string;
  description: string;
  releaseYear: string;
  language: string;
  vj: string;
  genres: string;
  tags: string;
  categories: string[];
  seasonTitle: string;
  seasonOverview: string;
  seasonPosterUrl: string;
  episodeNumber: string;
  episodeTitle: string;
  episodeDescription: string;
  source: EpisodeSourceDraft;
};

const SERIES_CATEGORY_OPTIONS = [
  { name: 'Latest series', label: 'Latest series' },
  { name: 'Ongoing Series', label: 'Ongoing Series' },
  { name: 'VJ JUNIOR SERIES', label: 'VJ JUNIOR SERIES' },
  { name: 'Asian series', label: 'Asian series' },
  { name: 'Western series', label: 'Western series' },
  { name: 'Other vjs', label: 'Other vjs' },
  { name: 'Trending on tiktok', label: 'Tag as Trending on TikTok' },
] as const;

const MODE_CONFIG: Array<{
  id: SeriesMode;
  label: string;
  description: string;
  icon: typeof Clapperboard;
}> = [
  {
    id: 'upload-episode',
    label: 'Upload Episode',
    description: 'Pick an existing series, choose the right season, and publish one episode.',
    icon: Clapperboard,
  },
  {
    id: 'add-season',
    label: 'Add New Season',
    description: 'Open an existing series, create the next season, and upload its first episode.',
    icon: FolderPlus,
  },
  {
    id: 'create-series',
    label: 'Create New Series',
    description: 'Set up a brand new series, create Season 1, and upload Episode 1.',
    icon: Sparkles,
  },
];

function createEmptySourceDraft(): EpisodeSourceDraft {
  return { mode: 'upload', file: null, url: '' };
}

function createEmptyUploadEpisodeDraft(): UploadEpisodeDraft {
  return {
    seasonNumber: '',
    episodeNumber: '',
    episodeTitle: '',
    episodeDescription: '',
    seasonPosterUrl: '',
    source: createEmptySourceDraft(),
  };
}

function createEmptyAddSeasonDraft(): AddSeasonDraft {
  return {
    seasonNumber: '',
    seasonTitle: '',
    seasonOverview: '',
    seasonPosterUrl: '',
    episodeNumber: '1',
    episodeTitle: 'Episode 1',
    episodeDescription: '',
    source: createEmptySourceDraft(),
  };
}

function createEmptyCreateSeriesDraft(): CreateSeriesDraft {
  return {
    tmdbId: null,
    title: '',
    description: '',
    releaseYear: '',
    language: '',
    vj: 'Unknown',
    genres: '',
    tags: '',
    categories: [],
    seasonTitle: 'Season 1',
    seasonOverview: '',
    seasonPosterUrl: '',
    episodeNumber: '1',
    episodeTitle: 'Episode 1',
    episodeDescription: '',
    source: createEmptySourceDraft(),
  };
}

function buildTmdbPosterUrl(path?: string | null) {
  return path ? `https://image.tmdb.org/t/p/w780${path}` : '';
}

function splitCommaList(value: string) {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 MB';
  }

  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSpeed(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 MB/s';
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatEta(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) {
    return '--';
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function clampLogLines(lines: string[]) {
  return lines.slice(-20);
}

function formatPublishStatus(baseMessage: string, queuedNormalizationCount: number) {
  return queuedNormalizationCount > 0
    ? `${baseMessage} The video is uploaded and now being processed into an iPhone-safe MP4 before it goes live.`
    : baseMessage;
}

const SERIES_LINK_QUEUE_HELP =
  'This MP4 link will be queued through the same browser-safe processing pipeline used for movie uploads before it goes live.';

function getTmdbLanguageLabel(details: TmdbTvDetails | null) {
  if (!details) {
    return '';
  }

  const spokenLanguage = details.spoken_languages?.find(
    (entry) => entry.english_name?.trim() || entry.name?.trim()
  );

  return (
    spokenLanguage?.english_name?.trim() ||
    spokenLanguage?.name?.trim() ||
    details.original_language?.toUpperCase() ||
    ''
  );
}

function getTmdbKeywordList(details: TmdbTvDetails | null) {
  return (details?.keywords?.results || []).map((entry) => entry.name).filter(Boolean).slice(0, 8);
}

function sortSeasons(seasons: Season[]) {
  return [...seasons].sort((left, right) => left.seasonNumber - right.seasonNumber);
}

function countSeriesEpisodes(series: Movie) {
  return (series.seasons || []).reduce(
    (total, season) => total + (season.episodes || []).length,
    0
  );
}

function getLastSeason(series: Movie) {
  return sortSeasons(series.seasons || []).slice(-1)[0] || null;
}

function getSeasonByNumber(series: Movie, seasonNumber: number) {
  return (
    (series.seasons || []).find(
      (season) => Number(season.seasonNumber) === Number(seasonNumber)
    ) || null
  );
}

function getStoredSeasonPoster(season: Season | null) {
  if (!season) {
    return '';
  }

  return season.poster || season.episodes?.[0]?.poster || '';
}

function getNextEpisodeNumber(season: Season | null) {
  if (!season) {
    return 1;
  }

  const lastEpisode = [...(season.episodes || [])]
    .sort((left, right) => left.episodeNumber - right.episodeNumber)
    .slice(-1)[0];

  return (lastEpisode?.episodeNumber || 0) + 1;
}

function getNextSeasonNumber(series: Movie) {
  const lastSeason = getLastSeason(series);
  return (lastSeason?.seasonNumber || 0) + 1;
}

function parsePositiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseReleaseYear(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1800 ? parsed : null;
}

function ModeButton({
  active,
  icon: Icon,
  label,
  description,
  onClick,
}: {
  active: boolean;
  icon: typeof Clapperboard;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[24px] border px-4 py-4 text-left transition-all duration-200 ${
        active
          ? 'border-[#D90429]/40 bg-[#19070C] text-white shadow-[0_14px_30px_rgba(217,4,41,0.12)]'
          : 'border-white/10 bg-[#0C1017] text-white/72 hover:border-[#D90429]/24 hover:bg-[#121722]'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
            active
              ? 'border-[#D90429]/35 bg-[#D90429]/12 text-[#FF9AAA]'
              : 'border-white/10 bg-white/5 text-white/60'
          }`}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-black uppercase tracking-[0.18em]">{label}</div>
          <div className={`mt-2 text-xs leading-6 ${active ? 'text-white/78' : 'text-white/55'}`}>
            {description}
          </div>
        </div>
      </div>
    </button>
  );
}

export function AdminSeriesUploadView() {
  const diagnosticsRef = useRef<HTMLDivElement | null>(null);
  const [seriesItems, setSeriesItems] = useState<Movie[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [mode, setMode] = useState<SeriesMode>('upload-episode');
  const [createSeriesEntryMode, setCreateSeriesEntryMode] = useState<'tmdb' | 'manual'>('tmdb');
  const [seriesSearch, setSeriesSearch] = useState('');
  const [selectedSeriesId, setSelectedSeriesId] = useState('');
  const [uploadEpisodeDraft, setUploadEpisodeDraft] = useState<UploadEpisodeDraft>(
    createEmptyUploadEpisodeDraft()
  );
  const [addSeasonDraft, setAddSeasonDraft] = useState<AddSeasonDraft>(
    createEmptyAddSeasonDraft()
  );
  const [createSeriesDraft, setCreateSeriesDraft] = useState<CreateSeriesDraft>(
    createEmptyCreateSeriesDraft()
  );
  const [seriesTmdbQuery, setSeriesTmdbQuery] = useState('');
  const [seriesTmdbResults, setSeriesTmdbResults] = useState<TmdbTvResult[]>([]);
  const [seriesTmdbLoading, setSeriesTmdbLoading] = useState(false);
  const [seriesTmdbDetailsLoading, setSeriesTmdbDetailsLoading] = useState(false);
  const [selectedSeriesTmdb, setSelectedSeriesTmdb] = useState<TmdbTvResult | null>(null);
  const [selectedSeriesTmdbDetails, setSelectedSeriesTmdbDetails] = useState<TmdbTvDetails | null>(
    null
  );
  const [showSeriesTmdbResults, setShowSeriesTmdbResults] = useState(false);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState('');
  const [uploadEpisodeSeasonPosterFile, setUploadEpisodeSeasonPosterFile] = useState<File | null>(
    null
  );
  const [uploadEpisodeSeasonPosterPreview, setUploadEpisodeSeasonPosterPreview] = useState('');
  const [addSeasonPosterFile, setAddSeasonPosterFile] = useState<File | null>(null);
  const [addSeasonPosterPreview, setAddSeasonPosterPreview] = useState('');
  const [episodeFileKey, setEpisodeFileKey] = useState(0);
  const [episodeSeasonPosterFileKey, setEpisodeSeasonPosterFileKey] = useState(0);
  const [newSeasonFileKey, setNewSeasonFileKey] = useState(0);
  const [newSeasonPosterFileKey, setNewSeasonPosterFileKey] = useState(0);
  const [newSeriesEpisodeFileKey, setNewSeriesEpisodeFileKey] = useState(0);
  const [newSeriesPosterFileKey, setNewSeriesPosterFileKey] = useState(0);
  const [uploadEpisodeSeasonTmdb, setUploadEpisodeSeasonTmdb] =
    useState<TmdbSeasonDetails | null>(null);
  const [uploadEpisodeSeasonTmdbLoading, setUploadEpisodeSeasonTmdbLoading] = useState(false);
  const [addSeasonTmdb, setAddSeasonTmdb] = useState<TmdbSeasonDetails | null>(null);
  const [addSeasonTmdbLoading, setAddSeasonTmdbLoading] = useState(false);
  const [uploadStats, setUploadStats] = useState<MultipartUploadStats | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const appendDiagnostic = (message: string) => {
    const trimmed = message.trim();

    if (!trimmed) {
      return;
    }

    setDiagnostics((current) => clampLogLines([...current, trimmed]));
  };

  const loadControlCenter = async (showSpinner = true, force = false) => {
    if (showSpinner) {
      setLoading(true);
    }

    try {
      const [moviesPayload, categoriesPayload] = await Promise.all([
        fetchAdminJson<{ movies?: Movie[] }>('/api/admin/movies', { force }),
        fetchAdminJson<{ categories?: AdminCategory[] }>('/api/admin/categories', { force }),
      ]);

      const nextSeriesItems = (moviesPayload.movies || [])
        .filter((movie) => movie.contentType === 'series')
        .sort((left, right) => left.title.localeCompare(right.title));

      setSeriesItems(nextSeriesItems);
      setCategories(categoriesPayload.categories || []);
      return nextSeriesItems;
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to load series workspace.'
      );
      return null;
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadControlCenter();
  }, []);

  useEffect(() => {
    if (!posterFile) {
      setPosterPreview('');
      return;
    }

    const previewUrl = URL.createObjectURL(posterFile);
    setPosterPreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [posterFile]);

  useEffect(() => {
    if (!uploadEpisodeSeasonPosterFile) {
      setUploadEpisodeSeasonPosterPreview('');
      return;
    }

    const previewUrl = URL.createObjectURL(uploadEpisodeSeasonPosterFile);
    setUploadEpisodeSeasonPosterPreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [uploadEpisodeSeasonPosterFile]);

  useEffect(() => {
    if (!addSeasonPosterFile) {
      setAddSeasonPosterPreview('');
      return;
    }

    const previewUrl = URL.createObjectURL(addSeasonPosterFile);
    setAddSeasonPosterPreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [addSeasonPosterFile]);

  useEffect(() => {
    if (!diagnosticsRef.current) {
      return;
    }

    diagnosticsRef.current.scrollTop = diagnosticsRef.current.scrollHeight;
  }, [diagnostics]);

  const filteredSeries = useMemo(() => {
    const search = seriesSearch.trim().toLowerCase();

    if (!search) {
      return seriesItems;
    }

    return seriesItems.filter((series) =>
      `${series.title} ${series.vj || ''} ${(series.category || []).join(' ')}`
        .toLowerCase()
        .includes(search)
    );
  }, [seriesItems, seriesSearch]);

  const selectedSeries = useMemo(
    () => seriesItems.find((series) => series.id === selectedSeriesId) || null,
    [selectedSeriesId, seriesItems]
  );

  const manualSeriesCategories = useMemo(() => {
    const categoryMap = new Map(categories.map((category) => [category.name, category]));

    return SERIES_CATEGORY_OPTIONS.map((entry) => categoryMap.get(entry.name)).filter(
      (category): category is AdminCategory => Boolean(category)
    );
  }, [categories]);

  const categoryLabelMap = useMemo(
    () => new Map(SERIES_CATEGORY_OPTIONS.map((entry) => [entry.name, entry.label])),
    []
  );

  const currentSeriesPoster =
    posterPreview ||
    buildTmdbPosterUrl(selectedSeriesTmdbDetails?.poster_path || selectedSeriesTmdb?.poster_path);

  const applySeriesTmdbDetails = (
    details: TmdbTvDetails,
    result?: TmdbTvResult | null
  ) => {
    const firstSeason = (details.seasons || []).find((season) => season.season_number === 1) || null;

    setSelectedSeriesTmdb(result || null);
    setSelectedSeriesTmdbDetails(details);
    setCreateSeriesEntryMode('tmdb');
    setShowSeriesTmdbResults(false);
    setSeriesTmdbQuery(details.name || result?.name || '');
    setCreateSeriesDraft((current) => ({
      ...current,
      tmdbId: details.id,
      title: details.name || result?.name || current.title,
      description: details.overview || current.description,
      releaseYear: details.first_air_date?.slice(0, 4) || current.releaseYear,
      language: getTmdbLanguageLabel(details) || current.language,
      genres:
        details.genres?.map((genre) => genre.name).filter(Boolean).join(', ') || current.genres,
      tags: getTmdbKeywordList(details).join(', ') || current.tags,
      seasonTitle: firstSeason?.name || current.seasonTitle || 'Season 1',
      seasonOverview: firstSeason?.overview || current.seasonOverview,
      seasonPosterUrl: buildTmdbPosterUrl(firstSeason?.poster_path) || current.seasonPosterUrl,
    }));
  };

  const handleSeriesTmdbSearch = async () => {
    const query = seriesTmdbQuery.trim() || createSeriesDraft.title.trim();

    if (!query) {
      setErrorMessage('Enter a series title before searching TMDb.');
      return;
    }

    setSeriesTmdbLoading(true);
    setErrorMessage('');

    try {
      const response = await fetch(
        `/api/admin/tmdb?mediaType=tv&title=${encodeURIComponent(query)}`,
        {
          credentials: 'include',
          cache: 'no-store',
        }
      );
      const payload = (await response.json()) as TmdbTvResult[] | { error?: string };

      if (!response.ok) {
        throw new Error(
          !Array.isArray(payload) && payload.error ? payload.error : 'TMDb search failed.'
        );
      }

      setSeriesTmdbResults(Array.isArray(payload) ? payload : []);
      setShowSeriesTmdbResults(true);
      setCreateSeriesEntryMode('tmdb');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'TMDb search failed.');
    } finally {
      setSeriesTmdbLoading(false);
    }
  };

  const handlePickSeriesTmdb = async (result: TmdbTvResult) => {
    setSeriesTmdbDetailsLoading(true);
    setErrorMessage('');
    setSelectedSeriesTmdb(result);
    setSelectedSeriesTmdbDetails(null);
    setShowSeriesTmdbResults(false);

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
          'error' in payload && payload.error ? payload.error : 'Failed to load TMDb series details.'
        );
      }

      const details = payload as TmdbTvDetails;
      applySeriesTmdbDetails(details, result);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to load TMDb series details.'
      );
    } finally {
      setSeriesTmdbDetailsLoading(false);
    }
  };

  const applyExistingSeriesDefaults = (series: Movie) => {
    const lastSeason = getLastSeason(series);
    const uploadSeasonNumber = lastSeason?.seasonNumber || 1;
    const nextEpisode = getNextEpisodeNumber(lastSeason);
    const nextSeasonNumber = getNextSeasonNumber(series);

    setUploadEpisodeDraft({
      seasonNumber: String(uploadSeasonNumber),
      episodeNumber: String(nextEpisode),
      episodeTitle: `Episode ${nextEpisode}`,
      episodeDescription: '',
      seasonPosterUrl: getStoredSeasonPoster(lastSeason),
      source: createEmptySourceDraft(),
    });

    setAddSeasonDraft({
      seasonNumber: String(nextSeasonNumber),
      seasonTitle: `Season ${nextSeasonNumber}`,
      seasonOverview: '',
      seasonPosterUrl: '',
      episodeNumber: '1',
      episodeTitle: 'Episode 1',
      episodeDescription: '',
      source: createEmptySourceDraft(),
    });

    setUploadEpisodeSeasonPosterFile(null);
    setUploadEpisodeSeasonPosterPreview('');
    setAddSeasonPosterFile(null);
    setAddSeasonPosterPreview('');
    setUploadEpisodeSeasonTmdb(null);
    setUploadEpisodeSeasonTmdbLoading(false);
    setAddSeasonTmdb(null);
    setAddSeasonTmdbLoading(false);
    setEpisodeFileKey((current) => current + 1);
    setEpisodeSeasonPosterFileKey((current) => current + 1);
    setNewSeasonFileKey((current) => current + 1);
    setNewSeasonPosterFileKey((current) => current + 1);
  };

  useEffect(() => {
    if (mode === 'create-series') {
      return;
    }

    if (!seriesItems.length) {
      setSelectedSeriesId('');
      return;
    }

    if (!selectedSeriesId || !seriesItems.some((series) => series.id === selectedSeriesId)) {
      const nextSeries = seriesItems[0];
      setSelectedSeriesId(nextSeries.id);
      applyExistingSeriesDefaults(nextSeries);
    }
  }, [mode, selectedSeriesId, seriesItems]);

  useEffect(() => {
    if (!selectedSeries) {
      return;
    }

    const seasonNumber = parsePositiveInteger(
      uploadEpisodeDraft.seasonNumber,
      getLastSeason(selectedSeries)?.seasonNumber || 1
    );
    const targetSeason = getSeasonByNumber(selectedSeries, seasonNumber);

    if (!targetSeason) {
      return;
    }

    setUploadEpisodeDraft((current) => {
      if (current.seasonNumber !== String(seasonNumber)) {
        return current;
      }

      const nextPosterUrl = getStoredSeasonPoster(targetSeason);

      if (current.seasonPosterUrl === nextPosterUrl) {
        return current;
      }

      return {
        ...current,
        seasonPosterUrl: nextPosterUrl,
      };
    });

    setUploadEpisodeSeasonPosterFile(null);
    setUploadEpisodeSeasonPosterPreview('');
    setEpisodeSeasonPosterFileKey((current) => current + 1);
  }, [selectedSeries, uploadEpisodeDraft.seasonNumber]);

  useEffect(() => {
    if (!selectedSeries?.tmdb_id || !uploadEpisodeDraft.seasonNumber) {
      setUploadEpisodeSeasonTmdb(null);
      return;
    }

    const seasonNumber = parsePositiveInteger(
      uploadEpisodeDraft.seasonNumber,
      getLastSeason(selectedSeries)?.seasonNumber || 1
    );
    let cancelled = false;

    const loadSeasonDetails = async () => {
      setUploadEpisodeSeasonTmdbLoading(true);

      try {
        const response = await fetch(
          `/api/admin/tmdb?mediaType=tv&tmdbId=${encodeURIComponent(
            String(selectedSeries.tmdb_id)
          )}&seasonNumber=${encodeURIComponent(String(seasonNumber))}`,
          {
            credentials: 'include',
            cache: 'no-store',
          }
        );
        const payload = (await response.json()) as TmdbSeasonDetails | { error?: string };

        if (!response.ok || 'error' in payload) {
          throw new Error(
            'error' in payload && payload.error
              ? payload.error
              : 'Failed to load season details from TMDb.'
          );
        }

        if (cancelled) {
          return;
        }

        const seasonDetails = payload as TmdbSeasonDetails;
        setUploadEpisodeSeasonTmdb(seasonDetails);
        const storedSeason = getSeasonByNumber(selectedSeries, seasonNumber);
        const storedSeasonPoster = getStoredSeasonPoster(storedSeason);
        const tmdbPosterUrl = buildTmdbPosterUrl(seasonDetails.poster_path);

        if (!storedSeasonPoster && tmdbPosterUrl) {
          setUploadEpisodeDraft((current) =>
            current.seasonNumber === String(seasonNumber) && !current.seasonPosterUrl
              ? {
                  ...current,
                  seasonPosterUrl: tmdbPosterUrl,
                }
              : current
          );
        }
      } catch {
        if (!cancelled) {
          setUploadEpisodeSeasonTmdb(null);
        }
      } finally {
        if (!cancelled) {
          setUploadEpisodeSeasonTmdbLoading(false);
        }
      }
    };

    void loadSeasonDetails();

    return () => {
      cancelled = true;
    };
  }, [selectedSeries, uploadEpisodeDraft.seasonNumber]);

  useEffect(() => {
    if (!selectedSeries?.tmdb_id || !addSeasonDraft.seasonNumber) {
      setAddSeasonTmdb(null);
      return;
    }

    const seasonNumber = parsePositiveInteger(
      addSeasonDraft.seasonNumber,
      getNextSeasonNumber(selectedSeries)
    );
    let cancelled = false;

    const loadSeasonDetails = async () => {
      setAddSeasonTmdbLoading(true);

      try {
        const response = await fetch(
          `/api/admin/tmdb?mediaType=tv&tmdbId=${encodeURIComponent(
            String(selectedSeries.tmdb_id)
          )}&seasonNumber=${encodeURIComponent(String(seasonNumber))}`,
          {
            credentials: 'include',
            cache: 'no-store',
          }
        );
        const payload = (await response.json()) as TmdbSeasonDetails | { error?: string };

        if (!response.ok || 'error' in payload) {
          throw new Error(
            'error' in payload && payload.error
              ? payload.error
              : 'Failed to load season details from TMDb.'
          );
        }

        if (cancelled) {
          return;
        }

        const seasonDetails = payload as TmdbSeasonDetails;
        const tmdbPosterUrl = buildTmdbPosterUrl(seasonDetails.poster_path);
        setAddSeasonTmdb(seasonDetails);
        setAddSeasonDraft((current) => {
          const nextTitle =
            !current.seasonTitle.trim() || current.seasonTitle === `Season ${seasonNumber}`
              ? seasonDetails.name || `Season ${seasonNumber}`
              : current.seasonTitle;
          const nextOverview = !current.seasonOverview.trim()
            ? seasonDetails.overview || ''
            : current.seasonOverview;
          const nextPosterUrl = current.seasonPosterUrl || tmdbPosterUrl;

          if (
            nextTitle === current.seasonTitle &&
            nextOverview === current.seasonOverview &&
            nextPosterUrl === current.seasonPosterUrl
          ) {
            return current;
          }

          return {
            ...current,
            seasonTitle: nextTitle,
            seasonOverview: nextOverview,
            seasonPosterUrl: nextPosterUrl,
          };
        });
      } catch {
        if (!cancelled) {
          setAddSeasonTmdb(null);
        }
      } finally {
        if (!cancelled) {
          setAddSeasonTmdbLoading(false);
        }
      }
    };

    void loadSeasonDetails();

    return () => {
      cancelled = true;
    };
  }, [selectedSeries, addSeasonDraft.seasonNumber]);

  const resetPublishFeedback = () => {
    setUploadStats(null);
    setDiagnostics([]);
    setStatusMessage('');
    setErrorMessage('');
  };

  const resolveEpisodeSource = async (source: EpisodeSourceDraft) => {
      if (source.mode === 'upload') {
        if (!source.file) {
          throw new Error('Choose a video file before publishing.');
      }

      const uploadedAsset = await uploadMultipartFileToAdmin({
        file: source.file,
        stage: 'final',
        onProgress: () => undefined,
        onStats: setUploadStats,
        onDiagnostic: appendDiagnostic,
      });

      return {
        video_url: uploadedAsset.publicUrl,
        sourceUrl: uploadedAsset.publicUrl,
        sourceFileName: uploadedAsset.fileName,
        sourceType: 'direct_upload' as const,
        sourcePipeline: 'direct_upload' as const,
      };
    }

    const trimmedUrl = source.url.trim();

    if (!trimmedUrl) {
      throw new Error('Paste the direct MP4 link before publishing.');
    }

    return {
      video_url: trimmedUrl,
      sourceUrl: trimmedUrl,
      sourceFileName: trimmedUrl.split('/').pop() || '',
      sourceType: 'direct_upload' as const,
      sourcePipeline: 'direct_upload' as const,
    };
  };

  const buildEpisodePayload = async (options: {
    episodeNumber: number;
    episodeTitle: string;
    episodeDescription: string;
    source: EpisodeSourceDraft;
    fallbackPoster: string;
  }) => {
    const resolvedSource = await resolveEpisodeSource(options.source);

    return {
      episodeNumber: options.episodeNumber,
      title: options.episodeTitle.trim() || `Episode ${options.episodeNumber}`,
      description: options.episodeDescription.trim(),
      poster: options.fallbackPoster,
      thumbnail: options.fallbackPoster,
      ...resolvedSource,
    };
  };

  const publishExistingSeries = async (movieId: string, nextSeasons: Season[]) => {
    const response = await fetch(`/api/admin/movies/${movieId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        movie: {
          contentType: 'series',
          seasons: nextSeasons,
        },
      }),
    });
    const result = await parseApiResponse(response);

    if (!result.ok) {
      throw new Error(result.payload.error || 'Failed to save series changes.');
    }

    return result.payload;
  };

  const handleDeleteSeries = async (series: Movie) => {
    const confirmed = window.confirm(`Delete "${series.title}" from the catalog?`);

    if (!confirmed) {
      return;
    }

    setPublishing(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const response = await fetch(`/api/admin/movies/${series.id}`, { method: 'DELETE' });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to delete series.');
      }

      const refreshedSeries = await loadControlCenter(false, true);

      if (selectedSeriesId === series.id) {
        if (refreshedSeries && refreshedSeries.length) {
          const nextSeries = refreshedSeries[0];
          setSelectedSeriesId(nextSeries.id);
          applyExistingSeriesDefaults(nextSeries);
        } else {
          setSelectedSeriesId('');
        }
      }

      setStatusMessage(`Deleted "${series.title}".`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete series.');
    } finally {
      setPublishing(false);
    }
  };

  const handlePublish = async () => {
    resetPublishFeedback();
    setPublishing(true);

    try {
      if (mode === 'upload-episode') {
        if (!selectedSeries) {
          throw new Error('Select an existing series before publishing.');
        }

        const seasonNumber = parsePositiveInteger(uploadEpisodeDraft.seasonNumber, 1);
        const targetSeason = getSeasonByNumber(selectedSeries, seasonNumber);

        if (!targetSeason) {
          throw new Error('Choose an existing season before publishing.');
        }

        const episodeNumber = parsePositiveInteger(
          uploadEpisodeDraft.episodeNumber,
          getNextEpisodeNumber(targetSeason)
        );
        const uploadedSeasonPoster = uploadEpisodeSeasonPosterFile
          ? await uploadPosterToAdmin(uploadEpisodeSeasonPosterFile)
          : null;
        const seasonPosterUrl =
          uploadedSeasonPoster?.publicUrl ||
          uploadEpisodeDraft.seasonPosterUrl ||
          buildTmdbPosterUrl(uploadEpisodeSeasonTmdb?.poster_path) ||
          getStoredSeasonPoster(targetSeason) ||
          selectedSeries.poster ||
          '';
        const episodePayload = await buildEpisodePayload({
          episodeNumber,
          episodeTitle: uploadEpisodeDraft.episodeTitle,
          episodeDescription: uploadEpisodeDraft.episodeDescription,
          source: uploadEpisodeDraft.source,
          fallbackPoster: seasonPosterUrl || targetSeason.episodes[0]?.poster || selectedSeries.poster || '',
        });

        const nextSeasons = sortSeasons(selectedSeries.seasons || []).map((season) =>
          season.seasonNumber !== targetSeason.seasonNumber
            ? season
            : {
                ...season,
                poster: seasonPosterUrl,
                overview: season.overview || uploadEpisodeSeasonTmdb?.overview || '',
                tmdb_id: season.tmdb_id ?? uploadEpisodeSeasonTmdb?.id ?? null,
                episodes: [...(season.episodes || []), episodePayload].sort(
                  (left, right) => left.episodeNumber - right.episodeNumber
                ),
              }
        );

        const publishResult = await publishExistingSeries(selectedSeries.id, nextSeasons);
        const refreshedSeries = await loadControlCenter(false, true);
        const updatedSeries =
          refreshedSeries?.find((series) => series.id === selectedSeries.id) || null;

        if (updatedSeries) {
          setSelectedSeriesId(updatedSeries.id);
          applyExistingSeriesDefaults(updatedSeries);
        }

        setStatusMessage(
          formatPublishStatus(
            `Added ${episodePayload.title} to ${selectedSeries.title} / ${
              targetSeason.title || `Season ${targetSeason.seasonNumber}`
            }.`,
            Number(publishResult.queuedNormalizationCount || 0)
          )
        );
      }

      if (mode === 'add-season') {
        if (!selectedSeries) {
          throw new Error('Select an existing series before creating a new season.');
        }

        const seasonNumber = parsePositiveInteger(
          addSeasonDraft.seasonNumber,
          getNextSeasonNumber(selectedSeries)
        );

        if (getSeasonByNumber(selectedSeries, seasonNumber)) {
          throw new Error(`Season ${seasonNumber} already exists on this series.`);
        }

        const episodeNumber = parsePositiveInteger(addSeasonDraft.episodeNumber, 1);
        const uploadedSeasonPoster = addSeasonPosterFile
          ? await uploadPosterToAdmin(addSeasonPosterFile)
          : null;
        const seasonPosterUrl =
          uploadedSeasonPoster?.publicUrl ||
          addSeasonDraft.seasonPosterUrl ||
          buildTmdbPosterUrl(addSeasonTmdb?.poster_path) ||
          selectedSeries.poster ||
          '';
        const episodePayload = await buildEpisodePayload({
          episodeNumber,
          episodeTitle: addSeasonDraft.episodeTitle,
          episodeDescription: addSeasonDraft.episodeDescription,
          source: addSeasonDraft.source,
          fallbackPoster: seasonPosterUrl || selectedSeries.poster || '',
        });

        const nextSeason: Season = {
          seasonNumber,
          title: addSeasonDraft.seasonTitle.trim() || `Season ${seasonNumber}`,
          overview: addSeasonDraft.seasonOverview.trim() || addSeasonTmdb?.overview || '',
          poster: seasonPosterUrl,
          tmdb_id: addSeasonTmdb?.id ?? null,
          episodes: [episodePayload],
        };

        const nextSeasons = [...(selectedSeries.seasons || []), nextSeason].sort(
          (left, right) => left.seasonNumber - right.seasonNumber
        );

        const publishResult = await publishExistingSeries(selectedSeries.id, nextSeasons);
        const refreshedSeries = await loadControlCenter(false, true);
        const updatedSeries =
          refreshedSeries?.find((series) => series.id === selectedSeries.id) || null;

        if (updatedSeries) {
          setSelectedSeriesId(updatedSeries.id);
          applyExistingSeriesDefaults(updatedSeries);
        }

        setStatusMessage(
          formatPublishStatus(
            `Created ${nextSeason.title} and published ${episodePayload.title} on ${selectedSeries.title}.`,
            Number(publishResult.queuedNormalizationCount || 0)
          )
        );
      }

      if (mode === 'create-series') {
        if (!createSeriesDraft.title.trim()) {
          throw new Error('Series title is required.');
        }

        const posterUrl = posterFile
          ? (await uploadPosterToAdmin(posterFile)).publicUrl
          : currentSeriesPoster;
        const firstSeasonPosterUrl = createSeriesDraft.seasonPosterUrl || posterUrl || '';
        const firstSeasonTmdb =
          selectedSeriesTmdbDetails?.seasons?.find((season) => season.season_number === 1) || null;
        const episodeNumber = parsePositiveInteger(createSeriesDraft.episodeNumber, 1);
        const episodePayload = await buildEpisodePayload({
          episodeNumber,
          episodeTitle: createSeriesDraft.episodeTitle,
          episodeDescription: createSeriesDraft.episodeDescription,
          source: createSeriesDraft.source,
          fallbackPoster: firstSeasonPosterUrl || posterUrl,
        });

        const response = await fetch('/api/admin/movies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            movie: {
              contentType: 'series',
              title: createSeriesDraft.title.trim(),
              description: createSeriesDraft.description.trim(),
              poster: posterUrl,
              releaseYear: parseReleaseYear(createSeriesDraft.releaseYear),
              language: createSeriesDraft.language.trim(),
              vj: createSeriesDraft.vj.trim() || 'Unknown',
              genres: splitCommaList(createSeriesDraft.genres),
              tags: splitCommaList(createSeriesDraft.tags),
              accessTier: 'premium',
              is_trending_tiktok: createSeriesDraft.categories.includes('Trending on tiktok'),
              category: createSeriesDraft.categories,
              tmdb_id: createSeriesDraft.tmdbId,
              seasons: [
                {
                  seasonNumber: 1,
                  title: createSeriesDraft.seasonTitle.trim() || 'Season 1',
                  overview: createSeriesDraft.seasonOverview.trim(),
                  poster: firstSeasonPosterUrl,
                  tmdb_id: firstSeasonTmdb?.id ?? null,
                  episodes: [episodePayload],
                },
              ],
            },
          }),
        });
        const result = await parseApiResponse(response);

        if (!result.ok) {
          throw new Error(result.payload.error || 'Failed to create series.');
        }

        const createdSeriesId = String(result.payload.movie?.id || '');
        const createdSeriesTitle = createSeriesDraft.title.trim();
        const refreshedSeries = await loadControlCenter(false, true);
        const createdSeries =
          refreshedSeries?.find((series) => series.id === createdSeriesId) || null;

        setCreateSeriesDraft(createEmptyCreateSeriesDraft());
        setCreateSeriesEntryMode('tmdb');
        setSeriesTmdbQuery('');
        setSeriesTmdbResults([]);
        setSelectedSeriesTmdb(null);
        setSelectedSeriesTmdbDetails(null);
        setShowSeriesTmdbResults(false);
        setPosterFile(null);
        setPosterPreview('');
        setNewSeriesEpisodeFileKey((current) => current + 1);
        setNewSeriesPosterFileKey((current) => current + 1);

        if (createdSeries) {
          setSelectedSeriesId(createdSeries.id);
          applyExistingSeriesDefaults(createdSeries);
        }

        setMode('upload-episode');
        setStatusMessage(
          formatPublishStatus(
            `Created series "${createdSeriesTitle}".`,
            Number(result.payload.queuedNormalizationCount || 0)
          )
        );
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to publish series.');
      appendDiagnostic('[STOP] Series upload paused before completion.');
    } finally {
      setPublishing(false);
    }
  };

  const handleSelectSeries = (series: Movie) => {
    setSelectedSeriesId(series.id);
    setErrorMessage('');
    setStatusMessage(`Selected "${series.title}".`);
    applyExistingSeriesDefaults(series);
  };

  const selectedSeriesSummary = selectedSeries
    ? {
        seasons: (selectedSeries.seasons || []).length,
        episodes: countSeriesEpisodes(selectedSeries),
      }
    : null;
  const selectedSeriesSeasons = selectedSeries ? sortSeasons(selectedSeries.seasons || []) : [];
  const selectedUploadSeason = selectedSeries
    ? getSeasonByNumber(
        selectedSeries,
        parsePositiveInteger(
          uploadEpisodeDraft.seasonNumber,
          getLastSeason(selectedSeries)?.seasonNumber || 1
        )
      )
    : null;
  const selectedCreateSeasonOneTmdb =
    selectedSeriesTmdbDetails?.seasons?.find((season) => season.season_number === 1) || null;
  const createSeriesFormVisible =
    createSeriesEntryMode === 'manual' || Boolean(selectedSeriesTmdbDetails || selectedSeriesTmdb);
  const uploadEpisodePosterPreviewUrl =
    uploadEpisodeSeasonPosterPreview ||
    uploadEpisodeDraft.seasonPosterUrl ||
    buildTmdbPosterUrl(uploadEpisodeSeasonTmdb?.poster_path) ||
    getStoredSeasonPoster(selectedUploadSeason) ||
    selectedSeries?.poster ||
    '';
  const addSeasonPosterPreviewUrl =
    addSeasonPosterPreview ||
    addSeasonDraft.seasonPosterUrl ||
    buildTmdbPosterUrl(addSeasonTmdb?.poster_path) ||
    selectedSeries?.poster ||
    '';

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0B0C10] px-4 py-8 text-white md:px-8 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-[32px] border border-white/10 bg-[#11141C] p-6 text-sm text-white/55">
          Loading series workspace...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 py-8 text-white md:px-8 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-[#D90429]/18 bg-[linear-gradient(180deg,rgba(23,9,13,0.96),rgba(17,20,28,0.94))] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.3em] text-white/45">
                Series
              </div>
              <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.14em] text-white md:text-4xl">
                Series Upload Tool
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/68">
                One episode at a time, one season at a time, with a cleaner workflow that keeps
                every upload pointed at the correct series.
              </p>
            </div>
            <Link
              href="/admin"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-white transition-colors hover:bg-white/10"
            >
              <ArrowLeft size={14} />
              Back To Dashboard
            </Link>
          </div>
        </header>

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

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-6">
            <Card
              title="Choose Workflow"
              description="Keep the page focused. Only the fields for the workflow you are using stay visible."
              className="border-[#D90429]/14 bg-[linear-gradient(180deg,rgba(20,10,14,0.94),rgba(17,20,28,0.9))]"
            >
              <div className="space-y-3">
                {MODE_CONFIG.map((entry) => (
                  <ModeButton
                    key={entry.id}
                    active={mode === entry.id}
                    icon={entry.icon}
                    label={entry.label}
                    description={entry.description}
                    onClick={() => {
                      setMode(entry.id);
                      setErrorMessage('');

                      if (
                        (entry.id === 'upload-episode' || entry.id === 'add-season') &&
                        selectedSeries
                      ) {
                        applyExistingSeriesDefaults(selectedSeries);
                      }
                    }}
                  />
                ))}
              </div>
            </Card>

            {mode !== 'create-series' && (
              <Card
                title="Find Existing Series"
                description="Search once, select the exact series, and keep every new upload inside the right season."
              >
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                  <TextInput
                    value={seriesSearch}
                    onChange={(event) => setSeriesSearch(event.target.value)}
                    placeholder="Search existing series..."
                    className="pl-10"
                  />
                </div>

                {filteredSeries.length ? (
                  <div className="mt-4 space-y-3">
                    {filteredSeries.map((series) => {
                      const active = selectedSeriesId === series.id;

                      return (
                        <div
                          key={series.id}
                          className={`rounded-2xl border px-4 py-4 transition-colors ${
                            active
                              ? 'border-[#D90429]/35 bg-[#17070B]'
                              : 'border-white/10 bg-black/20'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-white">
                                {series.title}
                              </div>
                              <div className="mt-2 text-xs leading-6 text-white/55">
                                {(series.seasons || []).length} season(s) |{' '}
                                {countSeriesEpisodes(series)} episode(s)
                              </div>
                              <div className="text-xs leading-6 text-white/42">
                                {series.vj || 'Unknown'} |{' '}
                                {(series.category || []).slice(0, 2).join(', ') ||
                                  'No manual categories'}
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Link
                                href={`/admin/series/${series.id}`}
                                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                              >
                                <PencilLine size={12} />
                                Edit
                              </Link>
                              <button
                                type="button"
                                onClick={() => handleSelectSeries(series)}
                                className={`rounded-full px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] ${
                                  active
                                    ? 'bg-[#D90429] text-white'
                                    : 'border border-white/10 bg-white/5 text-white'
                                }`}
                              >
                                {active ? 'Selected' : 'Select'}
                              </button>
                              <button
                                type="button"
                                disabled={publishing}
                                onClick={() => void handleDeleteSeries(series)}
                                className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100 disabled:opacity-60"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">
                    No series matched this search. Switch to Create New Series to publish the first
                    episode of a brand new title.
                  </div>
                )}
              </Card>
            )}
          </div>
          <div className="space-y-6">
            {mode !== 'create-series' && selectedSeries && (
              <Card
                title={mode === 'upload-episode' ? 'Selected Series' : 'Season Target'}
                description={
                  mode === 'upload-episode'
                    ? 'Review the series and choose the exact season that should receive the next episode.'
                    : 'Confirm the series before creating the next season and placing Episode 1 inside it.'
                }
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-black text-white">{selectedSeries.title}</div>
                      <div className="mt-2 text-xs uppercase tracking-[0.18em] text-white/45">
                        {selectedSeriesSummary?.seasons || 0} seasons | {selectedSeriesSummary?.episodes || 0} episodes
                      </div>
                    </div>
                    {mode === 'upload-episode' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('add-season');
                          applyExistingSeriesDefaults(selectedSeries);
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                      >
                        <FolderPlus size={14} />
                        Add New Season
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selectedSeriesSeasons.map((season) => (
                      <div
                        key={season.seasonNumber}
                        className="rounded-full border border-white/10 bg-black/20 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white/78"
                      >
                        {season.title || `Season ${season.seasonNumber}`} | {(season.episodes || []).length} eps
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            {mode === 'upload-episode' && (
              <Card
                title="Upload Episode"
                description="Pick the existing season, confirm the next episode details, and upload one local MP4 or MKV file, or use a direct MP4 link."
                className="border-[#D90429]/18 bg-[linear-gradient(180deg,rgba(23,9,13,0.94),rgba(17,20,28,0.94))] shadow-[0_24px_70px_rgba(0,0,0,0.42)]"
                headerClassName="rounded-[26px] border border-[#D90429]/18 bg-[linear-gradient(180deg,rgba(217,4,41,0.12),rgba(255,255,255,0.01))] px-4 py-4 md:px-5"
                titleClassName="text-lg tracking-[0.2em] text-white"
                descriptionClassName="max-w-2xl text-white/72"
              >
                {selectedSeries ? (
                  <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <FieldLabel>Season</FieldLabel>
                        <SelectInput
                          value={uploadEpisodeDraft.seasonNumber}
                          onChange={(event) => {
                            const seasonNumber = Number(event.target.value);
                            const nextSeason = getSeasonByNumber(selectedSeries, seasonNumber);
                            const nextEpisodeNumber = getNextEpisodeNumber(nextSeason);

                            setUploadEpisodeDraft((current) => ({
                              ...current,
                              seasonNumber: event.target.value,
                              episodeNumber: String(nextEpisodeNumber),
                              episodeTitle: `Episode ${nextEpisodeNumber}`,
                            }));
                          }}
                        >
                          {selectedSeriesSeasons.map((season) => (
                            <option key={season.seasonNumber} value={season.seasonNumber}>
                              {season.title || `Season ${season.seasonNumber}`}
                            </option>
                          ))}
                        </SelectInput>
                        {selectedUploadSeason && (
                          <div className="mt-2 text-xs leading-6 text-white/50">
                            {(selectedUploadSeason.episodes || []).length} episode(s) already live in this season.
                          </div>
                        )}
                      </div>
                      <div>
                        <FieldLabel>Episode Number</FieldLabel>
                        <TextInput
                          value={uploadEpisodeDraft.episodeNumber}
                          onChange={(event) =>
                            setUploadEpisodeDraft((current) => ({
                              ...current,
                              episodeNumber: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="md:col-span-2">
                        <FieldLabel>Episode Title</FieldLabel>
                        <TextInput
                          value={uploadEpisodeDraft.episodeTitle}
                          onChange={(event) =>
                            setUploadEpisodeDraft((current) => ({
                              ...current,
                              episodeTitle: event.target.value,
                            }))
                          }
                          placeholder="Episode title"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <FieldLabel>Short Description</FieldLabel>
                        <TextArea
                          rows={4}
                          value={uploadEpisodeDraft.episodeDescription}
                          onChange={(event) =>
                            setUploadEpisodeDraft((current) => ({
                              ...current,
                              episodeDescription: event.target.value,
                            }))
                          }
                          placeholder="Optional short description"
                        />
                      </div>
                    </div>

                    <div className="rounded-[26px] border border-white/10 bg-[#0C1017] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/62">
                            Season Poster
                          </div>
                          <div className="mt-2 text-xs leading-6 text-white/48">
                            Show the current season artwork, pull the TMDb season poster when it is
                            available, or upload a cleaner replacement before publishing.
                          </div>
                        </div>
                        {buildTmdbPosterUrl(uploadEpisodeSeasonTmdb?.poster_path) ? (
                          <button
                            type="button"
                            onClick={() =>
                              setUploadEpisodeDraft((current) => ({
                                ...current,
                                seasonPosterUrl: buildTmdbPosterUrl(
                                  uploadEpisodeSeasonTmdb?.poster_path
                                ),
                              }))
                            }
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                          >
                            Use TMDb Poster
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                        <div className="overflow-hidden rounded-[22px] border border-white/10 bg-black/20">
                          {uploadEpisodePosterPreviewUrl ? (
                            <img
                              src={uploadEpisodePosterPreviewUrl}
                              alt={selectedUploadSeason?.title || 'Season poster preview'}
                              className="h-full min-h-[280px] w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full min-h-[280px] items-center justify-center px-4 text-center text-sm text-white/35">
                              {uploadEpisodeSeasonTmdbLoading
                                ? 'Checking TMDb season poster...'
                                : 'No season poster available yet.'}
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs leading-6 text-white/58">
                            {selectedUploadSeason?.title || `Season ${uploadEpisodeDraft.seasonNumber}`}{' '}
                            | {selectedUploadSeason?.episodes?.length || 0} stored episode(s)
                          </div>
                          {uploadEpisodeSeasonTmdb?.overview ? (
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs leading-6 text-white/55">
                              {uploadEpisodeSeasonTmdb.overview}
                            </div>
                          ) : null}
                          <div>
                            <FieldLabel>Upload / Replace Season Poster</FieldLabel>
                            <input
                              key={episodeSeasonPosterFileKey}
                              type="file"
                              accept="image/*"
                              onChange={(event) =>
                                setUploadEpisodeSeasonPosterFile(
                                  event.target.files?.[0] || null
                                )
                              }
                              className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0A0D13] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-[26px] border border-white/10 bg-[#0C1017] p-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setUploadEpisodeDraft((current) => ({
                              ...current,
                              source: { ...current.source, mode: 'upload', url: '' },
                            }))
                          }
                          className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                            uploadEpisodeDraft.source.mode === 'upload'
                              ? 'bg-[#D90429] text-white'
                              : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          Upload Video
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setUploadEpisodeDraft((current) => ({
                              ...current,
                              source: { ...current.source, mode: 'link', file: null },
                            }))
                          }
                          className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                            uploadEpisodeDraft.source.mode === 'link'
                              ? 'bg-[#D90429] text-white'
                              : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          Use MP4 Link
                        </button>
                      </div>

                      {uploadEpisodeDraft.source.mode === 'upload' ? (
                        <div>
                          <FieldLabel>Episode Video File</FieldLabel>
                          <input
                            key={episodeFileKey}
                            type="file"
                            accept=".mp4,.mkv,video/mp4,video/x-matroska,video/mkv"
                            onChange={(event) =>
                              setUploadEpisodeDraft((current) => ({
                                ...current,
                                source: {
                                  ...current.source,
                                  file: event.target.files?.[0] || null,
                                },
                              }))
                            }
                            className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0A0D13] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
                          />
                        </div>
                      ) : (
                        <div>
                          <FieldLabel>Episode MP4 URL</FieldLabel>
                          <TextInput
                            value={uploadEpisodeDraft.source.url}
                            onChange={(event) =>
                              setUploadEpisodeDraft((current) => ({
                                ...current,
                                source: { ...current.source, url: event.target.value },
                              }))
                            }
                            placeholder="https://your-r2-public-url-or-existing-mp4-link.mp4"
                          />
                          <p className="mt-2 text-xs leading-6 text-white/45">
                            {SERIES_LINK_QUEUE_HELP}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap justify-end gap-3">
                      <button
                        type="button"
                        disabled={publishing}
                        onClick={() => void handlePublish()}
                        className="inline-flex items-center gap-2 rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                      >
                        <UploadCloud size={14} />
                        Publish Episode
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">
                    Select an existing series from the browser first, then the episode form will open here.
                  </div>
                )}
              </Card>
            )}

            {mode === 'add-season' && (
              <Card
                title="Add New Season"
                description="Create the next season on an existing series and upload Episode 1 immediately."
                className="border-[#D90429]/18 bg-[linear-gradient(180deg,rgba(23,9,13,0.94),rgba(17,20,28,0.94))] shadow-[0_24px_70px_rgba(0,0,0,0.42)]"
                headerClassName="rounded-[26px] border border-[#D90429]/18 bg-[linear-gradient(180deg,rgba(217,4,41,0.12),rgba(255,255,255,0.01))] px-4 py-4 md:px-5"
                titleClassName="text-lg tracking-[0.2em] text-white"
                descriptionClassName="max-w-2xl text-white/72"
              >
                {selectedSeries ? (
                  <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <FieldLabel>New Season Number</FieldLabel>
                        <TextInput
                          value={addSeasonDraft.seasonNumber}
                          onChange={(event) =>
                            setAddSeasonDraft((current) => ({
                              ...current,
                              seasonNumber: event.target.value,
                              seasonTitle:
                                current.seasonTitle === `Season ${current.seasonNumber}` ||
                                current.seasonTitle === (addSeasonTmdb?.name || '')
                                  ? `Season ${event.target.value || current.seasonNumber}`
                                  : current.seasonTitle,
                              seasonOverview:
                                current.seasonOverview === (addSeasonTmdb?.overview || '')
                                  ? ''
                                  : current.seasonOverview,
                              seasonPosterUrl:
                                current.seasonPosterUrl ===
                                buildTmdbPosterUrl(addSeasonTmdb?.poster_path)
                                  ? ''
                                  : current.seasonPosterUrl,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <FieldLabel>Season Name</FieldLabel>
                        <TextInput
                          value={addSeasonDraft.seasonTitle}
                          onChange={(event) =>
                            setAddSeasonDraft((current) => ({
                              ...current,
                              seasonTitle: event.target.value,
                            }))
                          }
                          placeholder="Season title"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <FieldLabel>Season Overview</FieldLabel>
                        <TextArea
                          rows={4}
                          value={addSeasonDraft.seasonOverview}
                          onChange={(event) =>
                            setAddSeasonDraft((current) => ({
                              ...current,
                              seasonOverview: event.target.value,
                            }))
                          }
                          placeholder="Optional season overview"
                        />
                      </div>
                      <div>
                        <FieldLabel>First Episode Number</FieldLabel>
                        <TextInput
                          value={addSeasonDraft.episodeNumber}
                          onChange={(event) =>
                            setAddSeasonDraft((current) => ({
                              ...current,
                              episodeNumber: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <FieldLabel>First Episode Title</FieldLabel>
                        <TextInput
                          value={addSeasonDraft.episodeTitle}
                          onChange={(event) =>
                            setAddSeasonDraft((current) => ({
                              ...current,
                              episodeTitle: event.target.value,
                            }))
                          }
                          placeholder="Episode 1"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <FieldLabel>Short Description</FieldLabel>
                        <TextArea
                          rows={4}
                          value={addSeasonDraft.episodeDescription}
                          onChange={(event) =>
                            setAddSeasonDraft((current) => ({
                              ...current,
                              episodeDescription: event.target.value,
                            }))
                          }
                          placeholder="Optional short description"
                        />
                      </div>
                    </div>

                    <div className="rounded-[26px] border border-white/10 bg-[#0C1017] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/62">
                            Season Poster
                          </div>
                          <div className="mt-2 text-xs leading-6 text-white/48">
                            Pull the season artwork from TMDb when it exists, or upload your own
                            poster before the first episode goes live.
                          </div>
                        </div>
                        {buildTmdbPosterUrl(addSeasonTmdb?.poster_path) ? (
                          <button
                            type="button"
                            onClick={() =>
                              setAddSeasonDraft((current) => ({
                                ...current,
                                seasonPosterUrl: buildTmdbPosterUrl(addSeasonTmdb?.poster_path),
                              }))
                            }
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                          >
                            Use TMDb Poster
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                        <div className="overflow-hidden rounded-[22px] border border-white/10 bg-black/20">
                          {addSeasonPosterPreviewUrl ? (
                            <img
                              src={addSeasonPosterPreviewUrl}
                              alt={addSeasonDraft.seasonTitle || 'Season poster preview'}
                              className="h-full min-h-[280px] w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full min-h-[280px] items-center justify-center px-4 text-center text-sm text-white/35">
                              {addSeasonTmdbLoading
                                ? 'Checking TMDb season poster...'
                                : 'No season poster selected yet.'}
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs leading-6 text-white/58">
                            {addSeasonDraft.seasonTitle || `Season ${addSeasonDraft.seasonNumber}`}{' '}
                            | Season {addSeasonDraft.seasonNumber}
                          </div>
                          {addSeasonTmdb?.overview ? (
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs leading-6 text-white/55">
                              {addSeasonTmdb.overview}
                            </div>
                          ) : null}
                          <div>
                            <FieldLabel>Upload / Replace Season Poster</FieldLabel>
                            <input
                              key={newSeasonPosterFileKey}
                              type="file"
                              accept="image/*"
                              onChange={(event) =>
                                setAddSeasonPosterFile(event.target.files?.[0] || null)
                              }
                              className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0A0D13] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-[26px] border border-white/10 bg-[#0C1017] p-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setAddSeasonDraft((current) => ({
                              ...current,
                              source: { ...current.source, mode: 'upload', url: '' },
                            }))
                          }
                          className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                            addSeasonDraft.source.mode === 'upload'
                              ? 'bg-[#D90429] text-white'
                              : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          Upload Video
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAddSeasonDraft((current) => ({
                              ...current,
                              source: { ...current.source, mode: 'link', file: null },
                            }))
                          }
                          className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                            addSeasonDraft.source.mode === 'link'
                              ? 'bg-[#D90429] text-white'
                              : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          Use MP4 Link
                        </button>
                      </div>

                      {addSeasonDraft.source.mode === 'upload' ? (
                        <div>
                          <FieldLabel>Season Premiere Video File</FieldLabel>
                          <input
                            key={newSeasonFileKey}
                            type="file"
                            accept=".mp4,.mkv,video/mp4,video/x-matroska,video/mkv"
                            onChange={(event) =>
                              setAddSeasonDraft((current) => ({
                                ...current,
                                source: {
                                  ...current.source,
                                  file: event.target.files?.[0] || null,
                                },
                              }))
                            }
                            className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0A0D13] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
                          />
                        </div>
                      ) : (
                        <div>
                          <FieldLabel>Season Premiere MP4 URL</FieldLabel>
                          <TextInput
                            value={addSeasonDraft.source.url}
                            onChange={(event) =>
                              setAddSeasonDraft((current) => ({
                                ...current,
                                source: { ...current.source, url: event.target.value },
                              }))
                            }
                            placeholder="https://your-r2-public-url-or-existing-mp4-link.mp4"
                          />
                          <p className="mt-2 text-xs leading-6 text-white/45">
                            {SERIES_LINK_QUEUE_HELP}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap justify-end gap-3">
                      <button
                        type="button"
                        disabled={publishing}
                        onClick={() => void handlePublish()}
                        className="inline-flex items-center gap-2 rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                      >
                        <UploadCloud size={14} />
                        Publish Season
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">
                    Select a series from the browser first, then the new season form will open here.
                  </div>
                )}
              </Card>
            )}

            {mode === 'create-series' && (
              <Fragment>
                <Card
                  title="Create New Series"
                  description="Search TMDb first, keep manual entry as the fallback, and start the series with Season 1 / Episode 1."
                  className="border-[#D90429]/18 bg-[linear-gradient(180deg,rgba(23,9,13,0.94),rgba(17,20,28,0.94))] shadow-[0_24px_70px_rgba(0,0,0,0.42)]"
                  headerClassName="rounded-[26px] border border-[#D90429]/18 bg-[linear-gradient(180deg,rgba(217,4,41,0.12),rgba(255,255,255,0.01))] px-4 py-4 md:px-5"
                  titleClassName="text-lg tracking-[0.2em] text-white"
                  descriptionClassName="max-w-2xl text-white/72"
                >
                  <div className="space-y-6">
                    <div className="rounded-[26px] border border-white/10 bg-[#0C1017] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/62">
                            TMDb Series Match
                          </div>
                          <div className="mt-2 text-xs leading-6 text-white/48">
                            Search the series title first so TMDb can fill the basics for you. If
                            the title is not on TMDb, switch to manual entry and keep going.
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setCreateSeriesEntryMode('tmdb')}
                            className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                              createSeriesEntryMode === 'tmdb'
                                ? 'bg-[#D90429] text-white'
                                : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            Use TMDb Match
                          </button>
                          <button
                            type="button"
                            onClick={() => setCreateSeriesEntryMode('manual')}
                            className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                              createSeriesEntryMode === 'manual'
                                ? 'bg-[#D90429] text-white'
                                : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            Enter Manually Instead
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                          <TextInput
                            value={seriesTmdbQuery}
                            onChange={(event) => setSeriesTmdbQuery(event.target.value)}
                            placeholder="Search TMDb for a series"
                            className="pl-10"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={seriesTmdbLoading || seriesTmdbDetailsLoading}
                          onClick={() => void handleSeriesTmdbSearch()}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                        >
                          {seriesTmdbLoading ? 'Searching...' : 'Search TMDb'}
                        </button>
                      </div>

                      {selectedSeriesTmdb ? (
                        <div className="mt-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/55">
                              Selected Match
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowSeriesTmdbResults(true)}
                              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                            >
                              Change Selection
                            </button>
                          </div>
                          <div className="overflow-hidden rounded-[24px] border border-[#D90429]/18 bg-black/20">
                            <div className="grid gap-0 grid-cols-[96px_1fr] sm:grid-cols-[112px_1fr]">
                              <div className="bg-black/20">
                                {buildTmdbPosterUrl(
                                  selectedSeriesTmdbDetails?.poster_path ||
                                    selectedSeriesTmdb.poster_path
                                ) ? (
                                  <img
                                    src={buildTmdbPosterUrl(
                                      selectedSeriesTmdbDetails?.poster_path ||
                                        selectedSeriesTmdb.poster_path
                                    )}
                                    alt={selectedSeriesTmdb.name}
                                    className="h-full min-h-[146px] w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full min-h-[146px] items-center justify-center px-2 text-center text-xs text-white/35">
                                    No poster
                                  </div>
                                )}
                              </div>
                              <div className="p-4">
                                <div className="text-sm font-black text-white sm:text-base">
                                  {selectedSeriesTmdbDetails?.name || selectedSeriesTmdb.name}
                                </div>
                                <div className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-white/45">
                                  {selectedSeriesTmdbDetails?.first_air_date?.slice(0, 4) ||
                                    selectedSeriesTmdb.first_air_date?.slice(0, 4) ||
                                    'No year'}
                                </div>
                                <p className="mt-3 line-clamp-4 text-xs leading-6 text-white/62 sm:text-sm">
                                  {selectedSeriesTmdbDetails?.overview ||
                                    selectedSeriesTmdb.overview ||
                                    'No TMDb overview available for this title.'}
                                </p>
                                {seriesTmdbDetailsLoading ? (
                                  <div className="mt-3 text-[11px] font-black uppercase tracking-[0.18em] text-white/40">
                                    Loading TMDb details...
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {showSeriesTmdbResults && seriesTmdbResults.length > 0 && (
                        <div className="mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-3">
                          {seriesTmdbResults.slice(0, 6).map((result) => (
                            <button
                              key={result.id}
                              type="button"
                              onClick={() => void handlePickSeriesTmdb(result)}
                              className="overflow-hidden rounded-[20px] border border-white/10 bg-black/20 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[#D90429]/30 hover:bg-black/30"
                            >
                              <div className="aspect-[2/3] bg-black/20">
                                {result.poster_path ? (
                                  <img
                                    src={buildTmdbPosterUrl(result.poster_path)}
                                    alt={result.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-white/35">
                                    No poster
                                  </div>
                                )}
                              </div>
                              <div className="p-2.5">
                                <div className="line-clamp-2 text-[11px] font-bold leading-4 text-white">
                                  {result.name}
                                </div>
                                <div className="mt-1 text-[10px] text-white/50">
                                  {result.first_air_date?.slice(0, 4) || 'No year'}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {createSeriesEntryMode === 'tmdb' &&
                      !selectedSeriesTmdb &&
                      !seriesTmdbResults.length ? (
                        <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">
                          Search TMDb first to auto-fill the series metadata, or switch to manual
                          entry if this title is not listed there.
                        </div>
                      ) : null}
                    </div>

                    {createSeriesFormVisible ? (
                      <div className="grid gap-6 xl:grid-cols-[1.05fr_1.2fr]">
                        <div className="space-y-4">
                          <div>
                            <FieldLabel>Series Title</FieldLabel>
                            <TextInput
                              value={createSeriesDraft.title}
                              onChange={(event) =>
                                setCreateSeriesDraft((current) => ({
                                  ...current,
                                  title: event.target.value,
                                }))
                              }
                              placeholder="Series title"
                            />
                          </div>
                          <div>
                            <FieldLabel>Series Poster</FieldLabel>
                            <input
                              key={newSeriesPosterFileKey}
                              type="file"
                              accept="image/*"
                              onChange={(event) => setPosterFile(event.target.files?.[0] || null)}
                              className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0C1017] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
                            />
                            {currentSeriesPoster ? (
                              <div className="mt-3 max-w-[220px] overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                                <img
                                  src={currentSeriesPoster}
                                  alt={createSeriesDraft.title || 'Series poster preview'}
                                  className="h-[320px] w-full object-cover"
                                />
                              </div>
                            ) : (
                              <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">
                                Search TMDb or upload a poster to preview artwork here.
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <FieldLabel>Description</FieldLabel>
                            <TextArea
                              rows={5}
                              value={createSeriesDraft.description}
                              onChange={(event) =>
                                setCreateSeriesDraft((current) => ({
                                  ...current,
                                  description: event.target.value,
                                }))
                              }
                              placeholder="Series description"
                            />
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <FieldLabel>Release Year</FieldLabel>
                              <TextInput
                                value={createSeriesDraft.releaseYear}
                                onChange={(event) =>
                                  setCreateSeriesDraft((current) => ({
                                    ...current,
                                    releaseYear: event.target.value,
                                  }))
                                }
                                placeholder="2026"
                              />
                            </div>
                            <div>
                              <FieldLabel>Language</FieldLabel>
                              <TextInput
                                value={createSeriesDraft.language}
                                onChange={(event) =>
                                  setCreateSeriesDraft((current) => ({
                                    ...current,
                                    language: event.target.value,
                                  }))
                                }
                                placeholder="Korean"
                              />
                            </div>
                            <div>
                              <FieldLabel>VJ</FieldLabel>
                              <TextInput
                                value={createSeriesDraft.vj}
                                onChange={(event) =>
                                  setCreateSeriesDraft((current) => ({
                                    ...current,
                                    vj: event.target.value,
                                  }))
                                }
                                placeholder="Unknown"
                              />
                            </div>
                            <div>
                              <FieldLabel>Genre / Tags</FieldLabel>
                              <TextInput
                                value={createSeriesDraft.genres}
                                onChange={(event) =>
                                  setCreateSeriesDraft((current) => ({
                                    ...current,
                                    genres: event.target.value,
                                  }))
                                }
                                placeholder="Drama, Action"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <FieldLabel>Extra Tags</FieldLabel>
                              <TextInput
                                value={createSeriesDraft.tags}
                                onChange={(event) =>
                                  setCreateSeriesDraft((current) => ({
                                    ...current,
                                    tags: event.target.value,
                                  }))
                                }
                                placeholder="Historical, Epic"
                              />
                            </div>
                          </div>
                          <div>
                            <FieldLabel>Manual Home Categories</FieldLabel>
                            <CategoryChecklist
                              categories={manualSeriesCategories}
                              selected={createSeriesDraft.categories}
                              onToggle={(name) =>
                                setCreateSeriesDraft((current) => ({
                                  ...current,
                                  categories: current.categories.includes(name)
                                    ? current.categories.filter((entry) => entry !== name)
                                    : [...current.categories, name],
                                }))
                              }
                              className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3"
                              getLabel={(category) =>
                                categoryLabelMap.get(category.name) || category.name
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </Card>

                {createSeriesFormVisible && (
                  <Card
                    title="Season 1 / Episode 1"
                    description="Create the first season and publish the opening episode with a local MP4 or MKV file, or use a direct MP4 link."
                  >
                    <div className="space-y-5">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <FieldLabel>Season Name</FieldLabel>
                          <TextInput
                            value={createSeriesDraft.seasonTitle}
                            onChange={(event) =>
                              setCreateSeriesDraft((current) => ({
                                ...current,
                                seasonTitle: event.target.value,
                              }))
                            }
                            placeholder="Season 1"
                          />
                        </div>
                        <div>
                          <FieldLabel>Episode Number</FieldLabel>
                          <TextInput
                            value={createSeriesDraft.episodeNumber}
                            onChange={(event) =>
                              setCreateSeriesDraft((current) => ({
                                ...current,
                                episodeNumber: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="md:col-span-2">
                          <FieldLabel>Season Overview</FieldLabel>
                          <TextArea
                            rows={4}
                            value={createSeriesDraft.seasonOverview}
                            onChange={(event) =>
                              setCreateSeriesDraft((current) => ({
                                ...current,
                                seasonOverview: event.target.value,
                              }))
                            }
                            placeholder="Optional season overview"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <FieldLabel>Episode Title</FieldLabel>
                          <TextInput
                            value={createSeriesDraft.episodeTitle}
                            onChange={(event) =>
                              setCreateSeriesDraft((current) => ({
                                ...current,
                                episodeTitle: event.target.value,
                              }))
                            }
                            placeholder="Episode 1"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <FieldLabel>Short Description</FieldLabel>
                          <TextArea
                            rows={4}
                            value={createSeriesDraft.episodeDescription}
                            onChange={(event) =>
                              setCreateSeriesDraft((current) => ({
                                ...current,
                                episodeDescription: event.target.value,
                              }))
                            }
                            placeholder="Optional short description"
                          />
                        </div>
                      </div>

                      <div className="rounded-[26px] border border-white/10 bg-[#0C1017] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/62">
                              Season 1 Poster
                            </div>
                            <div className="mt-2 text-xs leading-6 text-white/48">
                              TMDb can provide a season-specific poster when it exists. Otherwise
                              the series poster will carry Season 1 by default.
                            </div>
                          </div>
                          {selectedCreateSeasonOneTmdb?.poster_path ? (
                            <button
                              type="button"
                              onClick={() =>
                                setCreateSeriesDraft((current) => ({
                                  ...current,
                                  seasonPosterUrl: buildTmdbPosterUrl(
                                    selectedCreateSeasonOneTmdb.poster_path
                                  ),
                                }))
                              }
                              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                            >
                              Use TMDb Season Poster
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setCreateSeriesDraft((current) => ({
                                  ...current,
                                  seasonPosterUrl: currentSeriesPoster,
                                }))
                              }
                              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                            >
                              Use Series Poster
                            </button>
                          )}
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                          <div className="overflow-hidden rounded-[22px] border border-white/10 bg-black/20">
                            {createSeriesDraft.seasonPosterUrl || currentSeriesPoster ? (
                              <img
                                src={createSeriesDraft.seasonPosterUrl || currentSeriesPoster}
                                alt={createSeriesDraft.seasonTitle || 'Season 1 poster preview'}
                                className="h-full min-h-[280px] w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full min-h-[280px] items-center justify-center px-4 text-center text-sm text-white/35">
                                Search TMDb or upload the series poster first to preview Season 1 artwork.
                              </div>
                            )}
                          </div>
                          <div className="space-y-3">
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs leading-6 text-white/58">
                              {createSeriesDraft.seasonTitle || 'Season 1'} | Episode{' '}
                              {createSeriesDraft.episodeNumber || '1'}
                            </div>
                            {selectedCreateSeasonOneTmdb?.overview ? (
                              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs leading-6 text-white/55">
                                {selectedCreateSeasonOneTmdb.overview}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 rounded-[26px] border border-white/10 bg-[#0C1017] p-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setCreateSeriesDraft((current) => ({
                                ...current,
                                source: { ...current.source, mode: 'upload', url: '' },
                              }))
                            }
                            className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                              createSeriesDraft.source.mode === 'upload'
                                ? 'bg-[#D90429] text-white'
                                : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            Upload Video
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setCreateSeriesDraft((current) => ({
                                ...current,
                                source: { ...current.source, mode: 'link', file: null },
                              }))
                            }
                            className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                              createSeriesDraft.source.mode === 'link'
                                ? 'bg-[#D90429] text-white'
                                : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                          Use MP4 Link
                          </button>
                        </div>

                        {createSeriesDraft.source.mode === 'upload' ? (
                          <div>
                            <FieldLabel>Episode 1 Video File</FieldLabel>
                            <input
                              key={newSeriesEpisodeFileKey}
                              type="file"
                              accept=".mp4,.mkv,video/mp4,video/x-matroska,video/mkv"
                              onChange={(event) =>
                                setCreateSeriesDraft((current) => ({
                                  ...current,
                                  source: {
                                    ...current.source,
                                    file: event.target.files?.[0] || null,
                                  },
                                }))
                              }
                              className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0A0D13] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
                            />
                          </div>
                        ) : (
                          <div>
                            <FieldLabel>Episode 1 MP4 URL</FieldLabel>
                            <TextInput
                              value={createSeriesDraft.source.url}
                              onChange={(event) =>
                                setCreateSeriesDraft((current) => ({
                                  ...current,
                                  source: { ...current.source, url: event.target.value },
                                }))
                              }
                              placeholder="https://your-r2-public-url-or-existing-mp4-link.mp4"
                            />
                            <p className="mt-2 text-xs leading-6 text-white/45">
                              {SERIES_LINK_QUEUE_HELP}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap justify-end gap-3">
                        <button
                          type="button"
                          disabled={publishing}
                          onClick={() => void handlePublish()}
                          className="inline-flex items-center gap-2 rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                        >
                          <UploadCloud size={14} />
                          Publish Series
                        </button>
                      </div>
                    </div>
                  </Card>
                )}
              </Fragment>
            )}

            <Card
              title="Upload Activity"
              description="Direct upload progress, upload speed, and the latest uploader diagnostics."
            >
              <div className="space-y-4">
                {uploadStats && (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/42">
                          Progress
                        </div>
                        <div className="mt-2 text-xl font-black text-white">
                          {uploadStats.progressPercent}%
                        </div>
                        <div className="mt-2 text-xs text-white/55">
                          {formatBytes(uploadStats.uploadedBytes)} / {formatBytes(uploadStats.totalBytes)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/42">
                          <Gauge size={12} />
                          Speed
                        </div>
                        <div className="mt-2 text-xl font-black text-white">
                          {formatSpeed(uploadStats.speedBytesPerSecond)}
                        </div>
                        <div className="mt-2 text-xs text-white/55">
                          {uploadStats.completedParts}/{uploadStats.totalParts} parts complete
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/42">
                          <CheckCircle2 size={12} />
                          Remaining
                        </div>
                        <div className="mt-2 text-xl font-black text-white">
                          {formatEta(uploadStats.etaSeconds)}
                        </div>
                        <div className="mt-2 text-xs text-white/55">
                          {uploadStats.networkProfile} | {uploadStats.concurrency} parallel
                        </div>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-full border border-white/10 bg-black/30">
                      <div
                        className="h-3 bg-[#D90429] transition-all duration-300"
                        style={{ width: `${uploadStats.progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}

                <div
                  ref={diagnosticsRef}
                  className="h-48 overflow-y-auto rounded-2xl border border-white/10 bg-[#0C1017] p-3 text-xs leading-6 text-white/72"
                >
                  {diagnostics.length ? (
                    diagnostics.map((line, index) => (
                      <div key={`${line}-${index}`} className="break-words">
                        {line}
                      </div>
                    ))
                  ) : (
                    <div className="text-white/35">
                      Upload activity will appear here once an episode starts uploading.
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
