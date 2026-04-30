import { Plus, Save, Search } from 'lucide-react';
import type { AdminCategory, AdminLibraryAsset } from '@/types/admin';
import type { Movie } from '@/types/movie';
import {
  Card,
  FieldLabel,
  SelectInput,
  TextArea,
  TextInput,
} from '@/components/admin/controlCenterFields';
import {
  DraftEpisode,
  SeriesDraft,
  createEmptyEpisode,
  createEmptySeason,
} from '@/components/admin/controlCenterUtils';
import {
  CategoryChecklist,
  PosterUploadField,
  SourceEditor,
} from '@/components/admin/controlCenterEditors';

export function AdminSeriesTab({
  seriesItems,
  categories,
  libraryAssets,
  search,
  editingSeriesId,
  draft,
  diagnostics,
  progress,
  actionBusy,
  onSearchChange,
  onStartNew,
  onEditSeries,
  onDeleteSeries,
  onChangeDraft,
  onReset,
  onSave,
  onDeleteStoredEpisode,
}: {
  seriesItems: Movie[];
  categories: AdminCategory[];
  libraryAssets: AdminLibraryAsset[];
  search: string;
  editingSeriesId: string;
  draft: SeriesDraft;
  diagnostics: string;
  progress: number;
  actionBusy: boolean;
  onSearchChange: (value: string) => void;
  onStartNew: () => void;
  onEditSeries: (series: Movie) => void;
  onDeleteSeries: (movieId: string, title: string) => void;
  onChangeDraft: (nextDraft: SeriesDraft) => void;
  onReset: () => void;
  onSave: () => void;
  onDeleteStoredEpisode: (
    movieId: string,
    seasonNumber: number,
    episodeNumber: number,
    label: string
  ) => void;
}) {
  const updateEpisode = (
    seasonId: string,
    episodeId: string,
    updater: (episode: DraftEpisode) => DraftEpisode
  ) => {
    onChangeDraft({
      ...draft,
      seasons: draft.seasons.map((season) =>
        season.id !== seasonId
          ? season
          : {
              ...season,
              episodes: season.episodes.map((episode) =>
                episode.id === episodeId ? updater(episode) : episode
              ),
            }
      ),
    });
  };

  const moveEpisodeToSeason = (
    sourceSeasonId: string,
    targetSeasonNumber: number,
    episode: DraftEpisode
  ) => {
    const targetSeason = draft.seasons.find(
      (season) => season.seasonNumber === targetSeasonNumber
    );

    if (!targetSeason || targetSeason.id === sourceSeasonId) {
      return;
    }

    onChangeDraft({
      ...draft,
      seasons: draft.seasons
        .map((season) => {
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
        })
        .filter((season) => season.episodes.length > 0),
    });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_1.35fr]">
      <Card
        title="Series Catalog"
        description="Manage series, add future seasons, and keep episode assignments flexible."
        action={
          <button
            type="button"
            onClick={onStartNew}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white"
          >
            New Series
          </button>
        }
      >
        <div className="mb-4 relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <TextInput
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search series..."
            className="pl-10"
          />
        </div>
        <div className="space-y-3">
          {seriesItems.map((series) => (
            <div key={series.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-white">{series.title}</div>
                  <div className="mt-2 text-xs text-white/50">
                    {(series.seasons || []).length} season(s) |{' '}
                    {(series.seasons || []).reduce(
                      (total, season) => total + (season.episodes || []).length,
                      0
                    )}{' '}
                    episode(s)
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onEditSeries(series)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => onDeleteSeries(series.id, series.title)}
                    className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title={editingSeriesId ? 'Edit Series' : 'Create Series'}
        description="Series -> Seasons -> Episodes. Add a new season later, move episodes between seasons, and replace MP4s anytime."
      >
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <FieldLabel>Series Title</FieldLabel>
              <TextInput
                value={draft.title}
                onChange={(event) => onChangeDraft({ ...draft, title: event.target.value })}
                placeholder="Jumong"
              />
            </div>
            <div>
              <FieldLabel>VJ</FieldLabel>
              <TextInput
                value={draft.vj}
                onChange={(event) => onChangeDraft({ ...draft, vj: event.target.value })}
                placeholder="IVO"
              />
            </div>
            <div className="md:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <TextArea
                rows={4}
                value={draft.description}
                onChange={(event) =>
                  onChangeDraft({ ...draft, description: event.target.value })
                }
              />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <PosterUploadField
              label="Series Poster"
              value={draft.poster}
              onUrlChange={(poster) => onChangeDraft({ ...draft, poster })}
              onFileChange={(posterFile) => onChangeDraft({ ...draft, posterFile })}
            />
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Release Year</FieldLabel>
                  <TextInput
                    value={draft.releaseYear}
                    onChange={(event) =>
                      onChangeDraft({ ...draft, releaseYear: event.target.value })
                    }
                  />
                </div>
                <div>
                  <FieldLabel>Language</FieldLabel>
                  <TextInput
                    value={draft.language}
                    onChange={(event) =>
                      onChangeDraft({ ...draft, language: event.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <FieldLabel>Genres</FieldLabel>
                <TextInput
                  value={draft.genres}
                  onChange={(event) => onChangeDraft({ ...draft, genres: event.target.value })}
                />
              </div>
              <div>
                <FieldLabel>Tags</FieldLabel>
                <TextInput
                  value={draft.tags}
                  onChange={(event) => onChangeDraft({ ...draft, tags: event.target.value })}
                />
              </div>
              <div>
                <FieldLabel>Cast</FieldLabel>
                <TextInput
                  value={draft.cast}
                  onChange={(event) => onChangeDraft({ ...draft, cast: event.target.value })}
                />
              </div>
                <div>
                  <div>
                    <FieldLabel>Access Tier</FieldLabel>
                    <SelectInput
                      value={draft.accessTier}
                    onChange={(event) =>
                      onChangeDraft({
                        ...draft,
                        accessTier: event.target.value === 'free' ? 'free' : 'premium',
                      })
                    }
                    >
                      <option value="premium">Premium</option>
                      <option value="free">Free</option>
                    </SelectInput>
                  </div>
                </div>
              </div>
            </div>

          <div>
            <FieldLabel>Categories</FieldLabel>
            <CategoryChecklist
              categories={categories}
              selected={draft.categories}
              onToggle={(name) =>
                onChangeDraft({
                  ...draft,
                  categories: draft.categories.includes(name)
                    ? draft.categories.filter((entry) => entry !== name)
                    : [...draft.categories, name],
                })
              }
            />
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/20 p-4 md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black uppercase tracking-[0.2em] text-white">
                  Seasons & Episodes
                </div>
                <div className="mt-2 text-xs leading-6 text-white/50">
                  Open a series, add Season 7 later, move episodes between seasons, and replace any
                  direct video source anytime.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onChangeDraft({
                    ...draft,
                    seasons: [...draft.seasons, createEmptySeason(draft.seasons.length)],
                  })
                }
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white"
              >
                <Plus size={14} />
                Add Season
              </button>
            </div>

            <div className="space-y-5">
              {draft.seasons
                .slice()
                .sort((left, right) => left.seasonNumber - right.seasonNumber)
                .map((season) => (
                  <div key={season.id} className="rounded-2xl border border-white/10 bg-[#0C1017] p-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <FieldLabel>Season Number</FieldLabel>
                          <TextInput
                            value={String(season.seasonNumber)}
                            onChange={(event) =>
                              onChangeDraft({
                                ...draft,
                                seasons: draft.seasons.map((entry) =>
                                  entry.id === season.id
                                    ? {
                                        ...entry,
                                        seasonNumber: Number(
                                          event.target.value || season.seasonNumber
                                        ),
                                      }
                                    : entry
                                ),
                              })
                            }
                          />
                        </div>
                        <div>
                          <FieldLabel>Season Title</FieldLabel>
                          <TextInput
                            value={season.title}
                            onChange={(event) =>
                              onChangeDraft({
                                ...draft,
                                seasons: draft.seasons.map((entry) =>
                                  entry.id === season.id
                                    ? { ...entry, title: event.target.value }
                                    : entry
                                ),
                              })
                            }
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onChangeDraft({
                            ...draft,
                            seasons: draft.seasons.filter((entry) => entry.id !== season.id),
                          })
                        }
                        className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100"
                      >
                        Remove Season
                      </button>
                    </div>

                    <div className="space-y-4">
                      {season.episodes
                        .slice()
                        .sort((left, right) => left.episodeNumber - right.episodeNumber)
                        .map((episode) => {
                          const savedEpisode =
                            editingSeriesId &&
                            episode.persistedSeasonNumber &&
                            episode.persistedEpisodeNumber;

                          return (
                            <div key={episode.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                              <div className="grid gap-4 md:grid-cols-3">
                                <div>
                                  <FieldLabel>Episode Number</FieldLabel>
                                  <TextInput
                                    value={String(episode.episodeNumber)}
                                    onChange={(event) =>
                                      updateEpisode(season.id, episode.id, (entry) => ({
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
                                    {draft.seasons.map((seasonEntry) => (
                                      <option
                                        key={seasonEntry.id}
                                        value={seasonEntry.seasonNumber}
                                      >
                                        Season {seasonEntry.seasonNumber}
                                      </option>
                                    ))}
                                  </SelectInput>
                                </div>
                                <div>
                                  <FieldLabel>Episode Title</FieldLabel>
                                  <TextInput
                                    value={episode.title}
                                    onChange={(event) =>
                                      updateEpisode(season.id, episode.id, (entry) => ({
                                        ...entry,
                                        title: event.target.value,
                                      }))
                                    }
                                  />
                                </div>
                                <div className="md:col-span-3">
                                  <FieldLabel>Description</FieldLabel>
                                  <TextArea
                                    rows={3}
                                    value={episode.description}
                                    onChange={(event) =>
                                      updateEpisode(season.id, episode.id, (entry) => ({
                                        ...entry,
                                        description: event.target.value,
                                      }))
                                    }
                                  />
                                </div>
                              </div>

                              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                <PosterUploadField
                                  label="Episode Poster"
                                  value={episode.poster}
                                  onUrlChange={(poster) =>
                                    updateEpisode(season.id, episode.id, (entry) => ({
                                      ...entry,
                                      poster,
                                    }))
                                  }
                                  onFileChange={(posterFile) =>
                                    updateEpisode(season.id, episode.id, (entry) => ({
                                      ...entry,
                                      posterFile,
                                    }))
                                  }
                                />
                                <PosterUploadField
                                  label="Episode Thumbnail"
                                  value={episode.thumbnail}
                                  onUrlChange={(thumbnail) =>
                                    updateEpisode(season.id, episode.id, (entry) => ({
                                      ...entry,
                                      thumbnail,
                                    }))
                                  }
                                  onFileChange={(thumbnailFile) =>
                                    updateEpisode(season.id, episode.id, (entry) => ({
                                      ...entry,
                                      thumbnailFile,
                                    }))
                                  }
                                />
                              </div>

                              <div className="mt-4">
                                <SourceEditor
                                  title="Episode Video Source"
                                  source={episode.source}
                                  onChange={(source) =>
                                    updateEpisode(season.id, episode.id, (entry) => ({
                                      ...entry,
                                      source,
                                    }))
                                  }
                                  libraryAssets={libraryAssets}
                                />
                              </div>

                              <div className="mt-4 flex justify-end gap-3">
                                {savedEpisode ? (
                                  <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={() =>
                                      onDeleteStoredEpisode(
                                        editingSeriesId,
                                        Number(episode.persistedSeasonNumber),
                                        Number(episode.persistedEpisodeNumber),
                                        `${season.title} / ${episode.title}`
                                      )
                                    }
                                    className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100"
                                  >
                                    Delete Stored Episode
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onChangeDraft({
                                        ...draft,
                                        seasons: draft.seasons.map((seasonEntry) =>
                                          seasonEntry.id !== season.id
                                            ? seasonEntry
                                            : {
                                                ...seasonEntry,
                                                episodes: seasonEntry.episodes.filter(
                                                  (episodeEntry) =>
                                                    episodeEntry.id !== episode.id
                                                ),
                                              }
                                        ),
                                      })
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

                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() =>
                          onChangeDraft({
                            ...draft,
                            seasons: draft.seasons.map((entry) =>
                              entry.id === season.id
                                ? {
                                    ...entry,
                                    episodes: [
                                      ...entry.episodes,
                                      createEmptyEpisode(entry.episodes.length),
                                    ],
                                  }
                                : entry
                            ),
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white"
                      >
                        <Plus size={14} />
                        Add Episode
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {diagnostics && (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/60">
                Series Diagnostics
              </div>
              <pre className="mt-3 whitespace-pre-wrap text-xs leading-6 text-white/75">
                {diagnostics}
              </pre>
            </div>
          )}

          {progress > 0 && (
            <div className="overflow-hidden rounded-full border border-white/10 bg-black/30">
              <div className="h-3 bg-[#D90429]" style={{ width: `${progress}%` }} />
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onReset}
              className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white"
            >
              Reset
            </button>
            <button
              type="button"
              disabled={actionBusy}
              onClick={onSave}
              className="inline-flex items-center gap-2 rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
            >
              <Save size={14} />
              {editingSeriesId ? 'Save Series Changes' : 'Create Series'}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
