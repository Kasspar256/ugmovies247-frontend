'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Gauge, Search, UploadCloud } from 'lucide-react';
import type { AdminCategory } from '@/types/admin';
import { extractMovieData } from '@/lib/movieUtils';
import {
  MAX_DIRECT_MULTIPART_PART_SIZE_BYTES,
  MIN_DIRECT_MULTIPART_PART_SIZE_BYTES,
  type MultipartUploadStats,
  parseApiResponse,
  uploadMultipartFileToAdmin,
  uploadPosterToAdmin,
} from '@/lib/admin/directUploadClient';
import { fetchAdminJson } from '@/lib/admin/fetchAdminJson';
import { Card, FieldLabel, TextArea, TextInput } from '@/components/admin/controlCenterFields';
import { CategoryChecklist } from '@/components/admin/controlCenterEditors';
import {
  isIndianCatalogMovie,
  mergeUniqueRegionalValues,
} from '@/lib/regionalCatalog';
import type { VideoJobStatus } from '@/types/videoJobs';

type PublishMode = 'upload' | 'link';

type TmdbResult = {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  original_language?: string;
};

type TmdbMovieDetails = {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  original_language?: string;
  genres?: Array<{
    id: number;
    name: string;
  }>;
  production_countries?: Array<{
    iso_3166_1?: string;
    name?: string;
  }>;
  spoken_languages?: Array<{
    english_name?: string;
    iso_639_1?: string;
    name?: string;
  }>;
};

