export type DownloadStatus = 'completed' | 'downloading' | 'failed';

export type DownloadMovieInput = {
  movieId: string;
  title: string;
  video_url: string;
  poster: string;
};

export type DownloadRecord = DownloadMovieInput & {
  id: string;
  userId: string;
  status?: DownloadStatus;
  description?: string;
  downloadedAt?: { seconds?: number } | null;
};
