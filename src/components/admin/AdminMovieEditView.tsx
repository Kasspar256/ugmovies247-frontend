'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import type { AdminCategory, AdminControlCenterPayload } from '@/types/admin';
import type { Movie } from '@/types/movie';
import { parseApiResponse, uploadPosterToAdmin } from '@/lib/admin/directUploadClient';
import { Card, FieldLabel, TextArea, TextInput } from '@/components/admin/controlCenterFields';
import { CategoryChecklist } from '@/components/admin/controlCenterEditors';

const TRENDING_CATEGORY = 'Trending on tiktok';

function normalizeYear(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1800 ? parsed : null;
}

export function AdminMovieEditView({ movieId }: { movieId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [title, setTitle] = useState('');
  const [vj, setVj] = useState('');
  const [description, setDescription] = useState('');
  const [releaseYear, setReleaseYear] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadMovie = async () => {
      try {
        const response = await fetch('/api/admin/control-center', {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = (await response.json()) as Partial<AdminControlCenterPayload> & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load movie editor.');
        }

        const nextMovie =
          (payload.movies || []).find(
            (entry) => entry.id === movieId && entry.contentType !== 'series'
          ) || null;

        if (!nextMovie) {
          throw new Error('Movie not found.');
        }

        if (!mounted) {
          return;
        }

        setMovie(nextMovie);
        setCategories(payload.categories || []);
        setTitle(nextMovie.title || '');
        setVj(nextMovie.vj || 'Unknown');
        setDescription(nextMovie.description || nextMovie.overview || '');
        setReleaseYear(
          nextMovie.releaseYear
            ? String(nextMovie.releaseYear)
            : nextMovie.release_date?.slice(0, 4) || ''
        );
        setSelectedCategories(nextMovie.category || []);
        setPosterPreview(nextMovie.poster || '');
      } catch (error) {
        if (mounted) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load movie editor.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadMovie();

    return () => {
      mounted = false;
    };
  }, [movieId]);

  useEffect(() => {
    if (!posterFile) {
      if (movie?.poster) {
        setPosterPreview(movie.poster);
      }
      return;
    }

    const previewUrl = URL.createObjectURL(posterFile);
    setPosterPreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [movie?.poster, posterFile]);

  const toggleCategory = (name: string) => {
    setSelectedCategories((current) =>
      current.includes(name)
        ? current.filter((entry) => entry !== name)
        : [...current, name]
    );
  };

  const handleSaveMovie = async () => {
    if (!movie) {
      return;
    }

    if (!title.trim()) {
      setErrorMessage('Movie title is required.');
      return;
    }

    setSaving(true);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const uploadedPoster = posterFile ? await uploadPosterToAdmin(posterFile) : null;

      const response = await fetch(`/api/admin/movies/${movie.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movie: {
            contentType: movie.contentType || 'movie',
            title: title.trim(),
            description: description.trim(),
            poster: uploadedPoster?.publicUrl || movie.poster || '',
            releaseYear: normalizeYear(releaseYear),
            category: selectedCategories,
            vj: vj.trim() || 'Unknown',
            is_trending_tiktok: selectedCategories.includes(TRENDING_CATEGORY),
            tmdb_id: movie.tmdb_id ?? null,
          },
        }),
      });
      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to save movie changes.');
      }

      setMovie(result.payload.movie as Movie);
      setPosterFile(null);
      setStatusMessage(`Saved changes for "${title.trim()}".`);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to save movie changes.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0B0C10] px-4 py-8 text-white md:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl rounded-[32px] border border-white/10 bg-[#11141C] p-6 text-sm text-white/55">
          Loading movie editor...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 py-8 text-white md:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[32px] border border-white/10 bg-[#11141C] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.3em] text-white/45">
                Movies
              </div>
              <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.14em] text-white md:text-4xl">
                Edit Movie
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/65">
                Update the movie details in one focused page instead of editing inside the catalog.
              </p>
            </div>
            <Link
              href="/admin/movies"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-white transition-colors hover:bg-white/10"
            >
              <ArrowLeft size={14} />
              Back To Movies
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

        {movie ? (
          <div className="grid gap-6 xl:grid-cols-[1.05fr_1.2fr]">
            <Card
              title="Edit Movie"
              description="Keep this focused: correct the poster, title, description, categories, VJ, and release year here."
            >
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <FieldLabel>Title</FieldLabel>
                    <TextInput
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Movie title"
                    />
                  </div>
                  <div>
                    <FieldLabel>VJ</FieldLabel>
                    <TextInput
                      value={vj}
                      onChange={(event) => setVj(event.target.value)}
                      placeholder="Emmy"
                    />
                  </div>
                  <div>
                    <FieldLabel>Release Year</FieldLabel>
                    <TextInput
                      value={releaseYear}
                      onChange={(event) => setReleaseYear(event.target.value)}
                      placeholder="2026"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel>Description Override</FieldLabel>
                    <TextArea
                      rows={6}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Admin description override"
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel>Manual Home Categories</FieldLabel>
                  <CategoryChecklist
                    categories={categories}
                    selected={selectedCategories}
                    onToggle={toggleCategory}
                  />
                </div>

                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveMovie}
                    className="inline-flex items-center gap-2 rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                  >
                    <Save size={14} />
                    Save Movie Changes
                  </button>
                </div>
              </div>
            </Card>

            <Card
              title="Poster"
              description="Replace the current artwork here. The existing poster stays until you upload a new one."
            >
              <div className="space-y-4">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setPosterFile(event.target.files?.[0] || null)}
                  className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0C1017] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
                />
                {posterPreview ? (
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <img
                      src={posterPreview}
                      alt={title || 'Poster preview'}
                      className="h-[420px] w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">
                    No poster is currently set for this movie.
                  </div>
                )}
              </div>
            </Card>
          </div>
        ) : (
          <Card title="Movie Not Found" description="This movie could not be loaded for editing.">
            <div className="text-sm text-white/55">
              Go back to the movie catalog and try opening the title again.
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
