'use client';

import { useEffect, useMemo, useState } from 'react';
import { extractMovieData } from '@/lib/movieUtils';
import type { Season, Movie } from '@/types/movie';
import { MANUAL_HOME_CATEGORIES, type ManualHomeCategory } from '@/lib/homeCategories';
import type { SourcePipeline, VideoJobDocument } from '@/types/videoJobs';
import { fetchPublicMovies } from '@/lib/publicMovies';

type AdminTab = 'hls' | 'direct' | 'queue' | 'library';
type HlsMode = 'upload' | 'link';
type DirectMode = 'upload' | 'links';

type TmdbResult = {
  id: number | null;
  title: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  original_language?: string;
  genre_ids?: number[];
};

type AdminEpisodeInput = {
  episodeNumber: number;
  title: string;
  description: string;
  video_url: string;
  poster: string;
  thumbnail: string;
};

type AdminSeasonInput = {
  seasonNumber: number;
  title: string;
  episodes: AdminEpisodeInput[];
};

async function parseApiResponse(response: Response) {
  const rawText = await response.text();

  try {
    const payload = rawText ? JSON.parse(rawText) : {};
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      payload: {
        error: 'Server returned a non-JSON response.',
        detail: rawText.slice(0, 300),
      },
    };
  }
}

function uploadFileToSignedUrl(
  file: File,
  uploadUrl: string,
  contentType?: string,
  onProgress?: (progress: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType || file.type || 'application/octet-stream');

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress?.(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }

      reject(new Error(`Source upload failed with status ${xhr.status}.`));
    };

    xhr.onerror = () => {
      reject(
        new Error(
          xhr.status > 0
            ? `Source upload failed with status ${xhr.status}.`
            : 'Source upload failed before the next step. This usually means the browser could not complete the direct storage upload.'
        )
      );
    };
    xhr.onabort = () => reject(new Error('Source upload was aborted before completion.'));
    xhr.send(file);
  });
}

function getGenresFromIds(ids: number[] = []) {
  const TMDB_GENRES: Record<number, string> = {
    28: 'Action',
    12: 'Adventure',
    16: 'Animation',
    35: 'Comedy',
    80: 'Crime',
    99: 'Documentary',
    18: 'Drama',
    10751: 'Family',
    14: 'Fantasy',
    36: 'Family',
    38: 'History',
    27: 'Horror',
    10402: 'Music',
    9648: 'Mystery',
    10749: 'Romance',
    878: 'Sci-Fi',
    10770: 'TV Movie',
    53: 'Thriller',
    10752: 'War',
    37: 'Western',
  };

  return ids.map((id) => TMDB_GENRES[id]).filter(Boolean);
}

function getCountryFromTmdbLanguage(language?: string) {
  if (language === 'ko') {
    return 'South Korea';
  }

  if (language === 'hi' || language === 'te' || language === 'ta') {
    return 'India';
  }

  return 'Unknown';
}

function getSeasonStarter(): AdminSeasonInput[] {
  return [
    {
      seasonNumber: 1,
      title: 'Season 1',
      episodes: [
        {
          episodeNumber: 1,
          title: 'Episode 1',
          description: '',
          video_url: '',
          poster: '',
          thumbnail: '',
        },
      ],
    },
  ];
}

function getLibraryStatus(movie: Movie) {
  if (movie.jobStatus === 'failed') {
    return 'failed';
  }

  if (movie.jobStatus && movie.jobStatus !== 'ready') {
    return 'processing';
  }

  return movie.playbackType === 'hls' || movie.playbackType === 'mp4' ? 'ready' : 'draft';
}

