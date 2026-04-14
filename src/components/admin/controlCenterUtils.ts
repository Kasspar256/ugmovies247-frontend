import type { AdminCategory, AdminRequestStatus } from '@/types/admin';
import type { Movie } from '@/types/movie';

export type AdminTab =
  | 'overview'
  | 'movies'
  | 'series'
  | 'library'
  | 'categories'
  | 'users'
  | 'requests'
  | 'revenue';

export type DraftVideoSource = {
  mode: 'url' | 'file';
  url: string;
  file: File | null;
};

export type DraftMoviePart = {
  id: string;
  label: string;
  order: number;
  title: string;
  description: string;
  source: DraftVideoSource;
};

export type DraftEpisode = {
  id: string;
  persistedSeasonNumber?: number | null;
  persistedEpisodeNumber?: number | null;
  episodeNumber: number;
  title: string;
  description: string;
  poster: string;
  posterFile: File | null;
  thumbnail: string;
  thumbnailFile: File | null;
  source: DraftVideoSource;
};

export type DraftSeason = {
  id: string;
  seasonNumber: number;
  title: string;
  overview: string;
  poster: string;
  posterFile: File | null;
  tmdbId?: number | null;
  episodes: DraftEpisode[];
};

export type MovieDraft = {
  title: string;
  description: string;
  poster: string;
  posterFile: File | null;
  releaseYear: string;
  language: string;
  vj: string;
  genres: string;
  tags: string;
  cast: string;
  accessTier: 'free' | 'premium';
  isTrendingTikTok: boolean;
  categories: string[];
  source: DraftVideoSource;
  parts: DraftMoviePart[];
};

export type SeriesDraft = {
  title: string;
  description: string;
  poster: string;
  posterFile: File | null;
  releaseYear: string;
  language: string;
  vj: string;
  genres: string;
  tags: string;
  cast: string;
  accessTier: 'free' | 'premium';
  isTrendingTikTok: boolean;
  categories: string[];
  seasons: DraftSeason[];
};

export type CategoryDraft = {
  id: string;
  name: string;
  displayLabel: string;
  description: string;
  type: AdminCategory['type'];
  homeOrder: number | null;
  isVisible: boolean;
};

export const REQUEST_STATUS_OPTIONS: AdminRequestStatus[] = [
  'new',
  'reviewing',
  'planned',
  'uploaded',
  'closed',
];

export function createClientId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function moveArrayItem<T>(items: T[], fromIndex: number, delta: number) {
  const nextIndex = fromIndex + delta;

  if (nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);
  nextItems.splice(nextIndex, 0, item);
  return nextItems;
}

export function formatDate(value?: string) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString();
}

export function splitCommaList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function createEmptyVideoSource(): DraftVideoSource {
  return {
    mode: 'url',
    url: '',
    file: null,
  };
}

export function createEmptyMoviePart(index = 0): DraftMoviePart {
  return {
    id: createClientId('part'),
    label: `Part ${String.fromCharCode(65 + index)}`,
    order: index + 1,
    title: '',
    description: '',
    source: createEmptyVideoSource(),
  };
}

export function createEmptyEpisode(index = 0): DraftEpisode {
  return {
    id: createClientId('episode'),
    persistedSeasonNumber: null,
    persistedEpisodeNumber: null,
    episodeNumber: index + 1,
    title: `Episode ${index + 1}`,
    description: '',
    poster: '',
    posterFile: null,
    thumbnail: '',
    thumbnailFile: null,
    source: createEmptyVideoSource(),
  };
}

export function createEmptySeason(index = 0): DraftSeason {
  return {
    id: createClientId('season'),
    seasonNumber: index + 1,
    title: `Season ${index + 1}`,
    overview: '',
    poster: '',
    posterFile: null,
    tmdbId: null,
    episodes: [createEmptyEpisode(0)],
  };
}

