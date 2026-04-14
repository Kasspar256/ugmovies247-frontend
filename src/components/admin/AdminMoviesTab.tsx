import Link from 'next/link';
import { PencilLine, Plus, Search, Trash2 } from 'lucide-react';
import type { Movie } from '@/types/movie';
import { Card, TextInput } from '@/components/admin/controlCenterFields';

export function AdminMoviesTab({
  movies,
  search,
  actionBusy,
  onSearchChange,
  onDeleteMovie,
}: {
  movies: Movie[];
  search: string;
  actionBusy: boolean;
  onSearchChange: (value: string) => void;
  onDeleteMovie: (movieId: string, title: string) => void;
}) {
  return (
    <div className="space-y-6">
      <Card
        title="Upload Movie"
        description="Use the TMDb-assisted movie publisher to upload a direct MP4, confirm clean metadata, and publish without the old manual clutter."
        action={
          <Link
            href="/admin/movies/new"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/10"
          >
            <Plus size={14} />
            Upload Movie
          </Link>
        }
      >
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm leading-7 text-white/62">
          New uploads now open in a dedicated publisher page so creating a movie feels focused,
          clean, and separate from the existing catalog.
        </div>
      </Card>

      <Card
        title="Movie Catalog"
        description="Search, open a dedicated edit page, or delete an existing movie."
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
          {movies.length ? (
            movies.map((movie) => (
              <div
                key={movie.id}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 transition-colors duration-200 hover:bg-black/30"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white">{movie.title}</div>
                    <div className="mt-2 text-xs leading-6 text-white/50">
                      {(movie.category || []).join(', ') || 'No categories'}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Link
                      href={`/admin/movies/${movie.id}`}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                    >
                      <PencilLine size={14} />
                      Edit
                    </Link>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => onDeleteMovie(movie.id, movie.title)}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100 transition-colors hover:bg-red-500/15 disabled:opacity-60"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">
              No movies matched your search.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
