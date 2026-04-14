'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Gauge, Search, UploadCloud } from 'lucide-react';
import type { AdminCategory, AdminControlCenterPayload } from '@/types/admin';
import { extractMovieData } from '@/lib/movieUtils';
import {
  MAX_DIRECT_MULTIPART_PART_SIZE_BYTES,
  MIN_DIRECT_MULTIPART_PART_SIZE_BYTES,
  type MultipartUploadStats,
  parseApiResponse,
  uploadMultipartFileToAdmin,
  uploadPosterToAdmin,
} from '@/lib/admin/directUploadClient';
import { Card, FieldLabel, TextArea, TextInput } from '@/components/admin/controlCenterFields';
import { CategoryChecklist } from '@/components/admin/controlCenterEditors';

type PublishMode = 'upload' | 'link';

type TmdbResult = {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
};

const TRENDING_CATEGORY = 'Trending on tiktok';
const MANUAL_CATEGORY_ORDER = [
  'Trending on tiktok',
  'Latest movies on Ugmovies24_7',
  'Ongoing Series',
  'Recently added',
  'Latest series',
  'VJ JUNIOR SERIES',
  'Asian series',
  'Other vjs',
  'Western series',
] as const;

function buildTmdbPosterUrl(path?: string | null) {
  return path ? `https://image.tmdb.org/t/p/w780${path}` : '';
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

export function AdminMovieCreateView() {
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const [movieFileInputKey, setMovieFileInputKey] = useState(0);
  const [posterFileInputKey, setPosterFileInputKey] = useState(0);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [mode, setMode] = useState<PublishMode>('upload');
  const [movieFile, setMovieFile] = useState<File | null>(null);
  const [movieUrl, setMovieUrl] = useState('');
  const [title, setTitle] = useState('');
  const [vj, setVj] = useState('');
  const [description, setDescription] = useState('');
  const [releaseYear, setReleaseYear] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [tmdbQuery, setTmdbQuery] = useState('');
  const [tmdbResults, setTmdbResults] = useState<TmdbResult[]>([]);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [selectedTmdb, setSelectedTmdb] = useState<TmdbResult | null>(null);
  const [showTmdbResults, setShowTmdbResults] = useState(false);
  const [posterOverrideFile, setPosterOverrideFile] = useState<File | null>(null);
  const [posterOverridePreview, setPosterOverridePreview] = useState('');
  const [uploadStats, setUploadStats] = useState<MultipartUploadStats | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [uploadedMovieTitle, setUploadedMovieTitle] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadCategories = async () => {
      try {
        const response = await fetch('/api/admin/control-center', {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = (await response.json()) as Partial<AdminControlCenterPayload> & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load movie uploader.');
        }

        if (mounted) {
          setCategories(payload.categories || []);
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(
            error instanceof Error ? error.message : 'Failed to load movie uploader.'
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadCategories();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!posterOverrideFile) {
      setPosterOverridePreview('');
      return;
    }

    const previewUrl = URL.createObjectURL(posterOverrideFile);
    setPosterOverridePreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [posterOverrideFile]);

  useEffect(() => {
    if (!logContainerRef.current) {
      return;
    }

    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [logLines]);

  const currentPoster = useMemo(
    () => posterOverridePreview || buildTmdbPosterUrl(selectedTmdb?.poster_path),
    [posterOverridePreview, selectedTmdb]
  );
  const manualCategories = useMemo(() => {
    const categoryMap = new Map(categories.map((category) => [category.name, category]));
    return MANUAL_CATEGORY_ORDER.map((name) => categoryMap.get(name)).filter(
      (category): category is AdminCategory => Boolean(category)
    );
  }, [categories]);

  const appendLogLine = (message: string) => {
    const cleanedMessage = message.trim();

    if (!cleanedMessage) {
      return;
    }

    setLogLines((current) => clampLogLines([...current, cleanedMessage]));
  };

  const resetUploadForm = () => {
    setMode('upload');
    setMovieFile(null);
    setMovieUrl('');
    setTitle('');
    setVj('');
    setDescription('');
    setReleaseYear('');
    setSelectedCategories([]);
    setTmdbQuery('');
    setTmdbResults([]);
    setSelectedTmdb(null);
    setShowTmdbResults(false);
    setPosterOverrideFile(null);
    setPosterOverridePreview('');
    setUploadStats(null);
    setLogLines([]);
    setStatusMessage('');
    setErrorMessage('');
    setUploadedMovieTitle('');
    setMovieFileInputKey((current) => current + 1);
    setPosterFileInputKey((current) => current + 1);
  };

  const applyDetectedMovieData = (rawValue: string) => {
    const detected = extractMovieData(rawValue);

    if (!title.trim() && detected.title) {
      setTitle(detected.title);
      setTmdbQuery(detected.title);
    }

    if (!vj.trim() && detected.vj) {
      setVj(detected.vj);
    }
  };

  const handleTmdbSearch = async () => {
    const query = tmdbQuery.trim() || title.trim();

    if (!query) {
      setErrorMessage('Enter a movie title before searching TMDb.');
      return;
    }

    setTmdbLoading(true);
    setErrorMessage('');

    try {
      const response = await fetch(`/api/admin/tmdb?title=${encodeURIComponent(query)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = (await response.json()) as TmdbResult[] | { error?: string };

      if (!response.ok) {
        throw new Error(
          !Array.isArray(payload) && payload.error ? payload.error : 'TMDb search failed.'
        );
      }

      const nextResults = Array.isArray(payload) ? payload : [];
      setTmdbResults(nextResults);
      setShowTmdbResults(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'TMDb search failed.');
    } finally {
      setTmdbLoading(false);
    }
  };

  const handlePickTmdb = (result: TmdbResult) => {
    setSelectedTmdb(result);
    setTitle(result.title || title);
    setDescription(result.overview || description);
    setReleaseYear(result.release_date?.slice(0, 4) || releaseYear);
    setShowTmdbResults(false);
  };

  const toggleCategory = (name: string) => {
    setSelectedCategories((current) =>
      current.includes(name)
        ? current.filter((entry) => entry !== name)
        : [...current, name]
    );
  };

  const handlePublishMovie = async () => {
    if (!title.trim()) {
      setErrorMessage('Movie title is required.');
      return;
    }

    if (mode === 'upload' && !movieFile) {
      setErrorMessage('Choose an MP4 file before uploading.');
      return;
    }

    if (mode === 'link' && !movieUrl.trim()) {
      setErrorMessage('Paste the direct MP4 link before uploading.');
      return;
    }

    setPublishing(true);
    setErrorMessage('');
    setStatusMessage('');
    setLogLines(['[INIT] Preparing upload session...']);
    setUploadStats(null);

    try {
      const uploadedPoster = posterOverrideFile
        ? await uploadPosterToAdmin(posterOverrideFile)
        : null;
      const isTrendingTikTok = selectedCategories.includes(TRENDING_CATEGORY);
      const metadata = {
        title: title.trim(),
        originalTitle: selectedTmdb?.original_title || title.trim(),
        description: description.trim(),
        poster: uploadedPoster?.publicUrl || currentPoster,
        category: selectedCategories,
        vj: vj.trim() || 'Unknown',
        releaseDate: releaseYear.trim() ? `${releaseYear.trim()}-01-01` : '',
        tmdbId: typeof selectedTmdb?.id === 'number' ? selectedTmdb.id : null,
        isTrendingTikTok,
        contentType: 'movie' as const,
      };

      let response: Response;

      if (mode === 'upload' && movieFile) {
        const uploadedAsset = await uploadMultipartFileToAdmin({
          file: movieFile,
          stage: 'final',
          onProgress: () => undefined,
          onStats: setUploadStats,
          onDiagnostic: appendLogLine,
        });

        response = await fetch('/api/admin/direct-videos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'local_upload',
            metadata,
            playbackUrl: uploadedAsset.publicUrl,
            sourceFileName: uploadedAsset.fileName,
            sourceUrl: uploadedAsset.publicUrl,
          }),
        });
      } else {
        response = await fetch('/api/admin/direct-videos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'existing_link',
            metadata,
            playbackUrl: movieUrl.trim(),
          }),
        });
      }

      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to upload movie.');
      }

      appendLogLine('[DONE] Movie upload completed successfully.');
      setStatusMessage(`Uploaded "${title.trim()}".`);
      setUploadedMovieTitle(title.trim());
      setUploadStats(null);
      setShowSuccessModal(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to upload movie.');
      appendLogLine('[STOP] Upload paused before completion.');
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0B0C10] px-4 py-8 text-white md:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl rounded-[32px] border border-white/10 bg-[#11141C] p-6 text-sm text-white/55">
          Loading movie uploader...
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
                Upload Movie
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/65">
                Direct MP4 publishing with resumable multipart uploads, clean TMDb selection, and
                a focused upload workflow.
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

        <div className="grid gap-6 xl:grid-cols-[1.05fr_1.2fr]">
          <Card
            title="Upload Movie"
            description="Choose the direct MP4 source first. The uploader now adapts chunk size, limits concurrency, retries with backoff, and keeps resumable checkpoints."
            className="border-[#D90429]/18 bg-[linear-gradient(180deg,rgba(23,9,13,0.94),rgba(17,20,28,0.94))] shadow-[0_24px_70px_rgba(0,0,0,0.42)]"
            headerClassName="rounded-[26px] border border-[#D90429]/18 bg-[linear-gradient(180deg,rgba(217,4,41,0.12),rgba(255,255,255,0.01))] px-4 py-4 md:px-5"
            titleClassName="text-lg tracking-[0.2em] text-white"
            descriptionClassName="max-w-2xl text-white/72"
          >
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMode('upload')}
                  className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                    mode === 'upload'
                      ? 'bg-[#D90429] text-white'
                      : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  Upload MP4
                </button>
                <button
                  type="button"
                  onClick={() => setMode('link')}
                  className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                    mode === 'link'
                      ? 'bg-[#D90429] text-white'
                      : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  Use Existing Cloud Link
                </button>
              </div>

              {mode === 'upload' ? (
                <div className="space-y-3">
                  <FieldLabel>Local MP4 File</FieldLabel>
                  <input
                    key={movieFileInputKey}
                    type="file"
                    accept="video/mp4"
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0] || null;
                      setMovieFile(nextFile);
                      if (nextFile) {
                        applyDetectedMovieData(nextFile.name);
                      }
                    }}
                    className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0C1017] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
                  />
                  <div className="text-xs leading-6 text-white/55">
                    Adaptive part sizing: {Math.round(MIN_DIRECT_MULTIPART_PART_SIZE_BYTES / (1024 * 1024))}-
                    {Math.round(MAX_DIRECT_MULTIPART_PART_SIZE_BYTES / (1024 * 1024))} MB,
                    depending on network quality.
                  </div>
                  <div className="text-xs leading-6 text-white/45">
                    If the page refreshes, choose the same file again and the uploader resumes from
                    completed parts.
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <FieldLabel>Existing MP4 URL</FieldLabel>
                  <TextInput
                    value={movieUrl}
                    onChange={(event) => setMovieUrl(event.target.value)}
                    onBlur={() => applyDetectedMovieData(movieUrl.split('/').pop() || movieUrl)}
                    placeholder="https://your-r2-public-url-or-existing-mp4-link.mp4"
                  />
                  <div className="text-xs leading-6 text-white/55">
                    Paste a direct MP4 link that is already reachable from storage.
                  </div>
                </div>
              )}

              {uploadStats && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/42">
                      Progress
                    </div>
                    <div className="mt-2 text-xl font-black text-white">
                      {uploadStats.progressPercent}%
                    </div>
                    <div className="mt-2 text-xs text-white/55">
                      {formatBytes(uploadStats.uploadedBytes)} /{' '}
                      {formatBytes(uploadStats.totalBytes)}
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
                      {uploadStats.networkProfile} - {uploadStats.concurrency} parallel
                    </div>
                  </div>
                </div>
              )}

              {uploadStats && (
                <div className="overflow-hidden rounded-full border border-white/10 bg-black/30">
                  <div
                    className="h-3 bg-[#D90429] transition-all duration-300"
                    style={{ width: `${uploadStats.progressPercent}%` }}
                  />
                </div>
              )}

              <button
                type="button"
                disabled={publishing}
                onClick={handlePublishMovie}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60 sm:w-auto"
              >
                <UploadCloud size={14} />
                {publishing ? 'Uploading...' : 'Upload Movie'}
              </button>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/60">
                  Upload Activity
                </div>
                <div
                  ref={logContainerRef}
                  className="mt-3 h-48 overflow-y-auto rounded-2xl border border-white/10 bg-[#0C1017] p-3 text-xs leading-6 text-white/72"
                >
                  {logLines.length ? (
                    logLines.map((line, index) => (
                      <div key={`${line}-${index}`} className="break-words">
                        {line}
                      </div>
                    ))
                  ) : (
                    <div className="text-white/35">
                      Upload activity will appear here once the movie starts uploading.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card
            title="Title Metadata"
            description="Pick the right TMDb match, confirm the poster, and keep the metadata focused."
          >
            <div className="space-y-6">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                  <TextInput
                    value={tmdbQuery}
                    onChange={(event) => setTmdbQuery(event.target.value)}
                    placeholder="Search TMDb"
                    className="pl-10"
                  />
                </div>
                <button
                  type="button"
                  disabled={tmdbLoading}
                  onClick={handleTmdbSearch}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                >
                  {tmdbLoading ? 'Searching...' : 'Search TMDb'}
                </button>
              </div>

              {selectedTmdb ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/55">
                      Selected Match
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTmdbResults(true)}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                    >
                      Change Selection
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-[24px] border border-[#D90429]/18 bg-black/20">
                    <div className="grid gap-0 grid-cols-[96px_1fr] sm:grid-cols-[112px_1fr]">
                      <div className="bg-black/20">
                        {selectedTmdb.poster_path ? (
                          <img
                            src={buildTmdbPosterUrl(selectedTmdb.poster_path)}
                            alt={selectedTmdb.title}
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
                          {selectedTmdb.title}
                        </div>
                        <div className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-white/45">
                          {selectedTmdb.release_date?.slice(0, 4) || 'No year'}
                        </div>
                        <p className="mt-3 line-clamp-4 text-xs leading-6 text-white/62 sm:text-sm">
                          {selectedTmdb.overview || 'No TMDb overview available for this title.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {showTmdbResults && tmdbResults.length > 0 && (
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-3">
                  {tmdbResults.slice(0, 6).map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => handlePickTmdb(result)}
                      className="overflow-hidden rounded-[20px] border border-white/10 bg-black/20 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[#D90429]/30 hover:bg-black/30"
                    >
                      <div className="aspect-[2/3] bg-black/20">
                        {result.poster_path ? (
                          <img
                            src={buildTmdbPosterUrl(result.poster_path)}
                            alt={result.title}
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
                          {result.title}
                        </div>
                        <div className="mt-1 text-[10px] text-white/50">
                          {result.release_date?.slice(0, 4) || 'No year'}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <FieldLabel>Detected / Edited Title</FieldLabel>
                  <TextInput
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Movie title"
                  />
                </div>
                <div>
                  <FieldLabel>Detected VJ</FieldLabel>
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
                  <FieldLabel>Description</FieldLabel>
                  <TextArea
                    rows={5}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Movie description"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <FieldLabel>Poster Override</FieldLabel>
                <input
                  key={posterFileInputKey}
                  type="file"
                  accept="image/*"
                  onChange={(event) => setPosterOverrideFile(event.target.files?.[0] || null)}
                  className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0C1017] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
                />
                {currentPoster ? (
                  <div className="max-w-[220px] overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <img
                      src={currentPoster}
                      alt={title || 'Poster preview'}
                      className="h-[320px] w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/45">
                    Search TMDb or upload a poster to preview artwork here.
                  </div>
                )}
              </div>

              <div>
                <FieldLabel>Manual Home Categories</FieldLabel>
                <CategoryChecklist
                  categories={manualCategories}
                  selected={selectedCategories}
                  onToggle={toggleCategory}
                  className="grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3"
                />
              </div>
            </div>
          </Card>
        </div>
      </div>

      {showSuccessModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/72 px-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-[28px] border border-[#D90429]/24 bg-[#11141C] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]">
            <button
              type="button"
              onClick={() => setShowSuccessModal(false)}
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/72 transition-colors hover:border-[#D90429]/30 hover:bg-white/10 hover:text-white"
              aria-label="Close upload complete modal"
            >
              <span className="text-lg leading-none">x</span>
            </button>

            <div className="mb-4 inline-flex items-center rounded-full border border-[#D90429]/25 bg-[#D90429]/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-[#FF8A9E]">
              Upload Complete
            </div>
            <h2 className="text-2xl font-black uppercase tracking-[0.14em] text-white">
              Upload Complete
            </h2>
            <p className="mt-3 text-sm leading-7 text-white/70">
              {uploadedMovieTitle
                ? `"${uploadedMovieTitle}" was uploaded successfully.`
                : 'The movie was uploaded successfully.'}
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  setShowSuccessModal(false);
                  resetUploadForm();
                }}
                className="inline-flex flex-1 items-center justify-center rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-transform duration-200 hover:scale-[1.01]"
              >
                Upload Another Movie
              </button>
              <button
                type="button"
                onClick={() => setShowSuccessModal(false)}
                className="inline-flex flex-1 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:border-[#D90429]/25 hover:bg-white/10"
              >
                Done / Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
