export type WatchHistoryMovieInput = {
  movieId: string;
  title: string;
  poster?: string;
  watchHref?: string;
  progressSeconds?: number;
  durationSeconds?: number;
  progressPercent?: number;
  completed?: boolean;
};

export type WatchHistoryRecord = WatchHistoryMovieInput & {
  id: string;
  userId: string;
  lastWatchedAt?: { seconds?: number } | null;
};
