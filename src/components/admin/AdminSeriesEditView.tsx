'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  FolderPlus,
  Gauge,
  Plus,
  Save,
} from 'lucide-react';
import type {
  AdminCategory,
  AdminControlCenterPayload,
  AdminLibraryAsset,
} from '@/types/admin';
import type { Movie } from '@/types/movie';
import {
  parseApiResponse,
  type MultipartUploadStats,
  uploadMultipartFileToAdmin,
  uploadPosterToAdmin,
} from '@/lib/admin/directUploadClient';
import {
  CategoryChecklist,
  SourceEditor,
} from '@/components/admin/controlCenterEditors';
import {
  Card,
  FieldLabel,
  SelectInput,
  TextArea,
  TextInput,
} from '@/components/admin/controlCenterFields';
import {
  type DraftEpisode,
  type DraftSeason,
  type DraftVideoSource,
  type SeriesDraft,
  createEmptyEpisode,
  createEmptySeason,
  seriesToDraft,
  splitCommaList,
} from '@/components/admin/controlCenterUtils';

const SERIES_CATEGORY_OPTIONS = [
  { name: 'Latest series', label: 'Latest series' },
  { name: 'Ongoing Series', label: 'Ongoing Series' },
  { name: 'VJ JUNIOR SERIES', label: 'VJ JUNIOR SERIES' },
  { name: 'Asian series', label: 'Asian series' },
  { name: 'Western series', label: 'Western series' },
  { name: 'Other vjs', label: 'Other vjs' },
  { name: 'Trending on tiktok', label: 'Tag as Trending on TikTok' },
] as const;

function sortSeasons(seasons: DraftSeason[]) {
  return [...seasons].sort((left, right) => left.seasonNumber - right.seasonNumber);
}

function countEpisodes(seasons: DraftSeason[]) {
  return seasons.reduce((total, season) => total + season.episodes.length, 0);
}

