'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Clapperboard,
  DollarSign,
  Film,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  Loader2,
  MonitorPlay,
  RefreshCw,
  ShieldCheck,
  Tags,
  Users,
} from 'lucide-react';
import type {
  AdminCategory,
  AdminControlCenterPayload,
  AdminLibraryAsset,
  AdminRequest,
  AdminRequestStatus,
} from '@/types/admin';
import type { Movie } from '@/types/movie';
import {
  parseApiResponse,
  uploadMultipartFileToAdmin,
  uploadPosterToAdmin,
} from '@/lib/admin/directUploadClient';
import { fetchAdminJson } from '@/lib/admin/fetchAdminJson';
import {
  AdminTab,
  CategoryDraft,
  DraftVideoSource,
  MovieDraft,
  SeriesDraft,
  createEmptyMovieDraft,
  createEmptySeriesDraft,
  moveArrayItem,
  movieToDraft,
  seriesToDraft,
  splitCommaList,
} from '@/components/admin/controlCenterUtils';
import {
  Card,
  StatTile,
} from '@/components/admin/controlCenterFields';
import { AdminMoviesTab } from '@/components/admin/AdminMoviesTab';
import { AdminVideoJobsTab } from '@/components/admin/AdminVideoJobsTab';
import { AdminSeriesTab } from '@/components/admin/AdminSeriesTab';
import { AdminLibraryTab } from '@/components/admin/AdminLibraryTab';
import { AdminCategoriesTab } from '@/components/admin/AdminCategoriesTab';
import { AdminUsersTab } from '@/components/admin/AdminUsersTab';
import { AdminRequestsTab } from '@/components/admin/AdminRequestsTab';
import { AdminRevenueTab } from '@/components/admin/AdminRevenueTab';
import { AdminSubscriptionOverridesTab } from '@/components/admin/AdminSubscriptionOverridesTab';

type AdminControlCenterProps = {
  section?: AdminTab;
};

type ResolvedVideoSource = {
  video_url: string;
  sourceUrl: string;
  sourceFileName: string;
  fileSizeBytes: number;
  sourceType: 'direct_upload' | 'remote_link' | 'direct_url';
};

const EMPTY_ADMIN_REVENUE: AdminControlCenterPayload['revenue'] = {
  monthLabel: '',
  monthRevenue: 0,
  activeSubscriberCount: 0,
  activeSubscriptionRevenue: 0,
  activePlanBreakdown: [],
  recentPayments: [],
};

const EMPTY_ADMIN_PAYLOAD: AdminControlCenterPayload = {
  movies: [],
  categories: [],
  users: [],
  requests: [],
  libraryAssets: [],
  revenue: EMPTY_ADMIN_REVENUE,
};

function isQuotaExceededMessage(message: string) {
  return /resource_exhausted|quota exceeded/i.test(message);
}

function formatAdminLoadErrors(issues: string[]) {
  if (!issues.length) {
    return '';
  }

  if (issues.length === 1) {
    const message = issues[0];
    return isQuotaExceededMessage(message)
      ? 'One admin data source hit a backend quota limit. The rest of the panel remains available.'
      : message;
  }

  return `Some admin data is temporarily unavailable: ${issues.join(' | ')}`;
}

function buildRequestEdits(requests: AdminRequest[]) {
  return requests.reduce(
    (
      accumulator: Record<
        string,
        {
          status: AdminRequestStatus;
          adminNotes: string;
        }
      >,
      request: AdminRequest
    ) => {
      accumulator[request.id] = {
        status: request.status,
        adminNotes: request.adminNotes || '',
      };
      return accumulator;
    },
    {}
  );
}

function createEmptyCategoryDraft(): CategoryDraft {
  return {
    id: '',
    name: '',
    displayLabel: '',
    description: '',
    type: 'custom',
    homeOrder: null,
    isVisible: true,
  };
}

