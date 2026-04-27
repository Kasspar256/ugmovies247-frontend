export type DownloadStatus = 'completed' | 'downloading' | 'failed' | 'cancelled';

export type DownloadContentType = 'movie' | 'episode' | 'part';

export type DownloadMovieInput = {
  movieId: string;
  title: string;
  video_url: string;
  poster: string;
  downloadKey?: string;
  contentType?: DownloadContentType;
  seriesId?: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeId?: string | null;
  episodeTitle?: string | null;
  partIndex?: number | null;
};

export type DownloadRecord = DownloadMovieInput & {
  id: string;
  userId: string;
  status?: DownloadStatus;
  description?: string;
  downloadedAt?: { seconds?: number } | null;
};
