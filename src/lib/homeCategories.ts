export const MANUAL_HOME_CATEGORIES = [
  'Latest movies on Ugmovies24_7',
  'Ongoing Series',
  'Recently added',
  'Latest series',
  'Trending on tiktok',
  'VJ JUNIOR SERIES',
  'Asian series',
  'Other vjs',
  'Western series',
] as const;

export type ManualHomeCategory = (typeof MANUAL_HOME_CATEGORIES)[number];

export const HOME_ROW_ORDER = [
  'LATEST MOVIES ON UGMOVIES24_7',
  'Ongoing Series',
  'RECENTLY ADDED MOVIES',
  'LATEST SERIES',
  'TRENDING ON TIKTOK',
  'VJ JUNIOR',
  'VJ EMMY',
  'VJ ULIO',
  'VJ SOUL',
  'VJ JINGO',
  'OMUTAKA ICE P',
  'ANIMATIONS',
  'VJ JUNIOR SERIES',
  'ACTION & THRILLER',
  'ROMANCE',
  'COMEDY',
  'ASIAN SERIES',
  'HORROR',
  "OTHER VJ's",
  'ADVENTURE',
  'WESTERN SERIES',
  'INDIAN MOVIES',
] as const;
