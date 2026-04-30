export const HOME_PAGE_CATEGORY_CONFIG = [
  {
    name: 'Latest movies on Ugmovies24_7',
    displayLabel: 'LATEST TRAILERS ON UGMOVIES24_7',
    homeOrder: 10,
  },
  {
    name: 'Ongoing Series',
    displayLabel: 'Ongoing Series',
    homeOrder: 20,
  },
  {
    name: 'Recently added',
    displayLabel: 'RECENTLY ADDED MOVIES',
    homeOrder: 30,
  },
  {
    name: 'Latest series',
    displayLabel: 'LATEST SERIES',
    homeOrder: 40,
  },
  {
    name: 'Trending on tiktok',
    displayLabel: 'TRENDING ON TIKTOK',
    homeOrder: 50,
  },
  {
    name: 'VJ JUNIOR SERIES',
    displayLabel: 'VJ JUNIOR SERIES',
    homeOrder: 130,
  },
  {
    name: 'Asian series',
    displayLabel: 'ASIAN SERIES',
    homeOrder: 170,
  },
  {
    name: 'Other vjs',
    displayLabel: "OTHER VJ's",
    homeOrder: 190,
  },
  {
    name: 'Western series',
    displayLabel: 'WESTERN SERIES',
    homeOrder: 210,
  },
] as const;

export const MANUAL_HOME_CATEGORIES = HOME_PAGE_CATEGORY_CONFIG.map((category) => category.name) as readonly string[];

export type ManualHomeCategory = (typeof HOME_PAGE_CATEGORY_CONFIG)[number]['name'];

export const AUTO_HOME_ROW_CONFIG = [
  { title: 'VJ JUNIOR', order: 60 },
  { title: 'VJ EMMY', order: 70 },
  { title: 'VJ ULIO', order: 80 },
  { title: 'VJ SOUL', order: 90 },
  { title: 'VJ JINGO', order: 100 },
  { title: 'OMUTAKA ICE P', order: 110 },
  { title: 'ANIMATIONS', order: 120 },
  { title: 'ACTION & THRILLER', order: 140 },
  { title: 'ROMANCE', order: 150 },
  { title: 'COMEDY', order: 160 },
  { title: 'HORROR', order: 180 },
  { title: 'ADVENTURE', order: 200 },
  { title: 'INDIAN MOVIES', order: 220 },
] as const;

export const HOME_ROW_ORDER = [
  ...HOME_PAGE_CATEGORY_CONFIG.map((category) => category.displayLabel),
  ...AUTO_HOME_ROW_CONFIG.map((row) => row.title),
] as const;
