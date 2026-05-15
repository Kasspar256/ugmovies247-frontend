export type PlaybackProgressMovieInput = {
  movieId: string;
  title?: string;
  poster?: string;
  watchHref?: string;
  lastPosition?: number;
  totalDuration?: number;
  isFinished?: boolean;
};

export type PlaybackProgressRecord = Required<
  Pick<PlaybackProgressMovieInput, 'movieId' | 'lastPosition' | 'totalDuration' | 'isFinished'>
> & {
  id: string;
  userId: string;
  title: string;
  poster: string;
  watchHref: string;
  progressPercent: number;
  lastUpdated?: { seconds?: number; nanoseconds?: number } | null;
};

export type CachedPlaybackProgressRecord = Omit<PlaybackProgressRecord, 'userId' | 'lastUpdated'> & {
  lastUpdatedMs: number;
};
