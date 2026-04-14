import { ArrowDown, ArrowUp, Plus, Save, Search } from 'lucide-react';
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
  DraftMoviePart,
  MovieDraft,
  createEmptyMoviePart,
  moveArrayItem,
} from '@/components/admin/controlCenterUtils';
import {
  CategoryChecklist,
  PosterUploadField,
  SourceEditor,
} from '@/components/admin/controlCenterEditors';

export function AdminMoviesTab({
  movies,
  categories,
  libraryAssets,
  search,
  editingMovieId,
  activeMovie,
  draft,
  diagnostics,
  progress,
  actionBusy,
  onSearchChange,
  onStartNew,
  onEditMovie,
  onDeleteMovie,
  onChangeDraft,
  onReset,
  onSave,
  onDeleteStoredPart,
}: {
  movies: Movie[];
  categories: AdminCategory[];
  libraryAssets: AdminLibraryAsset[];
  search: string;
  editingMovieId: string;
  activeMovie: Movie | null;
  draft: MovieDraft;
  diagnostics: string;
  progress: number;
  actionBusy: boolean;
  onSearchChange: (value: string) => void;
  onStartNew: () => void;
  onEditMovie: (movie: Movie) => void;
  onDeleteMovie: (movieId: string, title: string) => void;
  onChangeDraft: (nextDraft: MovieDraft) => void;
  onReset: () => void;
  onSave: () => void;
  onDeleteStoredPart: (movieId: string, part: DraftMoviePart) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_1.35fr]">
      <Card
        title="Movie Catalog"
        description="Search, edit, or delete existing movies. Long movies can be split into ordered MP4 parts."
        action={
          <button
            type="button"
            onClick={onStartNew}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white"
          >
            New Movie
          </button>
        }
      >
        <div className="mb-4 relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <TextInput
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search movies, categories, genres..."
            className="pl-10"
          />
        </div>
        <div className="space-y-3">
          {movies.map((movie) => (
            <div key={movie.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-white">{movie.title}</div>
                  <div className="mt-2 text-xs text-white/50">
                    {(movie.category || []).join(', ') || 'No categories'}
                    {movie.parts?.length ? ` | ${movie.parts.length} part(s)` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onEditMovie(movie)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => onDeleteMovie(movie.id, movie.title)}
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
        title={editingMovieId ? 'Edit Movie' : 'Create Movie'}
        description="Full movie control: metadata, poster, categories, direct MP4 source, and multi-part long movie support."
      >
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <FieldLabel>Title</FieldLabel>
              <TextInput
                value={draft.title}
                onChange={(event) => onChangeDraft({ ...draft, title: event.target.value })}
                placeholder="Movie title"
              />
            </div>
            <div>
              <FieldLabel>VJ</FieldLabel>
              <TextInput
                value={draft.vj}
                onChange={(event) => onChangeDraft({ ...draft, vj: event.target.value })}
                placeholder="Emmy"
              />
            </div>
            <div className="md:col-span-2">
              <FieldLabel>Description Override</FieldLabel>
              <TextArea
                rows={5}
                value={draft.description}
                onChange={(event) =>
                  onChangeDraft({ ...draft, description: event.target.value })
                }
                placeholder="Admin description override"
              />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <PosterUploadField
              label="Poster"
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
                    placeholder="2026"
                  />
                </div>
                <div>
                  <FieldLabel>Language</FieldLabel>
                  <TextInput
                    value={draft.language}
                    onChange={(event) =>
                      onChangeDraft({ ...draft, language: event.target.value })
                    }
                    placeholder="English"
                  />
                </div>
              </div>
              <div>
                <FieldLabel>Genres</FieldLabel>
                <TextInput
                  value={draft.genres}
                  onChange={(event) => onChangeDraft({ ...draft, genres: event.target.value })}
                  placeholder="Action, Romance, Drama"
                />
              </div>
              <div>
                <FieldLabel>Tags</FieldLabel>
                <TextInput
                  value={draft.tags}
                  onChange={(event) => onChangeDraft({ ...draft, tags: event.target.value })}
                  placeholder="revenge, dubbed, classic"
                />
              </div>
              <div>
                <FieldLabel>Cast</FieldLabel>
                <TextInput
                  value={draft.cast}
                  onChange={(event) => onChangeDraft({ ...draft, cast: event.target.value })}
                  placeholder="Actor One, Actor Two"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
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
                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-sm text-white">
                  <input
                    type="checkbox"
                    checked={draft.isTrendingTikTok}
                    onChange={(event) =>
                      onChangeDraft({ ...draft, isTrendingTikTok: event.target.checked })
                    }
                  />
                  Trending on TikTok
                </label>
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

          <SourceEditor
            title="Primary MP4 Source"
            source={draft.source}
            onChange={(source) => onChangeDraft({ ...draft, source })}
            libraryAssets={libraryAssets}
            helpText="Use this when the whole movie is one MP4. If the movie is split into parts below, the first part becomes the primary playback source automatically."
          />

          <div className="rounded-3xl border border-white/10 bg-black/20 p-4 md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black uppercase tracking-[0.2em] text-white">
                  Multi-Part Long Movie
                </div>
                <div className="mt-2 text-xs leading-6 text-white/50">
                  Add Part A, Part B, Part C under the same movie. The frontend will play them in
                  order.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onChangeDraft({
                    ...draft,
                    parts: [...draft.parts, createEmptyMoviePart(draft.parts.length)].map(
                      (part, index) => ({ ...part, order: index + 1 })
                    ),
                  })
                }
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white"
              >
                <Plus size={14} />
                Add Part
              </button>
            </div>

            <div className="space-y-4">
              {draft.parts.map((part, partIndex) => {
                const isPersisted = Boolean(
                  activeMovie?.parts?.find((savedPart) => savedPart.id === part.id)
                );

                return (
                  <div
                    key={part.id}
                    className="rounded-2xl border border-white/10 bg-[#0C1017] p-4"
                  >
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-bold text-white">
                        {part.label || `Part ${partIndex + 1}`}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onChangeDraft({
                              ...draft,
                              parts: moveArrayItem(draft.parts, partIndex, -1).map(
                                (item, index) => ({ ...item, order: index + 1 })
                              ),
                            })
                          }
                          className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onChangeDraft({
                              ...draft,
                              parts: moveArrayItem(draft.parts, partIndex, 1).map(
                                (item, index) => ({ ...item, order: index + 1 })
                              ),
                            })
                          }
                          className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70"
                        >
                          <ArrowDown size={14} />
                        </button>
                        {isPersisted && editingMovieId ? (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => onDeleteStoredPart(editingMovieId, part)}
                            className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100"
                          >
                            Delete Stored Part
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              onChangeDraft({
                                ...draft,
                                parts: draft.parts
                                  .filter((entry) => entry.id !== part.id)
                                  .map((entry, index) => ({ ...entry, order: index + 1 })),
                              })
                            }
                            className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <FieldLabel>Label</FieldLabel>
                        <TextInput
                          value={part.label}
                          onChange={(event) =>
                            onChangeDraft({
                              ...draft,
                              parts: draft.parts.map((entry) =>
                                entry.id === part.id
                                  ? { ...entry, label: event.target.value }
                                  : entry
                              ),
                            })
                          }
                          placeholder="Part A"
                        />
                      </div>
                      <div>
                        <FieldLabel>Title Override</FieldLabel>
                        <TextInput
                          value={part.title}
                          onChange={(event) =>
                            onChangeDraft({
                              ...draft,
                              parts: draft.parts.map((entry) =>
                                entry.id === part.id
                                  ? { ...entry, title: event.target.value }
                                  : entry
                              ),
                            })
                          }
                          placeholder="Kasspar A"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <FieldLabel>Part Description</FieldLabel>
                        <TextArea
                          rows={3}
                          value={part.description}
                          onChange={(event) =>
                            onChangeDraft({
                              ...draft,
                              parts: draft.parts.map((entry) =>
                                entry.id === part.id
                                  ? { ...entry, description: event.target.value }
                                  : entry
                              ),
                            })
                          }
                          placeholder="Optional part-specific note"
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <SourceEditor
                        title="Part MP4 Source"
                        source={part.source}
                        onChange={(source) =>
                          onChangeDraft({
                            ...draft,
                            parts: draft.parts.map((entry) =>
                              entry.id === part.id ? { ...entry, source } : entry
                            ),
                          })
                        }
                        libraryAssets={libraryAssets}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {diagnostics && (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/60">
                Movie Diagnostics
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
              {editingMovieId ? 'Save Movie Changes' : 'Create Movie'}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