export function createEmptyMovieDraft(): MovieDraft {
  return {
    title: '',
    description: '',
    poster: '',
    posterFile: null,
    releaseYear: '',
    language: '',
    vj: 'Unknown',
    genres: '',
    tags: '',
    cast: '',
    accessTier: 'premium',
    isTrendingTikTok: false,
    categories: [],
    source: createEmptyVideoSource(),
    parts: [],
  };
}

export function createEmptySeriesDraft(): SeriesDraft {
  return {
    title: '',
    description: '',
    poster: '',
    posterFile: null,
    releaseYear: '',
    language: '',
    vj: 'Unknown',
    genres: '',
    tags: '',
    cast: '',
    accessTier: 'premium',
    isTrendingTikTok: false,
    categories: [],
    seasons: [createEmptySeason(0)],
  };
}

export function movieToDraft(movie: Movie): MovieDraft {
  return {
    title: movie.title || '',
    description: movie.description || movie.overview || '',
    poster: movie.poster || '',
    posterFile: null,
    releaseYear: movie.releaseYear ? String(movie.releaseYear) : movie.release_date?.slice(0, 4) || '',
    language: movie.language || '',
    vj: movie.vj || 'Unknown',
    genres: (movie.genres || []).join(', '),
    tags: (movie.tags || []).join(', '),
    cast: (movie.cast || []).join(', '),
    accessTier: movie.accessTier === 'free' ? 'free' : 'premium',
    isTrendingTikTok: Boolean(movie.is_trending_tiktok),
    categories: movie.category || [],
    source: { mode: 'url', url: movie.video_url || movie.sourceUrl || '', file: null },
    parts: (movie.parts || []).map((part, index) => ({
      id: part.id,
      label: part.label || `Part ${String.fromCharCode(65 + index)}`,
      order: part.order || index + 1,
      title: part.title || '',
      description: part.description || '',
      source: { mode: 'url', url: part.video_url || part.sourceUrl || '', file: null },
    })),
  };
}

export function seriesToDraft(movie: Movie): SeriesDraft {
  return {
    title: movie.title || '',
    description: movie.description || movie.overview || '',
    poster: movie.poster || '',
    posterFile: null,
    releaseYear: movie.releaseYear ? String(movie.releaseYear) : movie.release_date?.slice(0, 4) || '',
    language: movie.language || '',
    vj: movie.vj || 'Unknown',
    genres: (movie.genres || []).join(', '),
    tags: (movie.tags || []).join(', '),
    cast: (movie.cast || []).join(', '),
    accessTier: movie.accessTier === 'free' ? 'free' : 'premium',
    isTrendingTikTok: Boolean(movie.is_trending_tiktok),
    categories: movie.category || [],
    seasons:
      (movie.seasons || []).map((season, seasonIndex) => ({
        id: createClientId(`season-${season.seasonNumber || seasonIndex + 1}`),
        seasonNumber: season.seasonNumber || seasonIndex + 1,
        title: season.title || `Season ${seasonIndex + 1}`,
        overview: season.overview || '',
        poster: season.poster || '',
        posterFile: null,
        tmdbId: season.tmdb_id ?? null,
        episodes: (season.episodes || []).map((episode, episodeIndex) => ({
          id: createClientId(`episode-${season.seasonNumber}-${episode.episodeNumber}`),
          persistedSeasonNumber: season.seasonNumber || seasonIndex + 1,
          persistedEpisodeNumber: episode.episodeNumber || episodeIndex + 1,
          episodeNumber: episode.episodeNumber || episodeIndex + 1,
          title: episode.title || `Episode ${episodeIndex + 1}`,
          description: episode.description || episode.overview || '',
          poster: episode.poster || '',
          posterFile: null,
          thumbnail: episode.thumbnail || '',
          thumbnailFile: null,
          source: { mode: 'url', url: episode.video_url || episode.sourceUrl || '', file: null },
        })),
      })) || [],
  };
}