export default function AdminControlCenter({ section }: AdminControlCenterProps) {
  const activeTab = section ?? null;
  const [payload, setPayload] = useState<AdminControlCenterPayload>(EMPTY_ADMIN_PAYLOAD);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const [editingMovieId, setEditingMovieId] = useState('');
  const [editingSeriesId, setEditingSeriesId] = useState('');
  const [movieDraft, setMovieDraft] = useState<MovieDraft>(createEmptyMovieDraft);
  const [seriesDraft, setSeriesDraft] = useState<SeriesDraft>(createEmptySeriesDraft);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>(createEmptyCategoryDraft);

  const [movieSearch, setMovieSearch] = useState('');
  const [seriesSearch, setSeriesSearch] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [requestSearch, setRequestSearch] = useState('');
  const [requestEdits, setRequestEdits] = useState<
    Record<string, { status: AdminRequestStatus; adminNotes: string }>
  >({});
  const [libraryUploadFile, setLibraryUploadFile] = useState<File | null>(null);
  const [libraryUploadProgress, setLibraryUploadProgress] = useState(0);
  const [libraryUploadStatus, setLibraryUploadStatus] = useState('');
  const [movieDiagnostics, setMovieDiagnostics] = useState('');
  const [movieProgress, setMovieProgress] = useState(0);
  const [seriesDiagnostics, setSeriesDiagnostics] = useState('');
  const [seriesProgress, setSeriesProgress] = useState(0);

  const loadControlCenter = async (showSpinner = true, force = false) => {
    if (showSpinner) {
      setLoading(true);
    }

    setErrorMessage('');

    try {
      const issues: string[] = [];
      const nextPayload: Partial<AdminControlCenterPayload> = {};

      const captureIssue = (label: string, error: unknown) => {
        const message =
          error instanceof Error ? error.message : `Failed to load ${label.toLowerCase()}.`;
        issues.push(`${label}: ${message}`);
      };

      const loadResource = async <T,>(
        label: string,
        url: string,
        apply: (payload: T) => void
      ) => {
        try {
          const response = await fetchAdminJson<T>(url, { force });
          apply(response);
        } catch (error) {
          captureIssue(label, error);
        }
      };

      if (activeTab === 'movies') {
        await loadResource<{ movies: Movie[] }>('Movies', '/api/admin/movies', (response) => {
          nextPayload.movies = response.movies || [];
        });
      } else if (activeTab === 'processing') {
        // The processing section uses its own live polling requests and does not need
        // the heavier control-center payload on entry.
      } else if (activeTab === 'subscription_overrides') {
        // This section loads its own focused data so it can stay responsive while
        // handling user search, access actions, and audit history.
      } else if (activeTab === 'library') {
        await loadResource<{ assets: AdminLibraryAsset[] }>(
          'Library',
          '/api/admin/library',
          (response) => {
            nextPayload.libraryAssets = response.assets || [];
          }
        );
      } else if (activeTab === 'categories') {
        await Promise.all([
          loadResource<{ movies: Movie[] }>('Movies', '/api/admin/movies', (response) => {
            nextPayload.movies = response.movies || [];
          }),
          loadResource<{ categories: AdminCategory[] }>(
            'Categories',
            '/api/admin/categories',
            (response) => {
              nextPayload.categories = response.categories || [];
            }
          ),
        ]);
      } else if (activeTab === 'users') {
        await loadResource<{ users: AdminControlCenterPayload['users'] }>(
          'Users',
          '/api/admin/users',
          (response) => {
            nextPayload.users = response.users || [];
          }
        );
      } else if (activeTab === 'requests') {
        await loadResource<{ requests: AdminRequest[] }>(
          'Requests',
          '/api/admin/requests',
          (response) => {
            nextPayload.requests = response.requests || [];
          }
        );
      } else if (activeTab === 'revenue') {
        await loadResource<{ revenue: AdminControlCenterPayload['revenue'] }>(
          'Revenue',
          '/api/admin/revenue',
          (response) => {
            nextPayload.revenue = response.revenue || EMPTY_ADMIN_REVENUE;
          }
        );
      } else if (activeTab === 'overview') {
        await Promise.all([
          loadResource<{ movies: Movie[] }>('Movies', '/api/admin/movies', (response) => {
            nextPayload.movies = response.movies || [];
          }),
          loadResource<{ users: AdminControlCenterPayload['users'] }>(
            'Users',
            '/api/admin/users',
            (response) => {
              nextPayload.users = response.users || [];
            }
          ),
          loadResource<{ requests: AdminRequest[] }>('Requests', '/api/admin/requests', (response) => {
            nextPayload.requests = response.requests || [];
          }),
          loadResource<{ revenue: AdminControlCenterPayload['revenue'] }>(
            'Revenue',
            '/api/admin/revenue',
            (response) => {
              nextPayload.revenue = response.revenue || EMPTY_ADMIN_REVENUE;
            }
          ),
        ]);
      } else {
        await Promise.all([
          loadResource<{ movies: Movie[] }>('Movies', '/api/admin/movies', (response) => {
            nextPayload.movies = response.movies || [];
          }),
          loadResource<{ categories: AdminCategory[] }>(
            'Categories',
            '/api/admin/categories',
            (response) => {
              nextPayload.categories = response.categories || [];
            }
          ),
          loadResource<{ assets: AdminLibraryAsset[] }>('Library', '/api/admin/library', (response) => {
            nextPayload.libraryAssets = response.assets || [];
          }),
          loadResource<{ users: AdminControlCenterPayload['users'] }>(
            'Users',
            '/api/admin/users',
            (response) => {
              nextPayload.users = response.users || [];
            }
          ),
          loadResource<{ requests: AdminRequest[] }>('Requests', '/api/admin/requests', (response) => {
            nextPayload.requests = response.requests || [];
          }),
          loadResource<{ revenue: AdminControlCenterPayload['revenue'] }>(
            'Revenue',
            '/api/admin/revenue',
            (response) => {
              nextPayload.revenue = response.revenue || EMPTY_ADMIN_REVENUE;
            }
          ),
        ]);
      }

      if (Object.keys(nextPayload).length === 0 && activeTab !== 'processing') {
        throw new Error(
          issues[0] || 'Failed to load admin data for this section.'
        );
      }

      const mergedPayload = {
        ...EMPTY_ADMIN_PAYLOAD,
        ...payload,
        ...nextPayload,
      };

      setPayload(mergedPayload);

      if (nextPayload.requests) {
        setRequestEdits(buildRequestEdits(nextPayload.requests));
      }

      if (issues.length) {
        setErrorMessage(formatAdminLoadErrors(issues));
      }

      return mergedPayload;
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to load admin control center.'
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
  }, [activeTab]);

  const movies = payload.movies || [];
  const movieItems = useMemo(
    () => movies.filter((movie) => movie.contentType !== 'series'),
    [movies]
  );
  const seriesItems = useMemo(
    () => movies.filter((movie) => movie.contentType === 'series'),
    [movies]
  );
  const filteredMovies = useMemo(() => {
    const search = movieSearch.trim().toLowerCase();
    return search
      ? movieItems.filter((movie) =>
          `${movie.title} ${(movie.category || []).join(' ')} ${(movie.genres || []).join(' ')}`
            .toLowerCase()
            .includes(search)
        )
      : movieItems;
  }, [movieItems, movieSearch]);
  const filteredSeries = useMemo(() => {
    const search = seriesSearch.trim().toLowerCase();
    return search
      ? seriesItems.filter((movie) =>
          `${movie.title} ${(movie.category || []).join(' ')} ${(movie.genres || []).join(' ')}`
            .toLowerCase()
            .includes(search)
        )
      : seriesItems;
  }, [seriesItems, seriesSearch]);
  const filteredLibraryAssets = useMemo(() => {
    const search = librarySearch.trim().toLowerCase();
    const assets = payload?.libraryAssets || [];
    return search
      ? assets.filter((asset) =>
          `${asset.label} ${asset.fileName} ${asset.url}`.toLowerCase().includes(search)
        )
      : assets;
  }, [payload?.libraryAssets, librarySearch]);
  const filteredUsers = useMemo(() => {
    const search = userSearch.trim().toLowerCase();
    const users = payload?.users || [];
    return search
      ? users.filter((user) =>
          `${user.name} ${user.email} ${user.subscription.planName || ''}`
            .toLowerCase()
            .includes(search)
        )
      : users;
  }, [payload?.users, userSearch]);
  const filteredRequests = useMemo(() => {
    const search = requestSearch.trim().toLowerCase();
    const requests = payload?.requests || [];
    return search
      ? requests.filter((request) =>
          `${request.title} ${request.preferredVj} ${request.notes} ${request.requesterEmail}`
            .toLowerCase()
            .includes(search)
        )
      : requests;
  }, [payload?.requests, requestSearch]);
  const activeMovie = useMemo(
    () => movieItems.find((movie) => movie.id === editingMovieId) || null,
    [movieItems, editingMovieId]
  );
  const navCards = useMemo(
    () => [
      {
        id: 'overview' as AdminTab,
        href: '/admin/overview',
        label: 'Overview',
        description: 'Command snapshot, recent requests, and latest payments.',
        meta: `${movieItems.length + seriesItems.length} catalog entries`,
        icon: <LayoutDashboard size={20} />,
      },
      {
        id: 'movies' as AdminTab,
        href: '/admin/movies',
        label: 'Movies',
        description: 'Create, edit, and manage standalone movie releases.',
        meta: `${movieItems.length} movie entries`,
        icon: <Film size={20} />,
      },
      {
        id: 'processing' as AdminTab,
        href: '/admin/processing',
        label: 'Processing',
        description: 'Watch queued jobs, failed uploads, and completed video repairs.',
        meta: 'Worker queue and repairs',
        icon: <MonitorPlay size={20} />,
      },
      {
        id: 'series' as AdminTab,
        href: '/admin/series',
        label: 'Series',
        description: 'Control seasons, episodes, and serialized releases.',
        meta: `${seriesItems.length} series entries`,
        icon: <Clapperboard size={20} />,
      },
      {
        id: 'library' as AdminTab,
        href: '/admin/library',
        label: 'Library',
        description: 'Reusable uploaded MP4 assets ready for assignment.',
        meta: `${payload?.libraryAssets.length || 0} stored assets`,
        icon: <FolderOpen size={20} />,
      },
      {
        id: 'categories' as AdminTab,
        href: '/admin/categories',
        label: 'Categories',
        description: 'Manage browse categories and content grouping.',
        meta: `${payload?.categories.length || 0} categories`,
        icon: <Tags size={20} />,
      },
      {
        id: 'users' as AdminTab,
        href: '/admin/users',
        label: 'Users',
        description: 'Search members, plans, and account activity.',
        meta: `${payload?.users.length || 0} users`,
        icon: <Users size={20} />,
      },
      {
        id: 'subscription_overrides' as AdminTab,
        href: '/admin/subscription-overrides',
        label: 'Subscription Overrides',
        description: 'Grant, extend, revoke, and audit manual premium access.',
        meta: 'Manual access + audit trail',
        icon: <ShieldCheck size={20} />,
      },
      {
        id: 'requests' as AdminTab,
        href: '/admin/requests',
        label: 'Requests',
        description: 'Review viewer demand and update request status.',
        meta: `${payload?.requests.length || 0} requests`,
        icon: <Inbox size={20} />,
      },
      {
        id: 'revenue' as AdminTab,
        href: '/admin/revenue',
        label: 'Revenue',
        description: 'Track subscriptions, payments, and active plans.',
        meta: payload?.revenue.monthLabel
          ? `Month: ${payload.revenue.monthLabel}`
          : 'Revenue summary',
        icon: <DollarSign size={20} />,
      },
    ],
    [
      movieItems.length,
      seriesItems.length,
      payload?.categories.length,
      payload?.libraryAssets.length,
      payload?.requests.length,
      payload?.revenue.monthLabel,
      payload?.users.length,
    ]
  );

  const activeTabMeta = navCards.find((card) => card.id === activeTab) || null;

  const parseYear = (value: string) => {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 1800 ? normalized : null;
  };

  const resetMovieEditor = () => {
    setEditingMovieId('');
    setMovieDraft(createEmptyMovieDraft());
    setMovieDiagnostics('');
    setMovieProgress(0);
  };

  const resetSeriesEditor = () => {
    setEditingSeriesId('');
    setSeriesDraft(createEmptySeriesDraft());
    setSeriesDiagnostics('');
    setSeriesProgress(0);
  };

  const startEditingMovie = (movie: Movie) => {
    setEditingMovieId(movie.id);
    setMovieDraft(movieToDraft(movie));
    setStatusMessage(`Editing "${movie.title}".`);
    setErrorMessage('');
  };

  const startEditingSeries = (movie: Movie) => {
    setEditingSeriesId(movie.id);
    setSeriesDraft(seriesToDraft(movie));
    setStatusMessage(`Editing series "${movie.title}".`);
    setErrorMessage('');
  };

  const resolvePosterUrl = async (currentUrl: string, file: File | null) => {
    if (!file) {
      return currentUrl.trim();
    }

    const uploadedPoster = await uploadPosterToAdmin(file);
    return uploadedPoster.publicUrl;
  };

  const resolveVideoSource = async (
    source: DraftVideoSource,
    onProgress?: (progress: number) => void,
    onDiagnostic?: (message: string) => void,
    stage: 'final' | 'library' | 'staging' = 'final'
  ): Promise<ResolvedVideoSource> => {
    if (source.mode === 'file' && source.file) {
      const uploadedAsset = await uploadMultipartFileToAdmin({
        file: source.file,
        stage,
        onProgress,
        onDiagnostic,
      });

      return {
        video_url: uploadedAsset.publicUrl,
        sourceUrl: uploadedAsset.publicUrl,
        sourceFileName: uploadedAsset.fileName,
        fileSizeBytes: uploadedAsset.fileSizeBytes,
        sourceType: 'direct_upload' as const,
      };
    }

    const url = source.url.trim();

    return {
      video_url: url,
      sourceUrl: url,
      sourceFileName: url.split('/').pop() || '',
      fileSizeBytes: 0,
      sourceType: source.sourceType === 'direct_url' ? 'direct_url' : ('remote_link' as const),
    };
  };

  const handleSaveMovie = async () => {
    if (!movieDraft.title.trim()) {
      setErrorMessage('Movie title is required.');
      return;
    }

    if (
      !movieDraft.parts.length &&
      !movieDraft.source.url.trim() &&
      !(movieDraft.source.mode === 'file' && movieDraft.source.file)
    ) {
      setErrorMessage('Add one MP4 source or at least one movie part.');
      return;
    }

    const incompletePart = movieDraft.parts.find(
      (part) =>
        !part.label.trim() ||
        (!part.source.url.trim() && !(part.source.mode === 'file' && part.source.file))
    );

    if (incompletePart) {
      setErrorMessage(`Complete the source for ${incompletePart.label}.`);
      return;
    }

    setActionBusy(true);
    setErrorMessage('');
    setStatusMessage('');
    setMovieDiagnostics('');
    setMovieProgress(0);

    try {
      const posterUrl = await resolvePosterUrl(movieDraft.poster, movieDraft.posterFile);
      let rootSource: ResolvedVideoSource = {
        video_url: '',
        sourceUrl: '',
        sourceFileName: '',
        fileSizeBytes: 0,
        sourceType: 'remote_link' as const,
      };

      if (
        movieDraft.source.url.trim() ||
        (movieDraft.source.mode === 'file' && movieDraft.source.file)
      ) {
        rootSource = await resolveVideoSource(
          movieDraft.source,
          setMovieProgress,
          (message) =>
            setMovieDiagnostics((current) => `${current}${current ? '\n' : ''}${message}`)
        );
      }

      const parts = [];

      for (const [index, part] of movieDraft.parts.entries()) {
        const resolvedPartSource = await resolveVideoSource(
          part.source,
          setMovieProgress,
          (message) =>
            setMovieDiagnostics((current) => `${current}${current ? '\n' : ''}${message}`)
        );

        parts.push({
          id: part.id,
          label: part.label.trim(),
          order: index + 1,
          title: part.title.trim(),
          description: part.description.trim(),
          ...resolvedPartSource,
        });
      }

      const moviePayload = {
        contentType: 'movie',
        title: movieDraft.title.trim(),
        description: movieDraft.description.trim(),
        poster: posterUrl,
        releaseYear: parseYear(movieDraft.releaseYear),
        language: movieDraft.language.trim(),
        vj: movieDraft.vj.trim() || 'Unknown',
        genres: splitCommaList(movieDraft.genres),
        tags: splitCommaList(movieDraft.tags),
        cast: splitCommaList(movieDraft.cast),
        accessTier: movieDraft.accessTier,
        is_trending_tiktok: movieDraft.isTrendingTikTok,
        category: movieDraft.categories,
        ...rootSource,
        parts,
      };

      const response = await fetch(
        editingMovieId ? `/api/admin/movies/${editingMovieId}` : '/api/admin/movies',
        {
          method: editingMovieId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ movie: moviePayload }),
        }
      );
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to save movie.');
      }

      const refreshedPayload = await loadControlCenter(false, true);
      const savedMovieId = editingMovieId || String(result.payload.movie?.id || '');

      if (refreshedPayload && savedMovieId) {
        const savedMovie = refreshedPayload.movies.find((movie) => movie.id === savedMovieId);

        if (savedMovie) {
          setEditingMovieId(savedMovie.id);
          setMovieDraft(movieToDraft(savedMovie));
        }
      }

      setMovieProgress(100);
      setStatusMessage(
        editingMovieId
          ? `Updated "${movieDraft.title}".`
          : `Created "${movieDraft.title}".`
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save movie.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveSeries = async () => {
    if (!seriesDraft.title.trim()) {
      setErrorMessage('Series title is required.');
      return;
    }

    const incompleteEpisode = seriesDraft.seasons
      .flatMap((season) => season.episodes.map((episode) => ({ season, episode })))
      .find(
        ({ episode }) =>
          !episode.title.trim() ||
          (!episode.source.url.trim() &&
            !(episode.source.mode === 'file' && episode.source.file))
      );

    if (incompleteEpisode) {
      setErrorMessage(
        `Complete the MP4 source for ${incompleteEpisode.season.title} / ${incompleteEpisode.episode.title}.`
      );
      return;
    }

    setActionBusy(true);
    setErrorMessage('');
    setStatusMessage('');
    setSeriesDiagnostics('');
    setSeriesProgress(0);

    try {
      const posterUrl = await resolvePosterUrl(seriesDraft.poster, seriesDraft.posterFile);
      const seasons = [];

      for (const [seasonIndex, season] of seriesDraft.seasons
        .slice()
        .sort((left, right) => left.seasonNumber - right.seasonNumber)
        .entries()) {
        const episodes = [];

        for (const [episodeIndex, episode] of season.episodes
          .slice()
          .sort((left, right) => left.episodeNumber - right.episodeNumber)
          .entries()) {
          const episodeSource = await resolveVideoSource(
            episode.source,
            setSeriesProgress,
            (message) =>
              setSeriesDiagnostics((current) => `${current}${current ? '\n' : ''}${message}`)
          );
          const episodePoster = await resolvePosterUrl(episode.poster, episode.posterFile);
          const episodeThumbnail = await resolvePosterUrl(
            episode.thumbnail,
            episode.thumbnailFile
          );

          episodes.push({
            episodeNumber: episode.episodeNumber || episodeIndex + 1,
            title: episode.title.trim() || `Episode ${episodeIndex + 1}`,
            description: episode.description.trim(),
            poster: episodePoster || episodeThumbnail || posterUrl,
            thumbnail: episodeThumbnail || episodePoster || posterUrl,
            ...episodeSource,
          });
        }

        seasons.push({
          seasonNumber: season.seasonNumber || seasonIndex + 1,
          title: season.title.trim() || `Season ${seasonIndex + 1}`,
          episodes,
        });
      }

      const seriesPayload = {
        contentType: 'series',
        title: seriesDraft.title.trim(),
        description: seriesDraft.description.trim(),
        poster: posterUrl,
        releaseYear: parseYear(seriesDraft.releaseYear),
        language: seriesDraft.language.trim(),
        vj: seriesDraft.vj.trim() || 'Unknown',
        genres: splitCommaList(seriesDraft.genres),
        tags: splitCommaList(seriesDraft.tags),
        cast: splitCommaList(seriesDraft.cast),
        accessTier: seriesDraft.accessTier,
        is_trending_tiktok: seriesDraft.isTrendingTikTok,
        category: seriesDraft.categories,
        seasons,
      };

      const response = await fetch(
        editingSeriesId ? `/api/admin/movies/${editingSeriesId}` : '/api/admin/movies',
        {
          method: editingSeriesId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ movie: seriesPayload }),
        }
      );
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to save series.');
      }

      const refreshedPayload = await loadControlCenter(false, true);
      const savedSeriesId = editingSeriesId || String(result.payload.movie?.id || '');

      if (refreshedPayload && savedSeriesId) {
        const savedSeries = refreshedPayload.movies.find((movie) => movie.id === savedSeriesId);

        if (savedSeries) {
          setEditingSeriesId(savedSeries.id);
          setSeriesDraft(seriesToDraft(savedSeries));
        }
      }

      setSeriesProgress(100);
      setStatusMessage(
        editingSeriesId
          ? `Updated series "${seriesDraft.title}".`
          : `Created series "${seriesDraft.title}".`
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save series.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteMovie = async (movieId: string, title: string) => {
    setActionBusy(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const response = await fetch(`/api/admin/movies/${movieId}`, { method: 'DELETE' });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to delete movie.');
      }

      await loadControlCenter(false, true);

      if (editingMovieId === movieId) {
        resetMovieEditor();
      }

      if (editingSeriesId === movieId) {
        resetSeriesEditor();
      }

      setStatusMessage(`Deleted "${title}".`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete movie.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteStoredPart = async (movieId: string, part: { id: string; label: string }) => {
    setActionBusy(true);
    setErrorMessage('');

    try {
      const response = await fetch(
        `/api/admin/movies/${movieId}?partId=${encodeURIComponent(part.id)}`,
        {
          method: 'DELETE',
        }
      );
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to delete movie part.');
      }

      const refreshedPayload = await loadControlCenter(false, true);
      const refreshedMovie = refreshedPayload?.movies.find((movie) => movie.id === movieId);

      if (refreshedMovie) {
        setMovieDraft(movieToDraft(refreshedMovie));
      }

      setStatusMessage(`Deleted ${part.label}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete part.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteStoredEpisode = async (
    movieId: string,
    seasonNumber: number,
    episodeNumber: number,
    label: string
  ) => {
    setActionBusy(true);
    setErrorMessage('');

    try {
      const response = await fetch(
        `/api/admin/movies/${movieId}?seasonNumber=${seasonNumber}&episodeNumber=${episodeNumber}`,
        {
          method: 'DELETE',
        }
      );
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to delete episode.');
      }

      const refreshedPayload = await loadControlCenter(false, true);
      const refreshedSeries = refreshedPayload?.movies.find((movie) => movie.id === movieId);

      if (refreshedSeries) {
        setSeriesDraft(seriesToDraft(refreshedSeries));
      }

      setStatusMessage(`Deleted ${label}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete episode.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveCategory = async () => {
    if (!categoryDraft.name.trim()) {
      setErrorMessage('Category name is required.');
      return;
    }

    setActionBusy(true);
    setErrorMessage('');

    try {
      const response = await fetch('/api/admin/categories', {
        method: categoryDraft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryDraft),
      });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to save category.');
      }

      await loadControlCenter(false, true);
      setCategoryDraft(createEmptyCategoryDraft());
      setStatusMessage(
        categoryDraft.id
          ? `Updated category "${categoryDraft.name}".`
          : `Created category "${categoryDraft.name}".`
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save category.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteCategory = async (category: AdminCategory) => {
    setActionBusy(true);
    setErrorMessage('');

    try {
      const response = await fetch(
        `/api/admin/categories?id=${encodeURIComponent(category.id)}`,
        { method: 'DELETE' }
      );
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to delete category.');
      }

      await loadControlCenter(false, true);

      if (categoryDraft.id === category.id) {
        setCategoryDraft(createEmptyCategoryDraft());
      }

      setStatusMessage(`Deleted category "${category.name}".`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete category.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleMoveHomeCategory = async (categoryId: string, direction: -1 | 1) => {
    const homeCategories = (payload?.categories || [])
      .filter((category) => category.type === 'home_row')
      .slice()
      .sort(
        (left, right) =>
          (left.homeOrder ?? Number.MAX_SAFE_INTEGER) -
            (right.homeOrder ?? Number.MAX_SAFE_INTEGER) ||
          left.name.localeCompare(right.name)
      );
    const currentIndex = homeCategories.findIndex((category) => category.id === categoryId);

    if (currentIndex === -1) {
      return;
    }

    const nextCategories = moveArrayItem(homeCategories, currentIndex, direction);

    if (nextCategories === homeCategories) {
      return;
    }

    setActionBusy(true);
    setErrorMessage('');

    try {
      const response = await fetch('/api/admin/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reorderHomeRows',
          categoryIds: nextCategories.map((category) => category.id),
        }),
      });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to reorder homepage categories.');
      }

      await loadControlCenter(false, true);
      setStatusMessage('Homepage categories reordered.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to reorder homepage categories.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleCategoryVisibility = async (category: AdminCategory) => {
    setActionBusy(true);
    setErrorMessage('');

    try {
      const response = await fetch('/api/admin/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: category.id,
          name: category.name,
          displayLabel: category.displayLabel,
          description: category.description,
          type: category.type,
          homeOrder: category.homeOrder,
          isVisible: !category.isVisible,
        }),
      });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to update category visibility.');
      }

      await loadControlCenter(false, true);
      setStatusMessage(
        `${category.displayLabel || category.name} ${category.isVisible ? 'hidden' : 'shown'}.`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to update category visibility.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemoveMovieFromCategory = async (category: AdminCategory, movie: Movie) => {
    setActionBusy(true);
    setErrorMessage('');

    try {
      const response = await fetch('/api/admin/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'removeAssignment',
          categoryId: category.id,
          movieId: movie.id,
        }),
      });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to remove title from category.');
      }

      await loadControlCenter(false, true);
      setStatusMessage(`Removed "${movie.title}" from ${category.displayLabel || category.name}.`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to remove title from category.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveRequest = async (requestId: string) => {
    const nextEdit = requestEdits[requestId];

    if (!nextEdit) {
      return;
    }

    setActionBusy(true);
    setErrorMessage('');

    try {
      const response = await fetch('/api/admin/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: requestId,
          status: nextEdit.status,
          adminNotes: nextEdit.adminNotes,
        }),
      });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to update request.');
      }

      await loadControlCenter(false, true);
      setStatusMessage('Request updated.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update request.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleUploadLibraryAsset = async () => {
    if (!libraryUploadFile) {
      setErrorMessage('Choose an MP4 file for the library first.');
      return;
    }

    setActionBusy(true);
    setErrorMessage('');
    setLibraryUploadProgress(0);
    setLibraryUploadStatus('[INIT] Uploading MP4 into the reusable library...');

    try {
      const uploadedAsset = await uploadMultipartFileToAdmin({
        file: libraryUploadFile,
        stage: 'library',
        onProgress: setLibraryUploadProgress,
        onDiagnostic: (message) =>
          setLibraryUploadStatus((current) => `${current}${current ? '\n' : ''}${message}`),
      });

      const response = await fetch('/api/admin/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: libraryUploadFile.name.replace(/\.[^.]+$/, ''),
          fileName: uploadedAsset.fileName,
          url: uploadedAsset.publicUrl,
          key: uploadedAsset.key,
          fileSizeBytes: uploadedAsset.fileSizeBytes,
          contentType: libraryUploadFile.type || 'video/mp4',
          sourceType: 'direct_upload',
        }),
      });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to register library asset.');
      }

      await loadControlCenter(false, true);
      setLibraryUploadFile(null);
      setLibraryUploadProgress(100);
      setStatusMessage('Library asset uploaded and ready for reuse.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to upload library asset.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteLibraryAsset = async (asset: AdminLibraryAsset) => {
    setActionBusy(true);
    setErrorMessage('');

    try {
      const response = await fetch(
        `/api/admin/library?id=${encodeURIComponent(asset.id)}`,
        { method: 'DELETE' }
      );
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to delete library asset.');
      }

      await loadControlCenter(false, true);
      setStatusMessage(`Deleted library asset "${asset.label}".`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to delete library asset.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleCopyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatusMessage(`${label} copied.`);
    } catch {
      setErrorMessage(`Could not copy ${label.toLowerCase()} automatically.`);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0B0C10] px-4 py-12 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-center rounded-3xl border border-white/10 bg-[#11141C]/80 py-20">
          <Loader2 className="h-10 w-10 animate-spin text-[#D90429]" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 py-8 text-white md:px-8 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-white/10 bg-[#11141C] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.3em] text-white/45">
                Admin Control Center
              </div>
              <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.14em] text-white md:text-4xl">
                UG Movies 247
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/65">
                Direct MP4 publishing for movies, long multi-part titles, series seasons and
                episodes, library reuse, categories, users, requests, and revenue.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void loadControlCenter(true, true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-white"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-[#D90429]/20 bg-[#D90429]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-[#FFD7DF]"
              >
                Back To App
              </Link>
            </div>
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

        {activeTab === null ? (
          <section className="space-y-4">
            <div className="px-1">
              <div className="text-[11px] font-black uppercase tracking-[0.26em] text-white/45">
                Sections
              </div>
              <p className="mt-2 text-sm leading-6 text-white/60">
                Open a section to manage its content with the same tools already wired into the
                control center.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {navCards.map((card) => (
                <Link
                  key={card.id}
                  href={card.href}
                  className="group block w-full rounded-[28px] border border-white/10 bg-[#11141C] px-4 py-4 text-left shadow-[0_18px_40px_rgba(0,0,0,0.24)] transition-all duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-[#141924] hover:shadow-[0_26px_52px_rgba(0,0,0,0.34)] md:min-h-[132px] md:px-5 md:py-5"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-white/72 transition-all duration-200 group-hover:border-[#D90429]/20 group-hover:bg-[#D90429]/10 group-hover:text-white group-hover:shadow-[0_10px_24px_rgba(217,4,41,0.12)]">
                      {card.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold text-white">{card.label}</div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/42">
                        {card.meta}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-white/58">{card.description}</p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-black/15 text-white/35 transition-all duration-200 group-hover:border-white/15 group-hover:bg-white/5 group-hover:text-white/70">
                      <ArrowRight size={16} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <section className="space-y-5">
            <div className="rounded-[28px] border border-white/10 bg-[#11141C] px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.24)] md:px-5">
              <div className="flex items-center gap-3">
                <Link
                  href="/admin"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/78 transition-colors hover:bg-white/5 hover:text-white"
                  aria-label="Back to admin sections"
                >
                  <ArrowLeft size={18} />
                </Link>
                <div>
                  <div className="text-base font-bold text-white">
                    {activeTabMeta?.label || 'Admin Section'}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/42">
                    {activeTabMeta?.meta || 'Control Center'}
                  </div>
                </div>
              </div>
            </div>

            {activeTab === 'overview' && (
              <>
                <Card title="Command Snapshot" description="High-signal overview of catalog, revenue, and activity.">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <StatTile title="Movies" value={movieItems.length} icon={<Film size={18} />} />
                    <StatTile title="Series" value={seriesItems.length} icon={<Clapperboard size={18} />} />
                    <StatTile title="Users" value={payload?.users.length || 0} icon={<Users size={18} />} />
                    <StatTile title="Monthly Revenue" value={`UGX ${(payload?.revenue.monthRevenue || 0).toLocaleString()}`} icon={<DollarSign size={18} />} subcopy={payload?.revenue.monthLabel || ''} />
                  </div>
                </Card>

                <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
                  <Card title="Recent Requests" description="Newest viewer demand flowing into the queue.">
                    <div className="space-y-3">
                      {(payload?.requests || []).slice(0, 5).map((request) => (
                        <div key={request.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-bold text-white">{request.title}</div>
                              <div className="mt-1 text-xs text-white/50">{request.requesterEmail || request.requesterName || 'Anonymous'}</div>
                            </div>
                            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-white/75">{request.status}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <Card title="Latest Payments" description="Most recent real subscription payments.">
                    <div className="space-y-3">
                      {(payload?.revenue.recentPayments || []).slice(0, 5).map((payment) => (
                        <div key={payment.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-bold text-white">{payment.planName}</div>
                              <div className="mt-1 text-xs text-white/50">{payment.phoneNumber || payment.userId}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-black text-white">{payment.currency} {Number(payment.amount || 0).toLocaleString()}</div>
                              <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/45">{payment.status}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              </>
            )}

            {activeTab === 'movies' && (
              <AdminMoviesTab
                movies={filteredMovies}
                search={movieSearch}
                actionBusy={actionBusy}
                onSearchChange={setMovieSearch}
                onDeleteMovie={handleDeleteMovie}
              />
            )}

            {activeTab === 'processing' && <AdminVideoJobsTab />}

            {activeTab === 'series' && (
              <AdminSeriesTab
                seriesItems={filteredSeries}
                categories={payload?.categories || []}
                libraryAssets={payload?.libraryAssets || []}
                search={seriesSearch}
                editingSeriesId={editingSeriesId}
                draft={seriesDraft}
                diagnostics={seriesDiagnostics}
                progress={seriesProgress}
                actionBusy={actionBusy}
                onSearchChange={setSeriesSearch}
                onStartNew={resetSeriesEditor}
                onEditSeries={startEditingSeries}
                onDeleteSeries={handleDeleteMovie}
                onChangeDraft={setSeriesDraft}
                onReset={resetSeriesEditor}
                onSave={handleSaveSeries}
                onDeleteStoredEpisode={handleDeleteStoredEpisode}
              />
            )}

            {activeTab === 'library' && (
              <AdminLibraryTab
                assets={filteredLibraryAssets}
                search={librarySearch}
                onSearchChange={setLibrarySearch}
                uploadFile={libraryUploadFile}
                onUploadFileChange={setLibraryUploadFile}
                uploadProgress={libraryUploadProgress}
                uploadStatus={libraryUploadStatus}
                onUploadAsset={handleUploadLibraryAsset}
                onCopyUrl={handleCopyToClipboard}
                onDeleteAsset={handleDeleteLibraryAsset}
                actionBusy={actionBusy}
              />
            )}

            {activeTab === 'categories' && (
              <AdminCategoriesTab
                categories={payload?.categories || []}
                movies={payload?.movies || []}
                categoryDraft={categoryDraft}
                onChangeDraft={setCategoryDraft}
                onResetDraft={() => setCategoryDraft(createEmptyCategoryDraft())}
                onEditCategory={(category) =>
                  setCategoryDraft({
                    id: category.id,
                    name: category.name,
                    displayLabel: category.displayLabel,
                    description: category.description,
                    type: category.type,
                    homeOrder: category.homeOrder,
                    isVisible: category.isVisible,
                  })
                }
                onSaveCategory={handleSaveCategory}
                onDeleteCategory={handleDeleteCategory}
                onMoveHomeCategory={handleMoveHomeCategory}
                onToggleCategoryVisibility={handleToggleCategoryVisibility}
                onRemoveMovieFromCategory={handleRemoveMovieFromCategory}
                actionBusy={actionBusy}
              />
            )}

            {activeTab === 'users' && (
              <AdminUsersTab
                users={filteredUsers}
                search={userSearch}
                onSearchChange={setUserSearch}
              />
            )}

            {activeTab === 'subscription_overrides' && <AdminSubscriptionOverridesTab />}

            {activeTab === 'requests' && (
              <AdminRequestsTab
                requests={filteredRequests}
                search={requestSearch}
                onSearchChange={setRequestSearch}
                requestEdits={requestEdits}
                onChangeRequestEdit={(requestId, nextEdit) =>
                  setRequestEdits((current) => ({ ...current, [requestId]: nextEdit }))
                }
                onSaveRequest={handleSaveRequest}
                actionBusy={actionBusy}
              />
            )}

            {activeTab === 'revenue' && payload?.revenue && (
              <AdminRevenueTab revenue={payload.revenue} />
            )}
          </section>
        )}
      </div>
    </main>
  );
}