function clampLogLines(lines: string[]) {
  return lines.slice(-20);
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

function parseReleaseYear(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1800 ? parsed : null;
}

function hasPersistedEpisodes(season: DraftSeason) {
  return season.episodes.some(
    (episode) =>
      episode.persistedSeasonNumber !== null &&
      episode.persistedSeasonNumber !== undefined &&
      episode.persistedEpisodeNumber !== null &&
      episode.persistedEpisodeNumber !== undefined
  );
}

function resolveEpisodeSourceLabel(source: DraftVideoSource) {
  if (source.mode === 'file' && source.file) {
    return source.file.name;
  }

  return source.url.trim() ? source.url.trim() : 'No source selected';
}

function ImageReplaceField({
  label,
  value,
  file,
  onFileChange,
  emptyMessage,
  previewClassName,
}: {
  label: string;
  value: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  emptyMessage: string;
  previewClassName?: string;
}) {
  return (
    <div className="space-y-3">
      <FieldLabel>{label}</FieldLabel>
      <input
        type="file"
        accept="image/*"
        onChange={(event) => onFileChange(event.target.files?.[0] || null)}
        className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0C1017] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
      />
      {file ? (
        <div className="rounded-2xl border border-[#D90429]/20 bg-[#17070B] px-4 py-3 text-xs leading-6 text-white/78">
          Pending replacement: {file.name}
        </div>
      ) : null}
      {value ? (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <img
            src={value}
            alt={label}
            className={previewClassName || 'h-56 w-full object-cover'}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}

export function AdminSeriesEditView({ seriesId }: { seriesId: string }) {
  const router = useRouter();
  const diagnosticsRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [series, setSeries] = useState<Movie | null>(null);
  const [draft, setDraft] = useState<SeriesDraft | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<AdminLibraryAsset[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadStats, setUploadStats] = useState<MultipartUploadStats | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);

  const appendDiagnostic = (message: string) => {
    const trimmed = message.trim();

    if (!trimmed) {
      return;
    }

    setDiagnostics((current) => clampLogLines([...current, trimmed]));
  };

  const loadEditor = async (showSpinner = true) => {
    if (showSpinner) {
      setLoading(true);
    }

    try {
      const response = await fetch('/api/admin/control-center', {
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = (await response.json()) as Partial<AdminControlCenterPayload> & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load series editor.');
      }

      const nextSeries =
        (payload.movies || []).find(
          (entry) => entry.id === seriesId && entry.contentType === 'series'
        ) || null;

      if (!nextSeries) {
        throw new Error('Series not found.');
      }

      setSeries(nextSeries);
      setDraft(seriesToDraft(nextSeries));
      setCategories(payload.categories || []);
      setLibraryAssets(payload.libraryAssets || []);
      return nextSeries;
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to load series editor.'
      );
      return null;
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadEditor();
  }, [seriesId]);

  useEffect(() => {
    if (!diagnosticsRef.current) {
      return;
    }

    diagnosticsRef.current.scrollTop = diagnosticsRef.current.scrollHeight;
  }, [diagnostics]);

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

  const updateDraftEpisode = (
    seasonId: string,
    episodeId: string,
    updater: (episode: DraftEpisode) => DraftEpisode
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            seasons: current.seasons.map((season) =>
              season.id !== seasonId
                ? season
                : {
                    ...season,
                    episodes: season.episodes.map((episode) =>
                      episode.id === episodeId ? updater(episode) : episode
                    ),
                  }
            ),
          }
        : current
    );
  };

  const moveEpisodeToSeason = (
    sourceSeasonId: string,
    targetSeasonNumber: number,
    episode: DraftEpisode
  ) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const targetSeason = current.seasons.find(
        (season) => season.seasonNumber === targetSeasonNumber
      );

      if (!targetSeason || targetSeason.id === sourceSeasonId) {
        return current;
      }

      return {
        ...current,
        seasons: current.seasons.map((season) => {
          if (season.id === sourceSeasonId) {
            return {
              ...season,
              episodes: season.episodes.filter((entry) => entry.id !== episode.id),
            };
          }

          if (season.id === targetSeason.id) {
            return {
              ...season,
              episodes: [
                ...season.episodes,
                {
                  ...episode,
                  persistedSeasonNumber: null,
                  persistedEpisodeNumber: null,
                },
              ],
            };
          }

          return season;
        }),
      };
    });
  };

  const handleDeleteStoredEpisode = async (
    season: DraftSeason,
    episode: DraftEpisode
  ) => {
    if (
      !episode.persistedSeasonNumber ||
      !episode.persistedEpisodeNumber ||
      !series
    ) {
      return;
    }

    const label = `${season.title || `Season ${season.seasonNumber}`} / ${
      episode.title || `Episode ${episode.episodeNumber}`
    }`;
    const confirmed = window.confirm(`Delete "${label}" from this series?`);

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const response = await fetch(
        `/api/admin/movies/${series.id}?seasonNumber=${episode.persistedSeasonNumber}&episodeNumber=${episode.persistedEpisodeNumber}`,
        {
          method: 'DELETE',
        }
      );
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to delete stored episode.');
      }

      await loadEditor(false);
      setStatusMessage(`Deleted ${label}.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to delete stored episode.'
      );
    } finally {
      setSaving(false);
    }
  };

  const resolvePosterUrl = async (currentUrl: string, file: File | null) => {
    if (!file) {
      return currentUrl.trim();
    }

    const uploadedPoster = await uploadPosterToAdmin(file);
    return uploadedPoster.publicUrl;
  };

  const resolveVideoSource = async (source: DraftVideoSource) => {
    if (source.mode === 'file' && source.file) {
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
      sourceType: 'remote_link' as const,
    };
  };

  const handleSaveSeries = async () => {
    if (!series || !draft) {
      return;
    }

    if (!draft.title.trim()) {
      setErrorMessage('Series title is required.');
      return;
    }

    if (!draft.seasons.length) {
      setErrorMessage('Add at least one season before saving.');
      return;
    }

    const emptySeason = draft.seasons.find((season) => season.episodes.length === 0);

    if (emptySeason) {
      setErrorMessage(
        `${emptySeason.title || `Season ${emptySeason.seasonNumber}`} needs at least one episode before you can save it.`
      );
      return;
    }

    const incompleteEpisode = draft.seasons
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

    setSaving(true);
    setStatusMessage('');
    setErrorMessage('');
    setDiagnostics([]);
    setUploadStats(null);

    try {
      const posterUrl = await resolvePosterUrl(draft.poster, draft.posterFile);
      const seasons = [];

      for (const [seasonIndex, season] of sortSeasons(draft.seasons).entries()) {
        const seasonPoster = await resolvePosterUrl(season.poster, season.posterFile);
        const episodes = [];

        for (const [episodeIndex, episode] of [...season.episodes]
          .sort((left, right) => left.episodeNumber - right.episodeNumber)
          .entries()) {
          const episodeSource = await resolveVideoSource(episode.source);
          const episodePoster = await resolvePosterUrl(episode.poster, episode.posterFile);
          const episodeThumbnail = await resolvePosterUrl(
            episode.thumbnail,
            episode.thumbnailFile
          );

          episodes.push({
            episodeNumber: episode.episodeNumber || episodeIndex + 1,
            title: episode.title.trim() || `Episode ${episodeIndex + 1}`,
            description: episode.description.trim(),
            poster: episodePoster || episodeThumbnail || seasonPoster || posterUrl,
            thumbnail: episodeThumbnail || episodePoster || seasonPoster || posterUrl,
            ...episodeSource,
          });
        }

        seasons.push({
          seasonNumber: season.seasonNumber || seasonIndex + 1,
          title: season.title.trim() || `Season ${seasonIndex + 1}`,
          overview: season.overview.trim(),
          poster: seasonPoster || posterUrl,
          tmdb_id: season.tmdbId ?? null,
          episodes,
        });
      }

      const response = await fetch(`/api/admin/movies/${series.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movie: {
            contentType: 'series',
            title: draft.title.trim(),
            description: draft.description.trim(),
            poster: posterUrl,
            releaseYear: parseReleaseYear(draft.releaseYear),
            language: draft.language.trim(),
            vj: draft.vj.trim() || 'Unknown',
            genres: splitCommaList(draft.genres),
            tags: splitCommaList(draft.tags),
            cast: splitCommaList(draft.cast),
            accessTier: draft.accessTier,
            is_trending_tiktok:
              draft.isTrendingTikTok || draft.categories.includes('Trending on tiktok'),
            category: draft.categories,
            tmdb_id: series.tmdb_id ?? null,
            seasons,
          },
        }),
      });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to save series changes.');
      }

      const refreshedSeries = await loadEditor(false);

      if (refreshedSeries) {
        setSeries(refreshedSeries);
        setDraft(seriesToDraft(refreshedSeries));
      }

      setStatusMessage(`Saved changes for "${draft.title.trim()}".`);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to save series changes.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0B0C10] px-4 py-8 text-white md:px-8 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-[32px] border border-white/10 bg-[#11141C] p-6 text-sm text-white/55">
          Loading series editor...
        </div>
      </main>
    );
  }

  if (!draft || !series) {
    return (
      <main className="min-h-screen bg-[#0B0C10] px-4 py-8 text-white md:px-8 lg:px-10">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="rounded-[32px] border border-white/10 bg-[#11141C] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.3em] text-white/45">
                  Series
                </div>
                <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.14em] text-white md:text-4xl">
                  Edit Series
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-white/65">
                  This series could not be loaded for editing right now.
                </p>
              </div>
              <Link
                href="/admin/series"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-white transition-colors hover:bg-white/10"
              >
                <ArrowLeft size={14} />
                Back To Series
              </Link>
            </div>
          </header>

          <Card title="Series Not Found" description="Go back to the series page and reopen the title from the browser.">
            <div className="text-sm text-white/55">{errorMessage || 'Series not found.'}</div>
          </Card>
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
                Edit Series
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/68">
                Update the series details, fix any season metadata, replace episode MP4s, and keep
                every season and episode exactly how you want it.
              </p>
            </div>
            <Link
              href="/admin/series"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-white transition-colors hover:bg-white/10"
            >
              <ArrowLeft size={14} />
              Back To Series
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

        <div className="grid gap-6 xl:grid-cols-[1.08fr_360px]">
          <Card
            title="Series Details"
            description="Fix the core metadata here, then move into seasons and episodes below."
            action={
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveSeries()}
                className="inline-flex items-center gap-2 rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
              >
                <Save size={14} />
                Save Changes
              </button>
            }
          >
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <FieldLabel>Series Title</FieldLabel>
                  <TextInput
                    value={draft.title}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, title: event.target.value } : current
                      )
                    }
                    placeholder="Series title"
                  />
                </div>
                <div className="md:col-span-2">
                  <FieldLabel>Description</FieldLabel>
                  <TextArea
                    rows={5}
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, description: event.target.value } : current
                      )
                    }
                    placeholder="Series description"
                  />
                </div>
                <div>
                  <FieldLabel>Release Year</FieldLabel>
                  <TextInput
                    value={draft.releaseYear}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, releaseYear: event.target.value } : current
                      )
                    }
                    placeholder="2026"
                  />
                </div>
                <div>
                  <FieldLabel>Language</FieldLabel>
                  <TextInput
                    value={draft.language}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, language: event.target.value } : current
                      )
                    }
                    placeholder="Korean"
                  />
                </div>
                <div>
                  <FieldLabel>VJ</FieldLabel>
                  <TextInput
                    value={draft.vj}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, vj: event.target.value } : current
                      )
                    }
                    placeholder="Unknown"
                  />
                </div>
                <div>
                  <FieldLabel>Genres</FieldLabel>
                  <TextInput
                    value={draft.genres}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, genres: event.target.value } : current
                      )
                    }
                    placeholder="Drama, Action"
                  />
                </div>
                <div>
                  <FieldLabel>Tags</FieldLabel>
                  <TextInput
                    value={draft.tags}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, tags: event.target.value } : current
                      )
                    }
                    placeholder="Historical, Epic"
                  />
                </div>
                <div>
                  <FieldLabel>Cast</FieldLabel>
                  <TextInput
                    value={draft.cast}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, cast: event.target.value } : current
                      )
                    }
                    placeholder="Lead cast"
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Manual Home Categories</FieldLabel>
                <CategoryChecklist
                  categories={manualSeriesCategories}
                  selected={draft.categories}
                  onToggle={(name) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.includes(name)
                              ? current.categories.filter((entry) => entry !== name)
                              : [...current.categories, name],
                          }
                        : current
                    )
                  }
                  className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
                  getLabel={(category) => categoryLabelMap.get(category.name) || category.name}
                />
              </div>
            </div>
          </Card>

          <Card
            title="Series Poster"
            description={`${draft.seasons.length} season(s) | ${countEpisodes(draft.seasons)} episode(s) currently in this editor.`}
          >
            <ImageReplaceField
              label="Series Poster"
              value={draft.poster}
              file={draft.posterFile}
              onFileChange={(file) =>
                setDraft((current) =>
                  current ? { ...current, posterFile: file } : current
                )
              }
              emptyMessage="No poster is currently set for this series."
              previewClassName="h-[420px] w-full object-cover"
            />
          </Card>
        </div>

        <Card
          title="Seasons & Episodes"
          description="Edit any season, replace any episode source, move episodes between seasons, and add new seasons whenever you need to."
          action={
            <button
              type="button"
              onClick={() =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        seasons: [...current.seasons, createEmptySeason(current.seasons.length)],
                      }
                    : current
                )
              }
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
            >
              <FolderPlus size={14} />
              Add Season
            </button>
          }
        >
          <div className="space-y-5">
            {sortSeasons(draft.seasons).map((season) => {
              const seasonHasStoredEpisodes = hasPersistedEpisodes(season);

              return (
                <div
                  key={season.id}
                  className="rounded-[28px] border border-white/10 bg-[#0C1017] p-4 md:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-black uppercase tracking-[0.18em] text-white">
                        {season.title || `Season ${season.seasonNumber}`}
                      </div>
                      <div className="mt-2 text-xs leading-6 text-white/48">
                        {season.episodes.length} episode(s) in this season
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={seasonHasStoredEpisodes}
                      onClick={() => {
                        if (seasonHasStoredEpisodes) {
                          return;
                        }

                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                seasons: current.seasons.filter(
                                  (entry) => entry.id !== season.id
                                ),
                              }
                            : current
                        );
                      }}
                      className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Remove Season
                    </button>
                  </div>

                  {seasonHasStoredEpisodes ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs leading-6 text-white/48">
                      Delete stored episodes inside this season first if you want to remove the whole season.
                    </div>
                  ) : null}

                  <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_300px]">
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <FieldLabel>Season Number</FieldLabel>
                          <TextInput
                            value={String(season.seasonNumber)}
                            onChange={(event) =>
                              setDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      seasons: current.seasons.map((entry) =>
                                        entry.id === season.id
                                          ? {
                                              ...entry,
                                              seasonNumber: Number(
                                                event.target.value || season.seasonNumber
                                              ),
                                            }
                                          : entry
                                      ),
                                    }
                                  : current
                              )
                            }
                          />
                        </div>
                        <div>
                          <FieldLabel>Season Title</FieldLabel>
                          <TextInput
                            value={season.title}
                            onChange={(event) =>
                              setDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      seasons: current.seasons.map((entry) =>
                                        entry.id === season.id
                                          ? { ...entry, title: event.target.value }
                                          : entry
                                      ),
                                    }
                                  : current
                              )
                            }
                            placeholder={`Season ${season.seasonNumber}`}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <FieldLabel>Season Overview</FieldLabel>
                          <TextArea
                            rows={4}
                            value={season.overview}
                            onChange={(event) =>
                              setDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      seasons: current.seasons.map((entry) =>
                                        entry.id === season.id
                                          ? { ...entry, overview: event.target.value }
                                          : entry
                                      ),
                                    }
                                  : current
                              )
                            }
                            placeholder="Optional season overview"
                          />
                        </div>
                      </div>

                      <div className="space-y-4">
                        {[...season.episodes]
                          .sort((left, right) => left.episodeNumber - right.episodeNumber)
                          .map((episode) => {
                            const storedEpisode =
                              episode.persistedSeasonNumber !== null &&
                              episode.persistedSeasonNumber !== undefined &&
                              episode.persistedEpisodeNumber !== null &&
                              episode.persistedEpisodeNumber !== undefined;

                            return (
                              <div
                                key={episode.id}
                                className="rounded-2xl border border-white/10 bg-black/20 p-4"
                              >
                                <div className="grid gap-4 md:grid-cols-3">
                                  <div>
                                    <FieldLabel>Episode Number</FieldLabel>
                                    <TextInput
                                      value={String(episode.episodeNumber)}
                                      onChange={(event) =>
                                        updateDraftEpisode(season.id, episode.id, (entry) => ({
                                          ...entry,
                                          episodeNumber: Number(
                                            event.target.value || episode.episodeNumber
                                          ),
                                        }))
                                      }
                                    />
                                  </div>
                                  <div>
                                    <FieldLabel>Move To Season</FieldLabel>
                                    <SelectInput
                                      value={String(season.seasonNumber)}
                                      onChange={(event) =>
                                        moveEpisodeToSeason(
                                          season.id,
                                          Number(event.target.value),
                                          episode
                                        )
                                      }
                                    >
                                      {sortSeasons(draft.seasons).map((seasonEntry) => (
                                        <option
                                          key={seasonEntry.id}
                                          value={seasonEntry.seasonNumber}
                                        >
                                          {seasonEntry.title || `Season ${seasonEntry.seasonNumber}`}
                                        </option>
                                      ))}
                                    </SelectInput>
                                  </div>
                                  <div>
                                    <FieldLabel>Episode Title</FieldLabel>
                                    <TextInput
                                      value={episode.title}
                                      onChange={(event) =>
                                        updateDraftEpisode(season.id, episode.id, (entry) => ({
                                          ...entry,
                                          title: event.target.value,
                                        }))
                                      }
                                      placeholder="Episode title"
                                    />
                                  </div>
                                  <div className="md:col-span-3">
                                    <FieldLabel>Description</FieldLabel>
                                    <TextArea
                                      rows={4}
                                      value={episode.description}
                                      onChange={(event) =>
                                        updateDraftEpisode(season.id, episode.id, (entry) => ({
                                          ...entry,
                                          description: event.target.value,
                                        }))
                                      }
                                      placeholder="Optional episode description"
                                    />
                                  </div>
                                </div>

                                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                                  <ImageReplaceField
                                    label="Episode Poster"
                                    value={episode.poster}
                                    file={episode.posterFile}
                                    onFileChange={(file) =>
                                      updateDraftEpisode(season.id, episode.id, (entry) => ({
                                        ...entry,
                                        posterFile: file,
                                      }))
                                    }
                                    emptyMessage="No poster is currently set for this episode."
                                  />
                                  <ImageReplaceField
                                    label="Episode Thumbnail"
                                    value={episode.thumbnail}
                                    file={episode.thumbnailFile}
                                    onFileChange={(file) =>
                                      updateDraftEpisode(season.id, episode.id, (entry) => ({
                                        ...entry,
                                        thumbnailFile: file,
                                      }))
                                    }
                                    emptyMessage="No thumbnail is currently set for this episode."
                                  />
                                </div>

                                <div className="mt-4">
                                  <SourceEditor
                                    title="Episode MP4 Source"
                                    source={episode.source}
                                    onChange={(source) =>
                                      updateDraftEpisode(season.id, episode.id, (entry) => ({
                                        ...entry,
                                        source,
                                      }))
                                    }
                                    libraryAssets={libraryAssets}
                                    helpText={`Current source: ${resolveEpisodeSourceLabel(episode.source)}`}
                                  />
                                </div>

                                <div className="mt-4 flex flex-wrap justify-end gap-3">
                                  {storedEpisode ? (
                                    <button
                                      type="button"
                                      disabled={saving}
                                      onClick={() => void handleDeleteStoredEpisode(season, episode)}
                                      className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100 disabled:opacity-60"
                                    >
                                      Delete Stored Episode
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDraft((current) =>
                                          current
                                            ? {
                                                ...current,
                                                seasons: current.seasons.map((entry) =>
                                                  entry.id !== season.id
                                                    ? entry
                                                    : {
                                                        ...entry,
                                                        episodes: entry.episodes.filter(
                                                          (episodeEntry) =>
                                                            episodeEntry.id !== episode.id
                                                        ),
                                                      }
                                                ),
                                              }
                                            : current
                                        )
                                      }
                                      className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100"
                                    >
                                      Remove Episode
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  seasons: current.seasons.map((entry) =>
                                    entry.id !== season.id
                                      ? entry
                                      : {
                                          ...entry,
                                          episodes: [
                                            ...entry.episodes,
                                            createEmptyEpisode(entry.episodes.length),
                                          ],
                                        }
                                  ),
                                }
                              : current
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                      >
                        <Plus size={14} />
                        Add Episode
                      </button>
                    </div>

                    <div>
                      <ImageReplaceField
                        label="Season Poster"
                        value={season.poster}
                        file={season.posterFile}
                        onFileChange={(file) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  seasons: current.seasons.map((entry) =>
                                    entry.id === season.id
                                      ? { ...entry, posterFile: file }
                                      : entry
                                  ),
                                }
                              : current
                          )
                        }
                        emptyMessage="No season poster is currently set."
                        previewClassName="h-[360px] w-full object-cover"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card
          title="Upload Activity"
          description="Episode replacements use the same direct MP4 uploader, so you can keep an eye on progress and diagnostics here."
        >
          <div className="space-y-4">
            {uploadStats ? (
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
            ) : null}

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
                  Upload activity will appear here when you replace an episode source with a new MP4 file.
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveSeries()}
            className="inline-flex items-center gap-2 rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
          >
            <Save size={14} />
            Save Series Changes
          </button>
        </div>
      </div>
    </main>
  );
}