function getPipelineLabel(sourcePipeline?: SourcePipeline) {
  switch (sourcePipeline) {
    case 'hls_pipeline':
      return 'HLS Pipeline';
    case 'direct_upload':
      return 'Direct Upload';
    case 'remote_mkv_to_mp4':
      return 'Remote MKV -> MP4';
    case 'remote_mp4_ingest':
      return 'Remote MP4 Ingest';
    default:
      return 'Legacy';
  }
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<AdminTab>('hls');
  const [contentType, setContentType] = useState<'movie' | 'series'>('movie');
  const [hlsMode, setHlsMode] = useState<HlsMode>('upload');
  const [directMode, setDirectMode] = useState<DirectMode>('upload');

  const [cleanTitle, setCleanTitle] = useState('');
  const [detectedVj, setDetectedVj] = useState('');
  const [tmdbResults, setTmdbResults] = useState<TmdbResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<TmdbResult | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<ManualHomeCategory[]>([]);
  const [isTrending, setIsTrending] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const [hlsFile, setHlsFile] = useState<File | null>(null);
  const [hlsRemoteLink, setHlsRemoteLink] = useState('');
  const [hlsBulkFiles, setHlsBulkFiles] = useState<File[]>([]);
  const [hlsBulkRemoteLinks, setHlsBulkRemoteLinks] = useState('');
  const [hlsProgress, setHlsProgress] = useState(0);
  const [hlsStatus, setHlsStatus] = useState('Idle');
  const [hlsDiagnostics, setHlsDiagnostics] = useState('');

  const [directFile, setDirectFile] = useState<File | null>(null);
  const [directRemoteLinks, setDirectRemoteLinks] = useState('');
  const [directProgress, setDirectProgress] = useState(0);
  const [directStatus, setDirectStatus] = useState('Idle');
  const [directDiagnostics, setDirectDiagnostics] = useState('');

  const [seriesSeasons, setSeriesSeasons] = useState<AdminSeasonInput[]>(getSeasonStarter());
  const [videoJobs, setVideoJobs] = useState<VideoJobDocument[]>([]);
  const [libraryMovies, setLibraryMovies] = useState<Movie[]>([]);
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'hls' | 'mp4' | 'failed' | 'ready' | 'processing'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetSharedMetadata = () => {
    setCleanTitle('');
    setDetectedVj('');
    setTmdbResults([]);
    setSelectedMovie(null);
    setSelectedCategories([]);
    setIsTrending(false);
    setSeriesSeasons(getSeasonStarter());
    setContentType('movie');
  };

  const resetHlsForm = () => {
    setHlsFile(null);
    setHlsRemoteLink('');
    setHlsBulkFiles([]);
    setHlsBulkRemoteLinks('');
    setHlsProgress(0);
    setHlsStatus('Awaiting next HLS payload...');
    setHlsDiagnostics('');
    resetSharedMetadata();
  };

  const resetDirectForm = () => {
    setDirectFile(null);
    setDirectRemoteLinks('');
    setDirectProgress(0);
    setDirectStatus('Awaiting next direct payload...');
    setDirectDiagnostics('');
    resetSharedMetadata();
  };

  const buildSeriesPayload = (): Season[] =>
    seriesSeasons
      .map((season, seasonIndex) => ({
        seasonNumber: Number(season.seasonNumber) || seasonIndex + 1,
        title: season.title || `Season ${seasonIndex + 1}`,
        episodes: season.episodes
          .filter((episode) => episode.video_url.trim() !== '')
          .map((episode, episodeIndex) => ({
            episodeNumber: Number(episode.episodeNumber) || episodeIndex + 1,
            title: episode.title || `Episode ${episodeIndex + 1}`,
            description: episode.description || '',
            video_url: episode.video_url || '',
            poster: episode.poster || '',
            thumbnail: episode.thumbnail || '',
          })),
      }))
      .filter((season) => season.episodes.length > 0);

  const buildMetadata = () => ({
    title: selectedMovie?.title || cleanTitle || 'Untitled movie',
    originalTitle: selectedMovie?.original_title || cleanTitle || 'Untitled movie',
    description: selectedMovie?.overview || '',
    poster: selectedMovie?.poster_path ? `https://image.tmdb.org/t/p/w500${selectedMovie.poster_path}` : '',
    genres: selectedMovie?.genre_ids ? getGenresFromIds(selectedMovie.genre_ids) : [],
    category: selectedCategories,
    vj: detectedVj || 'Unknown',
    releaseDate: selectedMovie?.release_date || '',
    country: getCountryFromTmdbLanguage(selectedMovie?.original_language),
    tmdbId: selectedMovie?.id || null,
    status: 'published',
    isTrendingTikTok: isTrending,
    contentType,
  });

  const loadAdminData = async () => {
    try {
      const [jobsResponse, movies] = await Promise.all([
        fetch('/api/admin/video-jobs', { cache: 'no-store' }),
        fetchPublicMovies(),
      ]);
      const jobsPayload = await parseApiResponse(jobsResponse);

      if (jobsResponse.ok) {
        setVideoJobs(jobsPayload.payload.jobs || []);
      }

      setLibraryMovies(movies);
    } catch (error) {
      console.error('[admin] data refresh failed', error);
    }
  };

  useEffect(() => {
    loadAdminData();
    const interval = setInterval(loadAdminData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleManualSearch = async (queryTitle: string) => {
    if (!queryTitle) {
      return;
    }

    setIsSearching(true);
    const statusSetter = activeTab === 'direct' ? setDirectStatus : setHlsStatus;
    statusSetter('Searching TMDb...');

    try {
      const response = await fetch(`/api/admin/tmdb?title=${encodeURIComponent(queryTitle)}`);
      const { payload, ok } = await parseApiResponse(response);

      if (!ok) {
        throw new Error(payload.error || 'TMDb search failed.');
      }

      setTmdbResults(Array.isArray(payload) ? payload : []);
      statusSetter(
        Array.isArray(payload) && payload.length
          ? 'TMDb search complete. Select the matching title.'
          : 'No TMDb matches found. You can continue with manual metadata.'
      );
    } catch (error) {
      setTmdbResults([]);
      statusSetter(error instanceof Error ? error.message : 'Failed to search TMDb.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleManualOverride = () => {
    setSelectedMovie({
      id: null,
      title: cleanTitle || 'Untitled movie',
      original_title: cleanTitle || 'Untitled movie',
      overview: 'No description available in TMDb.',
      poster_path: null,
      release_date: new Date().toISOString().slice(0, 10),
    });
  };

  const toggleCategory = (category: ManualHomeCategory) => {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((entry) => entry !== category)
        : [...current, category]
    );
  };

  const handleTitleSourceFromFile = (file: File, tab: 'hls' | 'direct') => {
    const { title, vj } = extractMovieData(file.name);
    setCleanTitle(title);
    setDetectedVj(vj || 'Unknown');
    setSelectedMovie(null);
    setTmdbResults([]);

    if (tab === 'hls') {
      setHlsDiagnostics('');
      setHlsProgress(0);
    } else {
      setDirectDiagnostics('');
      setDirectProgress(0);
    }

    handleManualSearch(title);
  };

  const triggerQueueProcessor = async () => {
    try {
      await fetch('/api/admin/video-jobs/process-next', { method: 'POST' });
    } catch (error) {
      console.error('[admin] queue trigger failed', error);
    }
  };

  const handleHlsLocalUpload = async () => {
    if (contentType === 'series') {
      setHlsStatus('Use remote episode links for HLS series ingestion.');
      return;
    }

    if (!hlsFile || !selectedMovie) {
      setHlsStatus('Choose a source file and TMDb match first.');
      return;
    }

    setIsSubmitting(true);
    setHlsStatus('Preparing secure HLS source upload...');
    setHlsDiagnostics('[INIT] HLS local upload started...');

    try {
      const uploadUrlResponse = await fetch('/api/admin/video-jobs/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: hlsFile.name,
          contentType: hlsFile.type || 'video/mp4',
        }),
      });
      const uploadUrlPayload = await parseApiResponse(uploadUrlResponse);

      if (!uploadUrlResponse.ok) {
        throw new Error(uploadUrlPayload.payload.detail || uploadUrlPayload.payload.error || 'Failed to prepare HLS upload.');
      }

      setHlsStatus('Uploading source to HLS staging...');
      await uploadFileToSignedUrl(
        hlsFile,
        uploadUrlPayload.payload.uploadUrl,
        uploadUrlPayload.payload.contentType,
        setHlsProgress
      );
      setHlsDiagnostics((prev) => `${prev}\n[UPLOAD] Source staged for HLS processing.`);

      const queueResponse = await fetch('/api/admin/video-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'remote_links',
          metadata: buildMetadata(),
          remoteLinks: [uploadUrlPayload.payload.publicUrl],
        }),
      });
      const queuePayload = await parseApiResponse(queueResponse);

      if (!queueResponse.ok) {
        throw new Error(queuePayload.payload.detail || queuePayload.payload.error || 'Failed to queue HLS job.');
      }

      setHlsStatus(`Queued ${queuePayload.payload.queued || 1} HLS job(s).`);
      setHlsDiagnostics((prev) => `${prev}\n[QUEUE] HLS job created successfully.`);
      await loadAdminData();
      await triggerQueueProcessor();
      setTimeout(resetHlsForm, 1200);
    } catch (error) {
      setHlsStatus('HLS upload failed. See diagnostics.');
      setHlsDiagnostics((prev) => `${prev}\n[ERROR] ${error instanceof Error ? error.message : 'Unknown HLS upload error.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleHlsRemoteQueue = async () => {
    if (!selectedMovie) {
      setHlsStatus('Select TMDb metadata before queueing HLS content.');
      return;
    }

    setIsSubmitting(true);

    try {
      const seasons = buildSeriesPayload();

      if (contentType === 'series') {
        if (!seasons.length) {
          throw new Error('Add at least one episode link for the HLS series.');
        }

        const response = await fetch('/api/admin/video-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'series_remote',
            metadata: buildMetadata(),
            seasons,
          }),
        });
        const payload = await parseApiResponse(response);

        if (!response.ok) {
          throw new Error(payload.payload.detail || payload.payload.error || 'Failed to queue HLS series.');
        }

        setHlsStatus(`Queued ${payload.payload.queued || 0} HLS episode job(s).`);
      } else {
        if (!hlsRemoteLink.trim()) {
          throw new Error('Paste a remote source link for HLS processing.');
        }

        const response = await fetch('/api/admin/video-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'remote_links',
            metadata: buildMetadata(),
            remoteLinks: [hlsRemoteLink.trim()],
          }),
        });
        const payload = await parseApiResponse(response);

        if (!response.ok) {
          throw new Error(payload.payload.detail || payload.payload.error || 'Failed to queue HLS remote link.');
        }

        setHlsStatus(`Queued ${payload.payload.queued || 1} HLS job(s).`);
      }

      await loadAdminData();
      await triggerQueueProcessor();
      setTimeout(resetHlsForm, 1200);
    } catch (error) {
      setHlsStatus(error instanceof Error ? error.message : 'Failed to queue HLS remote content.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleHlsBulkLocalQueue = async () => {
    if (!hlsBulkFiles.length) {
      setHlsStatus('Select one or more local source files first.');
      return;
    }

    setIsSubmitting(true);
    setHlsStatus('Queueing bulk HLS uploads...');

    try {
      let queued = 0;

      for (const file of hlsBulkFiles) {
        const uploadUrlResponse = await fetch('/api/admin/video-jobs/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || 'video/mp4',
          }),
        });
        const uploadUrlPayload = await parseApiResponse(uploadUrlResponse);

        if (!uploadUrlResponse.ok) {
          throw new Error(uploadUrlPayload.payload.detail || uploadUrlPayload.payload.error || `Failed to prepare ${file.name}.`);
        }

        await uploadFileToSignedUrl(
          file,
          uploadUrlPayload.payload.uploadUrl,
          uploadUrlPayload.payload.contentType
        );

        const { title, vj } = extractMovieData(file.name);
        const response = await fetch('/api/admin/video-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'remote_links',
            metadata: {
              ...buildMetadata(),
              title,
              originalTitle: title,
              vj: vj || 'Unknown',
              contentType: 'movie',
            },
            remoteLinks: [uploadUrlPayload.payload.publicUrl],
          }),
        });
        const payload = await parseApiResponse(response);

        if (!response.ok) {
          throw new Error(payload.payload.detail || payload.payload.error || `Failed to queue ${file.name}.`);
        }

        queued += payload.payload.queued || 1;
      }

      setHlsStatus(`Queued ${queued} HLS bulk job(s).`);
      await loadAdminData();
      await triggerQueueProcessor();
      setHlsBulkFiles([]);
    } catch (error) {
      setHlsStatus(error instanceof Error ? error.message : 'Failed to queue bulk HLS uploads.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleHlsBulkRemoteQueue = async () => {
    const links = hlsBulkRemoteLinks
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (!links.length) {
      setHlsStatus('Paste one or more remote links first.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/admin/video-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'remote_links',
          metadata: {
            ...buildMetadata(),
            contentType: 'movie',
          },
          remoteLinks: links,
        }),
      });
      const payload = await parseApiResponse(response);

      if (!response.ok) {
        throw new Error(payload.payload.detail || payload.payload.error || 'Failed to queue remote HLS links.');
      }

      setHlsStatus(`Queued ${payload.payload.queued || links.length} HLS remote job(s).`);
      setHlsBulkRemoteLinks('');
      await loadAdminData();
      await triggerQueueProcessor();
    } catch (error) {
      setHlsStatus(error instanceof Error ? error.message : 'Failed to queue remote HLS links.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDirectLocalUpload = async () => {
    if (contentType === 'series') {
      setDirectStatus('Use remote episode links for direct series/episode publishing.');
      return;
    }

    if (!directFile || !selectedMovie) {
      setDirectStatus('Choose a direct upload file and TMDb match first.');
      return;
    }

    setIsSubmitting(true);
    setDirectDiagnostics('[INIT] Direct upload started...');
    const lowerName = directFile.name.toLowerCase();
    const isMkv = lowerName.endsWith('.mkv');

      try {
        setDirectStatus(isMkv ? 'Preparing MKV staging upload...' : 'Preparing direct MP4 upload...');
        setDirectProgress(15);

        const uploadUrlResponse = await fetch('/api/admin/direct-videos/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: directFile.name,
            contentType: directFile.type || (isMkv ? 'video/x-matroska' : 'video/mp4'),
            stage: isMkv ? 'staging' : 'final',
          }),
        });
        const uploadUrlPayload = await parseApiResponse(uploadUrlResponse);

        if (!uploadUrlResponse.ok) {
          throw new Error(
            uploadUrlPayload.payload.detail ||
              uploadUrlPayload.payload.error ||
              'Failed to prepare direct upload.'
          );
        }

        setDirectStatus(isMkv ? 'Uploading MKV source for conversion...' : 'Uploading MP4 source for direct publishing...');
        setDirectProgress(30);
        await uploadFileToSignedUrl(
          directFile,
          uploadUrlPayload.payload.uploadUrl,
          uploadUrlPayload.payload.contentType,
          (progress) => setDirectProgress(Math.max(30, progress))
        );
        setDirectProgress(100);
        setDirectDiagnostics((prev) => `${prev}\n[UPLOAD] Local source uploaded successfully.`);

        if (isMkv) {
          setDirectStatus('Queueing MKV conversion job...');
          const response = await fetch('/api/admin/direct-videos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
            mode: 'staged_local_conversion',
            metadata: buildMetadata(),
            stagedUrl: uploadUrlPayload.payload.publicUrl,
            sourceFileName: directFile.name,
          }),
        });
        const payload = await parseApiResponse(response);

        if (!response.ok) {
          throw new Error(payload.payload.detail || payload.payload.error || 'Failed to queue MKV conversion.');
        }

        setDirectStatus('Queued local MKV conversion into direct MP4 pipeline.');
          setDirectDiagnostics((prev) => `${prev}\n[QUEUE] Local MKV queued for MP4 conversion.`);
          await loadAdminData();
          await triggerQueueProcessor();
        } else {
          setDirectStatus('Publishing direct MP4 metadata...');
          const response = await fetch('/api/admin/direct-videos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
            mode: 'local_upload',
            metadata: buildMetadata(),
            playbackUrl: uploadUrlPayload.payload.publicUrl,
            sourceFileName: directFile.name,
            sourceUrl: uploadUrlPayload.payload.publicUrl,
          }),
        });
        const payload = await parseApiResponse(response);

        if (!response.ok) {
          throw new Error(payload.payload.detail || payload.payload.error || 'Failed to save direct MP4 metadata.');
        }

        setDirectStatus('Direct MP4 upload published successfully.');
        setDirectDiagnostics((prev) => `${prev}\n[PUBLISH] Direct MP4 saved and ready for playback.`);
        await loadAdminData();
      }

      setTimeout(resetDirectForm, 1200);
    } catch (error) {
      setDirectStatus(error instanceof Error ? error.message : 'Direct upload failed.');
      setDirectDiagnostics((prev) => `${prev}\n[ERROR] ${error instanceof Error ? error.message : 'Unknown direct upload error.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDirectRemoteQueue = async () => {
    if (!selectedMovie) {
      setDirectStatus('Select TMDb metadata before importing direct content.');
      return;
    }

    setIsSubmitting(true);

    try {
      const seasons = buildSeriesPayload();

      if (contentType === 'series') {
        if (!seasons.length) {
          throw new Error('Add at least one episode link for the direct series import.');
        }

        const response = await fetch('/api/admin/direct-videos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'series_remote',
            metadata: buildMetadata(),
            seasons,
          }),
        });
        const payload = await parseApiResponse(response);

        if (!response.ok) {
          throw new Error(payload.payload.detail || payload.payload.error || 'Failed to queue direct series jobs.');
        }

        setDirectStatus(`Queued ${payload.payload.queued || 0} direct series job(s).`);
      } else {
        const links = directRemoteLinks
          .split('\n')
          .map((entry) => entry.trim())
          .filter(Boolean);

        if (!links.length) {
          throw new Error('Paste at least one direct MP4 or MKV link.');
        }

        const response = await fetch('/api/admin/direct-videos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'remote_links',
            metadata: buildMetadata(),
            remoteLinks: links,
          }),
        });
        const payload = await parseApiResponse(response);

        if (!response.ok) {
          throw new Error(payload.payload.detail || payload.payload.error || 'Failed to queue direct remote links.');
        }

        setDirectStatus(`Queued ${payload.payload.queued || links.length} direct ingest/conversion job(s).`);
      }

      await loadAdminData();
      await triggerQueueProcessor();
      setTimeout(resetDirectForm, 1200);
    } catch (error) {
      setDirectStatus(error instanceof Error ? error.message : 'Failed to queue direct content.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    await fetch(`/api/admin/video-jobs/${jobId}/retry`, { method: 'POST' });
    await loadAdminData();
    await triggerQueueProcessor();
  };

  const handleCancelJob = async (jobId: string) => {
    await fetch(`/api/admin/video-jobs/${jobId}/cancel`, { method: 'POST' });
    await loadAdminData();
  };

  const getJobTypeLabel = (job: VideoJobDocument) => {
    switch (job.jobType || 'hls_transcode') {
      case 'hls_transcode':
        return 'HLS Transcode';
      case 'direct_mp4_upload':
        return 'Direct MP4';
      case 'remote_mkv_to_mp4':
        return 'MKV to MP4';
      default:
        return job.jobType || 'Unknown';
    }
  };

  const getJobStatusLabel = (job: VideoJobDocument) => {
    if ((job.jobType || 'hls_transcode') === 'hls_transcode') {
      return job.status;
    }

    switch (job.status) {
      case 'uploading_source':
        return 'uploading_mp4';
      case 'packaging':
        return 'preparing_mp4';
      default:
        return job.status;
    }
  };

  const addSeason = () => {
    setSeriesSeasons((current) => [
      ...current,
      {
        seasonNumber: current.length + 1,
        title: `Season ${current.length + 1}`,
        episodes: [
          {
            episodeNumber: 1,
            title: 'Episode 1',
            description: '',
            video_url: '',
            poster: '',
            thumbnail: '',
          },
        ],
      },
    ]);
  };

  const removeSeason = (seasonIndex: number) => {
    setSeriesSeasons((current) =>
      current
        .filter((_, index) => index !== seasonIndex)
        .map((season, index) => ({
          ...season,
          seasonNumber: index + 1,
          title: season.title || `Season ${index + 1}`,
        }))
    );
  };

  const addEpisode = (seasonIndex: number) => {
    setSeriesSeasons((current) =>
      current.map((season, index) =>
        index === seasonIndex
          ? {
              ...season,
              episodes: [
                ...season.episodes,
                {
                  episodeNumber: season.episodes.length + 1,
                  title: `Episode ${season.episodes.length + 1}`,
                  description: '',
                  video_url: '',
                  poster: '',
                  thumbnail: '',
                },
              ],
            }
          : season
      )
    );
  };

  const removeEpisode = (seasonIndex: number, episodeIndex: number) => {
    setSeriesSeasons((current) =>
      current.map((season, index) =>
        index === seasonIndex
          ? {
              ...season,
              episodes: season.episodes
                .filter((_, currentEpisodeIndex) => currentEpisodeIndex !== episodeIndex)
                .map((episode, currentEpisodeIndex) => ({
                  ...episode,
                  episodeNumber: currentEpisodeIndex + 1,
                })),
            }
          : season
      )
    );
  };

  const updateSeasonField = (
    seasonIndex: number,
    field: keyof Omit<AdminSeasonInput, 'episodes'>,
    value: string | number
  ) => {
    setSeriesSeasons((current) =>
      current.map((season, index) => (index === seasonIndex ? { ...season, [field]: value } : season))
    );
  };

  const updateEpisodeField = (
    seasonIndex: number,
    episodeIndex: number,
    field: keyof AdminEpisodeInput,
    value: string | number
  ) => {
    setSeriesSeasons((current) =>
      current.map((season, currentSeasonIndex) =>
        currentSeasonIndex === seasonIndex
          ? {
              ...season,
              episodes: season.episodes.map((episode, currentEpisodeIndex) =>
                currentEpisodeIndex === episodeIndex ? { ...episode, [field]: value } : episode
              ),
            }
          : season
      )
    );
  };

  const jobsByTab = useMemo(() => {
    const hlsJobs = videoJobs.filter((job) => (job.jobType || 'hls_transcode') === 'hls_transcode');
    const directJobs = videoJobs.filter((job) => (job.jobType || 'hls_transcode') !== 'hls_transcode');
    return { hlsJobs, directJobs };
  }, [videoJobs]);

  const libraryItems = useMemo(() => {
    const items: Array<{
      key: string;
      title: string;
      kind: 'movie' | 'series' | 'episode';
      playbackType: 'hls' | 'mp4';
      sourcePipeline?: SourcePipeline;
      status: 'failed' | 'processing' | 'ready' | 'draft';
      updatedAt: string;
      subtitle: string;
    }> = [];

    for (const movie of libraryMovies) {
      items.push({
        key: movie.id,
        title: movie.title,
        kind: movie.contentType === 'series' ? 'series' : 'movie',
        playbackType: movie.playbackType || 'mp4',
        sourcePipeline: movie.sourcePipeline,
        status: getLibraryStatus(movie),
        updatedAt: movie.updatedAt || movie.date_added || '',
        subtitle: movie.vj || 'Unknown VJ',
      });

      if (movie.contentType === 'series' && Array.isArray(movie.seasons)) {
        for (const season of movie.seasons) {
          for (const episode of season.episodes || []) {
            const episodeStatus =
              episode.jobStatus === 'failed'
                ? 'failed'
                : episode.jobStatus && episode.jobStatus !== 'ready'
                  ? 'processing'
                  : episode.playbackType === 'hls' || episode.playbackType === 'mp4'
                    ? 'ready'
                    : 'draft';

            items.push({
              key: `${movie.id}-s${season.seasonNumber}-e${episode.episodeNumber}`,
              title: `${movie.title} - ${episode.title}`,
              kind: 'episode',
              playbackType: episode.playbackType || 'mp4',
              sourcePipeline: episode.sourcePipeline || movie.sourcePipeline,
              status: episodeStatus,
              updatedAt: episode.updatedAt || movie.updatedAt || '',
              subtitle: `Season ${season.seasonNumber} • Episode ${episode.episodeNumber}`,
            });
          }
        }
      }
    }

    return items;
  }, [libraryMovies]);

  const filteredLibraryMovies = useMemo(() => {
    return libraryItems.filter((item) => {
      const status = item.status;

      if (libraryFilter === 'all') {
        return true;
      }

      if (libraryFilter === 'hls' || libraryFilter === 'mp4') {
        return item.playbackType === libraryFilter;
      }

      return status === libraryFilter;
    });
  }, [libraryItems, libraryFilter]);

  const renderMetadataCard = () => (
    <section className="bg-black p-6 rounded-md border border-neutral-800 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-red-500 font-bold text-lg">Title Metadata</h2>
          <p className="text-sm text-gray-500">
            Use TMDb search plus manual overrides to prepare clean metadata before publishing or queueing.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setContentType('movie')}
            className={`px-4 py-2 rounded text-sm font-bold ${contentType === 'movie' ? 'bg-red-700 text-white' : 'bg-neutral-900 text-gray-400'}`}
          >
            Movies
          </button>
          <button
            onClick={() => setContentType('series')}
            className={`px-4 py-2 rounded text-sm font-bold ${contentType === 'series' ? 'bg-red-700 text-white' : 'bg-neutral-900 text-gray-400'}`}
          >
            Series / Episodes
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_auto_220px]">
        <div>
          <label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Detected / Edited Title</label>
          <input
            value={cleanTitle}
            onChange={(event) => setCleanTitle(event.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 text-white p-3 rounded text-sm"
            placeholder="Movie title"
          />
        </div>
        <button
          onClick={() => handleManualSearch(cleanTitle)}
          disabled={!cleanTitle || isSearching}
          className="bg-neutral-800 hover:bg-neutral-700 disabled:bg-neutral-800/50 px-5 py-3 rounded text-sm font-bold border border-neutral-700 self-end"
        >
          {isSearching ? 'SEARCHING...' : 'SEARCH TMDb'}
        </button>
        <div>
          <label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Detected VJ</label>
          <input
            value={detectedVj}
            onChange={(event) => setDetectedVj(event.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 text-white p-3 rounded text-sm"
            placeholder="Translator / VJ"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 border border-neutral-800 rounded-md bg-neutral-950 p-4">
        <label className="flex items-center gap-2 text-sm font-bold text-red-400 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 accent-red-600"
            checked={isTrending}
            onChange={(event) => setIsTrending(event.target.checked)}
          />
          Tag as Trending on TikTok
        </label>

        <div>
          <h3 className="text-sm font-bold text-red-400 mb-3">Manual Home Categories</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {MANUAL_HOME_CATEGORIES.filter((category) => category !== 'Trending on tiktok').map((category) => (
              <label key={category} className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-red-600"
                  checked={selectedCategories.includes(category)}
                  onChange={() => toggleCategory(category)}
                />
                {category}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Manual rows stay admin-controlled. Automatic VJ and genre rows still fill from backend metadata.
          </p>
        </div>
      </div>

      {tmdbResults.length > 0 && !selectedMovie && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold text-gray-200">TMDb Matches</h3>
            <button onClick={handleManualOverride} className="text-xs bg-neutral-800 hover:bg-neutral-700 text-white px-3 py-2 rounded border border-neutral-700">
              Use Manual Metadata
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {tmdbResults.slice(0, 10).map((movie) => (
              <button
                key={`${movie.id}-${movie.title}`}
                onClick={() => setSelectedMovie(movie)}
                className="text-left border border-neutral-800 bg-neutral-950 hover:border-red-500 rounded p-2 transition-colors"
              >
                <img
                  src={movie.poster_path ? `https://image.tmdb.org/t/p/w200${movie.poster_path}` : 'https://via.placeholder.com/200x300/111/444?text=No+Poster'}
                  alt={movie.title}
                  className="w-full aspect-[2/3] object-cover rounded mb-2"
                />
                <p className="text-xs font-bold text-white line-clamp-2">{movie.title}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedMovie && (
        <div className="border border-red-800 bg-red-900/10 rounded-lg p-4">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="text-red-500 font-black tracking-[0.25em] uppercase text-xs">Payload Armed</div>
              <h3 className="text-2xl font-bold text-white mt-2">{selectedMovie.title}</h3>
            </div>
            <button onClick={() => setSelectedMovie(null)} className="text-xs text-neutral-400 hover:text-white underline">
              Change Selection
            </button>
          </div>
          <div className="flex flex-col md:flex-row gap-5">
            <img
              src={selectedMovie.poster_path ? `https://image.tmdb.org/t/p/w500${selectedMovie.poster_path}` : 'https://via.placeholder.com/300x450/111/444?text=No+Poster'}
              alt={selectedMovie.title}
              className="w-32 md:w-44 rounded shadow-lg"
            />
            <div className="flex-1">
              <p className="text-sm text-gray-300 leading-6 bg-black/30 rounded p-4">
                {selectedMovie.overview || 'No synopsis available for this title.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );

  const renderSeriesEditor = () => {
    if (contentType !== 'series') {
      return null;
    }

    return (
      <section className="bg-black p-6 rounded-md border border-neutral-800">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-red-500 font-bold text-lg">Series / Episodes</h2>
            <p className="text-sm text-gray-500">Add seasons and direct episode source links for the selected workflow.</p>
          </div>
          <button onClick={addSeason} className="bg-red-700 hover:bg-red-600 px-4 py-2 rounded text-xs font-bold">
            Add Season
          </button>
        </div>

        <div className="space-y-5">
          {seriesSeasons.map((season, seasonIndex) => (
            <div key={`season-${seasonIndex}`} className="border border-neutral-800 rounded-md bg-neutral-950 p-4">
              <div className="grid gap-3 md:grid-cols-[140px_1fr_auto] mb-4">
                <input
                  type="number"
                  value={season.seasonNumber}
                  onChange={(event) => updateSeasonField(seasonIndex, 'seasonNumber', Number(event.target.value))}
                  className="bg-neutral-900 border border-neutral-700 text-white p-3 rounded text-sm"
                  placeholder="Season Number"
                />
                <input
                  type="text"
                  value={season.title}
                  onChange={(event) => updateSeasonField(seasonIndex, 'title', event.target.value)}
                  className="bg-neutral-900 border border-neutral-700 text-white p-3 rounded text-sm"
                  placeholder="Season Title"
                />
                {seriesSeasons.length > 1 && (
                  <button
                    onClick={() => removeSeason(seasonIndex)}
                    className="bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-white px-4 py-3 rounded text-xs font-bold"
                  >
                    Remove Season
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {season.episodes.map((episode, episodeIndex) => (
                  <div key={`season-${seasonIndex}-episode-${episodeIndex}`} className="border border-neutral-800 rounded-md bg-black p-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        type="number"
                        value={episode.episodeNumber}
                        onChange={(event) => updateEpisodeField(seasonIndex, episodeIndex, 'episodeNumber', Number(event.target.value))}
                        className="bg-neutral-900 border border-neutral-700 text-white p-2 rounded text-sm"
                        placeholder="Episode Number"
                      />
                      <input
                        type="text"
                        value={episode.title}
                        onChange={(event) => updateEpisodeField(seasonIndex, episodeIndex, 'title', event.target.value)}
                        className="bg-neutral-900 border border-neutral-700 text-white p-2 rounded text-sm"
                        placeholder="Episode Title"
                      />
                      <input
                        type="text"
                        value={episode.video_url}
                        onChange={(event) => updateEpisodeField(seasonIndex, episodeIndex, 'video_url', event.target.value)}
                        className="bg-neutral-900 border border-neutral-700 text-white p-2 rounded text-sm md:col-span-2"
                        placeholder="Direct episode source URL"
                      />
                      <input
                        type="text"
                        value={episode.poster}
                        onChange={(event) => updateEpisodeField(seasonIndex, episodeIndex, 'poster', event.target.value)}
                        className="bg-neutral-900 border border-neutral-700 text-white p-2 rounded text-sm"
                        placeholder="Episode poster URL"
                      />
                      <input
                        type="text"
                        value={episode.thumbnail}
                        onChange={(event) => updateEpisodeField(seasonIndex, episodeIndex, 'thumbnail', event.target.value)}
                        className="bg-neutral-900 border border-neutral-700 text-white p-2 rounded text-sm"
                        placeholder="Episode thumbnail URL"
                      />
                      <textarea
                        value={episode.description}
                        onChange={(event) => updateEpisodeField(seasonIndex, episodeIndex, 'description', event.target.value)}
                        className="bg-neutral-900 border border-neutral-700 text-white p-2 rounded text-sm md:col-span-2 min-h-[80px]"
                        placeholder="Episode description"
                      />
                    </div>

                    <div className="flex justify-between items-center mt-3">
                      <span className="text-xs text-gray-500">Episode entry</span>
                      {season.episodes.length > 1 && (
                        <button
                          onClick={() => removeEpisode(seasonIndex, episodeIndex)}
                          className="text-xs bg-neutral-900 hover:bg-neutral-800 text-white px-3 py-1 rounded border border-neutral-700"
                        >
                          Remove Episode
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => addEpisode(seasonIndex)}
                className="mt-4 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded text-xs font-bold border border-neutral-700"
              >
                Add Episode
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white px-4 py-6 md:px-8 lg:px-10">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="rounded-2xl border border-neutral-800 bg-black/80 p-5 md:p-6">
          <h1 className="text-2xl md:text-4xl font-black tracking-tight text-red-500">
            UG Movies 247 | Admin Command Center
          </h1>
            <p className="mt-2 text-sm md:text-base text-gray-400 max-w-3xl">
              Manage premium HLS uploads and fast direct MP4 publishing side-by-side without mixing the two workflows.
            </p>

            <div className="mt-3">
              <a
                href="/admin/subscriptions"
                className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-emerald-200"
              >
                Subscription Diagnostics
              </a>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
            {([
              ['hls', 'HLS Uploads'],
              ['direct', 'Direct Uploads'],
              ['queue', 'Queue / Processing'],
              ['library', 'Library'],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 rounded-xl text-sm font-black uppercase tracking-[0.18em] border transition-colors ${
                  activeTab === tab
                    ? 'bg-red-700 border-red-600 text-white'
                    : 'bg-neutral-950 border-neutral-800 text-gray-400 hover:text-white hover:border-neutral-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {activeTab === 'hls' && (
          <div className="space-y-6">
            <section className="bg-black p-6 rounded-md border border-neutral-800">
              <h2 className="text-red-500 font-bold text-lg">HLS Uploads</h2>
              <p className="text-sm text-gray-400 mt-2">
                Adaptive streaming, queued FFmpeg processing, and premium playback. Recommended for the main publishing workflow.
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setHlsMode('upload')}
                  className={`px-4 py-2 rounded text-sm font-bold ${hlsMode === 'upload' ? 'bg-red-700 text-white' : 'bg-neutral-900 text-gray-400'}`}
                >
                  Local HLS Source
                </button>
                <button
                  onClick={() => setHlsMode('link')}
                  className={`px-4 py-2 rounded text-sm font-bold ${hlsMode === 'link' ? 'bg-red-700 text-white' : 'bg-neutral-900 text-gray-400'}`}
                >
                  Remote HLS Source
                </button>
              </div>
            </section>

            {renderMetadataCard()}
            {renderSeriesEditor()}

            <section className="bg-black p-6 rounded-md border border-neutral-800 space-y-5">
              <div>
                <h2 className="text-red-500 font-bold text-lg">HLS Workflow Input</h2>
                <p className="text-sm text-gray-500">
                  HLS Uploads always create queue jobs, validate sources, transcode to adaptive HLS, and publish `master.m3u8`.
                </p>
              </div>

              {hlsMode === 'upload' ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-gray-300 uppercase tracking-wider block mb-2">Single Local Source</label>
                    <input
                      type="file"
                      accept="video/mp4,video/x-mkv,video/*,.mkv"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        setHlsFile(file);
                        if (file) {
                          handleTitleSourceFromFile(file, 'hls');
                        }
                      }}
                      className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-bold file:bg-red-800 file:text-white hover:file:bg-red-700 cursor-pointer"
                    />
                  </div>

                  <button
                    onClick={handleHlsLocalUpload}
                    disabled={isSubmitting || !hlsFile || !selectedMovie}
                    className="w-full bg-red-700 hover:bg-red-600 disabled:bg-neutral-700 disabled:cursor-not-allowed py-4 rounded font-bold text-sm uppercase tracking-[0.2em]"
                  >
                    Queue Local Source For HLS
                  </button>

                  {hlsProgress > 0 && (
                    <div className="w-full bg-neutral-800 rounded-full h-4 border border-neutral-700 overflow-hidden">
                      <div className="bg-red-600 h-4 rounded-full transition-all duration-300 flex items-center justify-center text-[10px] font-bold text-white" style={{ width: `${hlsProgress}%` }}>
                        {hlsProgress}%
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {contentType === 'movie' && (
                    <div>
                      <label className="text-xs font-bold text-gray-300 uppercase tracking-wider block mb-2">Remote Source Link</label>
                      <input
                        type="text"
                        value={hlsRemoteLink}
                        onChange={(event) => setHlsRemoteLink(event.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-700 text-white p-3 rounded text-sm"
                        placeholder="https://.../movie.mp4"
                      />
                    </div>
                  )}

                  <button
                    onClick={handleHlsRemoteQueue}
                    disabled={isSubmitting || !selectedMovie}
                    className="w-full bg-red-700 hover:bg-red-600 disabled:bg-neutral-700 disabled:cursor-not-allowed py-4 rounded font-bold text-sm uppercase tracking-[0.2em]"
                  >
                    Queue Remote Source For HLS
                  </button>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2 pt-3 border-t border-neutral-800">
                <div className="border border-neutral-800 rounded-md p-4 bg-neutral-950">
                  <label className="text-xs font-bold text-gray-300 uppercase tracking-wider block mb-2">Bulk Local Uploads</label>
                  <input
                    type="file"
                    multiple
                    accept="video/mp4,video/x-mkv,video/*,.mkv"
                    onChange={(event) => setHlsBulkFiles(Array.from(event.target.files || []))}
                    className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-bold file:bg-red-800 file:text-white hover:file:bg-red-700 cursor-pointer"
                  />
                  <p className="text-xs text-gray-500 mt-2">{hlsBulkFiles.length} file(s) selected</p>
                  <button
                    onClick={handleHlsBulkLocalQueue}
                    disabled={isSubmitting}
                    className="mt-3 w-full bg-red-700 hover:bg-red-600 disabled:bg-neutral-700 py-3 rounded font-bold text-sm"
                  >
                    Queue Local Files
                  </button>
                </div>

                <div className="border border-neutral-800 rounded-md p-4 bg-neutral-950">
                  <label className="text-xs font-bold text-gray-300 uppercase tracking-wider block mb-2">Bulk Remote Video Links</label>
                  <textarea
                    value={hlsBulkRemoteLinks}
                    onChange={(event) => setHlsBulkRemoteLinks(event.target.value)}
                    placeholder="Paste one direct video URL per line"
                    className="w-full bg-neutral-900 border border-neutral-700 text-white p-3 rounded text-sm min-h-[140px]"
                  />
                  <button
                    onClick={handleHlsBulkRemoteQueue}
                    disabled={isSubmitting}
                    className="mt-3 w-full bg-neutral-800 hover:bg-neutral-700 disabled:bg-neutral-700 py-3 rounded font-bold text-sm border border-neutral-700"
                  >
                    Queue Remote Links
                  </button>
                </div>
              </div>

              <div className={`p-3 rounded font-mono text-sm border ${hlsStatus.toLowerCase().includes('failed') || hlsStatus.toLowerCase().includes('error') ? 'bg-red-900/40 border-red-500 text-red-200' : 'bg-neutral-900 border-neutral-700 text-yellow-400'}`}>
                {hlsStatus}
              </div>

              {hlsDiagnostics && (
                <div className="bg-black border border-red-900/50 p-4 rounded text-xs font-mono text-gray-400 whitespace-pre-wrap min-h-[110px]">
                  <span className="text-red-500 font-bold block mb-2">HLS Diagnostics</span>
                  {hlsDiagnostics}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'direct' && (
          <div className="space-y-6">
            <section className="bg-black p-6 rounded-md border border-neutral-800">
              <h2 className="text-red-500 font-bold text-lg">Direct Uploads</h2>
              <p className="text-sm text-gray-400 mt-2">
                Faster legacy workflow for direct MP4 playback. Use for quick publishing, direct MP4 uploads, and MKV-to-MP4 ingestion from remote links.
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setDirectMode('upload')}
                  className={`px-4 py-2 rounded text-sm font-bold ${directMode === 'upload' ? 'bg-red-700 text-white' : 'bg-neutral-900 text-gray-400'}`}
                >
                  Local Direct Upload
                </button>
                <button
                  onClick={() => setDirectMode('links')}
                  className={`px-4 py-2 rounded text-sm font-bold ${directMode === 'links' ? 'bg-red-700 text-white' : 'bg-neutral-900 text-gray-400'}`}
                >
                  Remote MP4 / MKV Links
                </button>
              </div>
            </section>

            {renderMetadataCard()}
            {renderSeriesEditor()}

            <section className="bg-black p-6 rounded-md border border-neutral-800 space-y-5">
              <div>
                <h2 className="text-red-500 font-bold text-lg">Direct Workflow Input</h2>
                <p className="text-sm text-gray-500">
                  Direct Uploads publish MP4 playback without the HLS transcoding pipeline. Remote MKV inputs are converted to clean MP4 first, then stored in our own R2 bucket.
                </p>
              </div>

              {directMode === 'upload' ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-gray-300 uppercase tracking-wider block mb-2">Local MP4 / MKV File</label>
                    <input
                      type="file"
                      accept="video/mp4,video/x-mkv,video/*,.mkv"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        setDirectFile(file);
                        if (file) {
                          handleTitleSourceFromFile(file, 'direct');
                        }
                      }}
                      className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-bold file:bg-red-800 file:text-white hover:file:bg-red-700 cursor-pointer"
                    />
                    <p className="text-xs text-gray-500 mt-2">
                      MP4 uploads publish directly. MKV uploads are staged, converted to MP4, then published through the direct pipeline.
                    </p>
                  </div>

                  <button
                    onClick={handleDirectLocalUpload}
                    disabled={isSubmitting || !directFile || !selectedMovie}
                    className="w-full bg-red-700 hover:bg-red-600 disabled:bg-neutral-700 disabled:cursor-not-allowed py-4 rounded font-bold text-sm uppercase tracking-[0.2em]"
                  >
                    Publish Direct Upload
                  </button>

                  {directProgress > 0 && (
                    <div className="w-full bg-neutral-800 rounded-full h-4 border border-neutral-700 overflow-hidden">
                      <div className="bg-red-600 h-4 rounded-full transition-all duration-300 flex items-center justify-center text-[10px] font-bold text-white" style={{ width: `${directProgress}%` }}>
                        {directProgress}%
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {contentType === 'movie' ? (
                    <div>
                      <label className="text-xs font-bold text-gray-300 uppercase tracking-wider block mb-2">Remote MP4 / MKV Links</label>
                      <textarea
                        value={directRemoteLinks}
                        onChange={(event) => setDirectRemoteLinks(event.target.value)}
                        placeholder="Paste one direct MP4 or MKV URL per line"
                        className="w-full bg-neutral-900 border border-neutral-700 text-white p-3 rounded text-sm min-h-[160px]"
                      />
                    </div>
                  ) : (
                    <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4 text-sm text-gray-400">
                      Series direct publishing works from the episode links above. Paste one direct MP4 or MKV link into each episode entry.
                    </div>
                  )}

                  <button
                    onClick={handleDirectRemoteQueue}
                    disabled={isSubmitting || !selectedMovie}
                    className="w-full bg-red-700 hover:bg-red-600 disabled:bg-neutral-700 disabled:cursor-not-allowed py-4 rounded font-bold text-sm uppercase tracking-[0.2em]"
                  >
                    Queue Direct Import
                  </button>
                </div>
              )}

              <div className={`p-3 rounded font-mono text-sm border ${directStatus.toLowerCase().includes('failed') || directStatus.toLowerCase().includes('error') ? 'bg-red-900/40 border-red-500 text-red-200' : 'bg-neutral-900 border-neutral-700 text-yellow-400'}`}>
                {directStatus}
              </div>

              {directDiagnostics && (
                <div className="bg-black border border-red-900/50 p-4 rounded text-xs font-mono text-gray-400 whitespace-pre-wrap min-h-[110px]">
                  <span className="text-red-500 font-bold block mb-2">Direct Diagnostics</span>
                  {directDiagnostics}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'queue' && (
          <div className="space-y-6">
            <section className="bg-black p-6 rounded-md border border-neutral-800">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-red-500 font-bold text-lg">Queue / Processing</h2>
                  <p className="text-sm text-gray-500">One worker processes heavy jobs sequentially. HLS and direct conversion/import jobs are separated below.</p>
                </div>
                <button onClick={loadAdminData} className="bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 px-4 py-2 rounded text-xs font-bold">
                  Refresh
                </button>
              </div>
            </section>

            {([
              ['HLS Processing Queue', jobsByTab.hlsJobs],
              ['Direct Upload Queue', jobsByTab.directJobs],
            ] as const).map(([title, jobs]) => (
              <section key={title} className="bg-black p-6 rounded-md border border-neutral-800">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-red-500 font-bold">{title}</h3>
                    <p className="text-sm text-gray-500">{jobs.length} job(s) tracked</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {jobs.length === 0 ? (
                    <div className="border border-dashed border-neutral-800 rounded-md p-6 text-sm text-gray-500">
                      No jobs in this queue right now.
                    </div>
                  ) : (
                    jobs.map((job) => (
                      <div key={job.id} className="border border-neutral-800 rounded-md bg-neutral-950 p-4">
                        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                          <div className="min-w-0">
                            <h4 className="text-white font-bold">{job.title}</h4>
                            <p className="text-xs text-gray-500 break-all mt-1">{job.sourceUrl || job.sourceFileName || 'No source recorded'}</p>
                            <div className="flex flex-wrap gap-2 mt-3 text-[11px] font-bold uppercase tracking-wider">
                              <span className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-gray-300">{getJobStatusLabel(job)}</span>
                              <span className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-gray-300">{getJobTypeLabel(job)}</span>
                              <span className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-gray-300">{job.sourcePipeline || 'hls_pipeline'}</span>
                            </div>
                            {job.errorMessage && (
                              <p className="mt-3 text-sm text-red-300">{job.errorMessage}</p>
                            )}
                          </div>

                          <div className="w-full lg:w-72">
                            <div className="w-full bg-neutral-900 rounded-full h-3 overflow-hidden border border-neutral-800">
                              <div className="bg-red-600 h-3 transition-all duration-300" style={{ width: `${job.progress || 0}%` }} />
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2 justify-start lg:justify-end">
                              {job.status === 'failed' && job.id && (
                                <button onClick={() => handleRetryJob(job.id || '')} className="bg-red-700 hover:bg-red-600 px-3 py-2 rounded text-xs font-bold">
                                  Retry
                                </button>
                              )}
                              {job.status !== 'ready' && job.status !== 'cancelled' && job.id && (
                                <button onClick={() => handleCancelJob(job.id || '')} className="bg-neutral-800 hover:bg-neutral-700 px-3 py-2 rounded text-xs font-bold border border-neutral-700">
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        )}

        {activeTab === 'library' && (
          <div className="space-y-6">
            <section className="bg-black p-6 rounded-md border border-neutral-800">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h2 className="text-red-500 font-bold text-lg">Library</h2>
                  <p className="text-sm text-gray-500">Review playback mode, pipeline, readiness status, and content type for each title.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    'all',
                    'hls',
                    'mp4',
                    'ready',
                    'processing',
                    'failed',
                  ] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setLibraryFilter(filter)}
                      className={`px-3 py-2 rounded text-xs font-bold uppercase tracking-wider ${libraryFilter === filter ? 'bg-red-700 text-white' : 'bg-neutral-900 text-gray-400 border border-neutral-800'}`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="bg-black p-6 rounded-md border border-neutral-800">
              <div className="hidden lg:grid lg:grid-cols-[1.4fr_100px_110px_180px_120px_140px] gap-4 px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] text-gray-500 border-b border-neutral-800">
                <div>Title</div>
                <div>Kind</div>
                <div>Playback</div>
                <div>Pipeline</div>
                <div>Status</div>
                <div>Updated</div>
              </div>

              <div className="space-y-3 lg:space-y-0">
                {filteredLibraryMovies.length === 0 ? (
                  <div className="border border-dashed border-neutral-800 rounded-md p-6 text-sm text-gray-500">
                    No library entries match this filter.
                  </div>
                ) : (
                  filteredLibraryMovies.map((movie) => (
                    <div
                      key={movie.key}
                      className="grid lg:grid-cols-[1.4fr_100px_110px_180px_120px_140px] gap-4 items-center px-4 py-4 border border-neutral-800 rounded-md bg-neutral-950"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-white truncate">{movie.title}</div>
                        <div className="text-xs text-gray-500 truncate mt-1">{movie.subtitle}</div>
                      </div>
                      <div className="text-sm text-gray-300 capitalize">{movie.kind}</div>
                      <div className="text-sm text-gray-300 uppercase">{movie.playbackType || 'mp4'}</div>
                      <div className="text-sm text-gray-300">{getPipelineLabel(movie.sourcePipeline)}</div>
                      <div className="text-sm text-gray-300 capitalize">{movie.status}</div>
                      <div className="text-sm text-gray-400">{movie.updatedAt ? new Date(movie.updatedAt).toLocaleDateString() : '-'}</div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
