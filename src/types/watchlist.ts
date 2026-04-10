export type WatchlistMovieInput = {
  movieId: string;
  title: string;
  poster: string;
  video_url: string;
};

export type WatchlistRecord = WatchlistMovieInput & {
  id: string;
  userId: string;
  savedAt?: { seconds?: number } | null;
};