const TRENDING_CATEGORY = 'Trending on tiktok';
const MANUAL_CATEGORY_ORDER = [
  'Trending on tiktok',
  'Latest movies on UGMOVIES247',
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

const LANGUAGE_CODE_LABELS: Record<string, string> = {
  as: 'Assamese',
  bn: 'Bengali',
  gu: 'Gujarati',
  hi: 'Hindi',
  kn: 'Kannada',
  ml: 'Malayalam',
  mr: 'Marathi',
  or: 'Odia',
  pa: 'Punjabi',
  ta: 'Tamil',
  te: 'Telugu',
  ur: 'Urdu',
};

function getTmdbCountryLabel(details: TmdbMovieDetails | null) {
  const countries = details?.production_countries || [];
  const india = countries.find((country) => country.iso_3166_1 === 'IN');
  const selectedCountry = india || countries[0];

  return selectedCountry?.name?.trim() || '';
}

function getTmdbLanguageLabel(details: TmdbMovieDetails | null) {
  const spokenLanguage = details?.spoken_languages?.find(
    (language) => language.english_name || language.name
  );
  const languageCode = String(
    spokenLanguage?.iso_639_1 || details?.original_language || ''
  ).toLowerCase();

  return (
    spokenLanguage?.english_name?.trim() ||
    spokenLanguage?.name?.trim() ||
    LANGUAGE_CODE_LABELS[languageCode] ||
    languageCode
  );
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

function splitCommaList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
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
  const [genres, setGenres] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [tmdbQuery, setTmdbQuery] = useState('');
  const [tmdbResults, setTmdbResults] = useState<TmdbResult[]>([]);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [selectedTmdb, setSelectedTmdb] = useState<TmdbResult | null>(null);
  const [selectedTmdbDetails, setSelectedTmdbDetails] = useState<TmdbMovieDetails | null>(null);
  const [showTmdbResults, setShowTmdbResults] = useState(false);
  const [posterOverrideFile, setPosterOverrideFile] = useState<File | null>(null);
  const [posterOverridePreview, setPosterOverridePreview] = useState('');
  const [uploadStats, setUploadStats] = useState<MultipartUploadStats | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [uploadedMovieTitle, setUploadedMovieTitle] = useState('');
  const [queuedForProcessing, setQueuedForProcessing] = useState(false);
  const [lastSubmittedMode, setLastSubmittedMode] = useState<PublishMode | null>(null);
  const [latestJobId, setLatestJobId] = useState('');
  const [latestMovieId, setLatestMovieId] = useState('');
  const [latestJobStatus, setLatestJobStatus] = useState<VideoJobStatus | ''>('');

  useEffect(() => {
    let mounted = true;

    const loadCategories = async () => {
      try {
        const payload = await fetchAdminJson<{ categories?: AdminCategory[] }>(
          '/api/admin/categories'
        );

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
    setGenres('');
    setSelectedCategories([]);
    setTmdbQuery('');
    setTmdbResults([]);
    setSelectedTmdb(null);
    setSelectedTmdbDetails(null);
    setShowTmdbResults(false);
    setPosterOverrideFile(null);
    setPosterOverridePreview('');
    setUploadStats(null);
    setLogLines([]);
    setStatusMessage('');
    setErrorMessage('');
    setUploadedMovieTitle('');
    setQueuedForProcessing(false);
    setLastSubmittedMode(null);
    setLatestJobId('');
    setLatestMovieId('');
    setLatestJobStatus('');
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

  const applyMovieTmdbDetails = (
    details: TmdbMovieDetails,
    result?: TmdbResult | null
  ) => {
    const tmdbGenres = details.genres?.map((genre) => genre.name).filter(Boolean) || [];
    const tmdbCountry = getTmdbCountryLabel(details);
    const tmdbLanguage = getTmdbLanguageLabel(details);
    const shouldMarkIndian = isIndianCatalogMovie({
      country: tmdbCountry,
      language: tmdbLanguage,
      original_language: details.original_language,
      genres: tmdbGenres,
    });
    const nextGenres = mergeUniqueRegionalValues(
      tmdbGenres.length ? tmdbGenres : splitCommaList(genres),
      shouldMarkIndian ? ['Indian'] : []
    );

    setSelectedTmdb(result || null);
    setSelectedTmdbDetails(details);
    setTitle(details.title || result?.title || title);
    setDescription(details.overview || result?.overview || description);
    setReleaseYear(details.release_date?.slice(0, 4) || result?.release_date?.slice(0, 4) || releaseYear);
    setGenres(nextGenres.join(', ') || genres);
    setShowTmdbResults(false);
  };

  const handlePickTmdb = async (result: TmdbResult) => {
    setTmdbLoading(true);
    setErrorMessage('');
    setSelectedTmdb(result);
    setSelectedTmdbDetails(null);
    setShowTmdbResults(false);

    try {
      const response = await fetch(
        `/api/admin/tmdb?tmdbId=${encodeURIComponent(String(result.id))}`,
        {
          credentials: 'include',
          cache: 'no-store',
        }
      );
      const payload = (await response.json()) as TmdbMovieDetails | { error?: string };

      if (!response.ok || 'error' in payload) {
        throw new Error(
          'error' in payload && payload.error ? payload.error : 'Failed to load TMDb movie details.'
        );
      }

      applyMovieTmdbDetails(payload as TmdbMovieDetails, result);
    } catch (error) {
      setTitle(result.title || title);
      setDescription(result.overview || description);
      setReleaseYear(result.release_date?.slice(0, 4) || releaseYear);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to load TMDb movie details.'
      );
    } finally {
      setTmdbLoading(false);
    }
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
      setErrorMessage('Choose a video file before uploading.');
      return;
    }

    if (mode === 'link' && !movieUrl.trim()) {
      setErrorMessage('Paste the direct MP4 download link before importing.');
      return;
    }

    setPublishing(true);
    setErrorMessage('');
    setStatusMessage('');
    setLogLines([
      mode === 'link'
        ? '[INIT] Validating direct MP4 link and preparing a VPS import job...'
        : '[INIT] Preparing upload session...',
    ]);
    setUploadStats(null);

    try {
      const uploadedPoster = posterOverrideFile
        ? await uploadPosterToAdmin(posterOverrideFile)
        : null;
      const isTrendingTikTok = selectedCategories.includes(TRENDING_CATEGORY);
      const tmdbCountry = getTmdbCountryLabel(selectedTmdbDetails);
      const fallbackLanguageCode = String(selectedTmdb?.original_language || '').toLowerCase();
      const tmdbLanguage =
        getTmdbLanguageLabel(selectedTmdbDetails) ||
        LANGUAGE_CODE_LABELS[fallbackLanguageCode] ||
        fallbackLanguageCode;
      const baseGenres = splitCommaList(genres);
      const isIndianTitle = isIndianCatalogMovie({
        country: tmdbCountry,
        language: tmdbLanguage,
        original_language: selectedTmdbDetails?.original_language || selectedTmdb?.original_language,
        genres: baseGenres,
        category: selectedCategories,
      });
      const finalGenres = mergeUniqueRegionalValues(baseGenres, isIndianTitle ? ['Indian'] : []);
      const finalCategories = mergeUniqueRegionalValues(
        selectedCategories,
        isIndianTitle ? ['Indian movies'] : []
      );
      const metadata = {
        title: title.trim(),
        originalTitle: selectedTmdb?.original_title || title.trim(),
        description: description.trim(),
        poster: uploadedPoster?.publicUrl || currentPoster,
        genres: finalGenres,
        category: finalCategories,
        vj: vj.trim() || 'Unknown',
        releaseDate: releaseYear.trim() ? `${releaseYear.trim()}-01-01` : '',
        country: tmdbCountry,
        language: tmdbLanguage,
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
            mode: 'import_link',
            metadata,
            playbackUrl: movieUrl.trim(),
          }),
        });
      }

      const result = await parseApiResponse(response);

      if (!result.ok) {
        throw new Error(result.payload.error || 'Failed to upload movie.');
      }

      const queuedNormalizationCount = Number(result.payload.queuedNormalizationCount || 0);

      appendLogLine(
        mode === 'link'
          ? '[DONE] Direct MP4 import job queued. The VPS will now download, inspect, process, and upload the final file to R2.'
          : queuedNormalizationCount > 0
            ? '[DONE] Movie uploaded and queued for compatibility processing.'
            : '[DONE] Movie upload completed successfully.'
      );
      if (result.payload.warningMessage) {
        appendLogLine(`[NOTE] ${String(result.payload.warningMessage)}`);
      }
      setStatusMessage(
        mode === 'link'
          ? `Queued "${title.trim()}" for VPS import. We will only mark it ready after the final R2 upload succeeds.`
          : queuedNormalizationCount > 0
            ? `Uploaded "${title.trim()}". We are now processing it into an iPhone-safe MP4 before it goes live.`
            : `Uploaded "${title.trim()}".`
      );
      setUploadedMovieTitle(title.trim());
      setQueuedForProcessing(queuedNormalizationCount > 0);
      setLastSubmittedMode(mode);
      setLatestJobId(String(result.payload.jobId || ''));
      setLatestMovieId(String(result.payload.movieId || ''));
      setLatestJobStatus((result.payload.status as VideoJobStatus) || 'queued');
      setUploadStats(null);
      setShowSuccessModal(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to submit movie import.');
      appendLogLine('[STOP] Upload or import stopped before completion.');
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
                Direct MP4 publishing with resumable uploads, queued VPS link imports, clean TMDb
                selection, and a focused admin workflow.
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
            description="Choose a local MP4 or MKV file first, or paste a direct MP4 link. The uploader now adapts chunk size, limits concurrency, retries with backoff, and keeps resumable checkpoints."
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
                  Upload Video
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
                  Import From Link
                </button>
              </div>

              {mode === 'upload' ? (
                <div className="space-y-3">
                  <FieldLabel>Local Video File</FieldLabel>
                  <input
                    key={movieFileInputKey}
                    type="file"
                    accept=".mp4,.mkv,video/mp4,video/x-matroska,video/mkv"
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
                  <FieldLabel>Direct MP4 URL</FieldLabel>
                  <TextInput
                    value={movieUrl}
                    onChange={(event) => setMovieUrl(event.target.value)}
                    onBlur={() => applyDetectedMovieData(movieUrl.split('/').pop() || movieUrl)}
                    placeholder="https://example.com/movie.mp4"
                  />
                  <div className="text-xs leading-6 text-white/55">
                    Paste a direct MP4 download link. The admin browser will not upload the large
                    file in this flow; the VPS will import it, inspect it, lightly normalize it,
                    upload the final file to R2, and only then mark the movie ready.
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                      Processing Stages
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {['queued', 'downloading', 'inspecting', 'processing', 'uploading', 'ready', 'failed'].map(
                        (stage) => (
                          <span
                            key={stage}
                            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/70"
                          >
                            {stage}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </div>
              )}

              {latestJobId && latestJobStatus ? (
                <div className="rounded-2xl border border-[#D90429]/18 bg-black/20 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                      Latest Import Job
                    </div>
                    <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-sky-100">
                      {latestJobStatus}
                    </span>
                  </div>
                  <div className="mt-2 text-xs leading-6 text-white/60">
                    Job {latestJobId}
                    {latestMovieId ? ` | Movie ${latestMovieId}` : ''}
                  </div>
                  <div className="mt-2 text-xs leading-6 text-white/50">
                    Open the processing queue to follow live stage changes after submission.
                  </div>
                </div>
              ) : null}

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
                {publishing
                  ? mode === 'link'
                    ? 'Queueing Import...'
                    : 'Uploading...'
                  : mode === 'link'
                    ? 'Import Movie'
                    : 'Upload Movie'}
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
                      Upload or import activity will appear here once the workflow starts.
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
                  <FieldLabel>Genres</FieldLabel>
                  <TextInput
                    value={genres}
                    onChange={(event) => setGenres(event.target.value)}
                    placeholder="Animation, Family, Adventure"
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
              {lastSubmittedMode === 'link' ? 'Import Queued' : 'Upload Complete'}
            </div>
            <h2 className="text-2xl font-black uppercase tracking-[0.14em] text-white">
              {lastSubmittedMode === 'link' ? 'Import Queued' : 'Upload Complete'}
            </h2>
            <p className="mt-3 text-sm leading-7 text-white/70">
              {lastSubmittedMode === 'link'
                ? uploadedMovieTitle
                  ? `"${uploadedMovieTitle}" is queued. The VPS will download it from the link, inspect it, process it for browser/mobile playback, upload the final file to R2, and only then mark it ready.`
                  : 'The movie import is queued. The VPS will download it, inspect it, process it, and upload the final file to R2 before it goes live.'
                : queuedForProcessing
                ? uploadedMovieTitle
                  ? `"${uploadedMovieTitle}" is uploaded and is now being processed into an iPhone-safe MP4.`
                  : 'The movie is uploaded and is now being processed into an iPhone-safe MP4.'
                : uploadedMovieTitle
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
                {lastSubmittedMode === 'link' ? 'Import Another Movie' : 'Upload Another Movie'}
              </button>
              <button
                type="button"
                onClick={() => setShowSuccessModal(false)}
                className="inline-flex flex-1 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-colors hover:border-[#D90429]/25 hover:bg-white/10"
              >
                Done / Close
              </button>
              <Link
                href="/admin/processing"
                className="inline-flex flex-1 items-center justify-center rounded-full border border-[#D90429]/25 bg-[#D90429]/10 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-[#FFD7DF] transition-colors hover:bg-[#D90429]/15"
              >
                Open Processing Queue
              </Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
