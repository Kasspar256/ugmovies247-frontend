export type LikeMovieInput = {
  movieId: string;
  title: string;
  poster: string;
};

export type LikeRecord = LikeMovieInput & {
  id: string;
  userId: string;
  likedAt?: { seconds?: number } | null;
};
