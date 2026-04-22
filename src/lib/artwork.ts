export type ArtworkVariant = 'card' | 'backdrop' | 'hero' | 'genre';

const TMDB_SIZE_BY_VARIANT: Record<ArtworkVariant, string> = {
  card: 'w342',
  backdrop: 'w780',
  hero: 'w1280',
  genre: 'w500',
};

type ArtworkImageProps = {
  src: string;
  srcSet?: string;
  sizes?: string;
};

const TMDB_POSTER_SOURCE_SET_SIZES = ['w185', 'w342', 'w500'] as const;
const TMDB_BACKDROP_SOURCE_SET_SIZES = ['w300', 'w780', 'w1280'] as const;

const ARTWORK_DISPLAY_SIZES: Record<ArtworkVariant, string> = {
  card: '(max-width: 768px) 33vw, (max-width: 1200px) 220px, 236px',
  backdrop: '(max-width: 768px) 62vw, (max-width: 1200px) 430px, 520px',
  hero: '100vw',
  genre: '(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw',
};

declare global {
  // eslint-disable-next-line no-var
  var __ugmoviesLoadedArtworkUrls: Set<string> | undefined;
}

const loadedArtworkUrls =
  globalThis.__ugmoviesLoadedArtworkUrls ||
  (globalThis.__ugmoviesLoadedArtworkUrls = new Set<string>());

function isTmdbArtworkUrl(src: string) {
  return /https?:\/\/image\.tmdb\.org\/t\/p\//i.test(src);
}

function replaceTmdbSize(src: string, size: string) {
  return src.replace(/\/t\/p\/[^/]+\//i, `/t/p/${size}/`);
}

function getWidthFromTmdbSize(size: string) {
  return Number(size.replace(/\D+/g, '')) || 0;
}

export function getOptimizedArtworkUrl(src: string | undefined, variant: ArtworkVariant = 'card') {
  const normalizedSrc = String(src || '').trim();

  if (!normalizedSrc) {
    return '';
  }

  if (!isTmdbArtworkUrl(normalizedSrc)) {
    return normalizedSrc;
  }

  const targetSize = TMDB_SIZE_BY_VARIANT[variant];
  return replaceTmdbSize(normalizedSrc, targetSize);
}

export function getArtworkImageProps(
  src: string | undefined,
  variant: ArtworkVariant = 'card'
): ArtworkImageProps {
  const normalizedSrc = String(src || '').trim();

  if (!normalizedSrc) {
    return { src: '' };
  }

  if (!isTmdbArtworkUrl(normalizedSrc)) {
    return { src: normalizedSrc };
  }

  const sourceSizes =
    variant === 'card' || variant === 'genre'
      ? TMDB_POSTER_SOURCE_SET_SIZES
      : TMDB_BACKDROP_SOURCE_SET_SIZES;

  return {
    src: getOptimizedArtworkUrl(normalizedSrc, variant),
    srcSet: sourceSizes
      .map((size) => `${replaceTmdbSize(normalizedSrc, size)} ${getWidthFromTmdbSize(size)}w`)
      .join(', '),
    sizes: ARTWORK_DISPLAY_SIZES[variant],
  };
}

export function getArtworkOrigin(src: string | undefined) {
  const normalizedSrc = String(src || '').trim();

  if (!normalizedSrc) {
    return '';
  }

  try {
    return new URL(normalizedSrc).origin;
  } catch {
    return '';
  }
}

export function hasLoadedArtworkUrl(src: string | undefined) {
  const normalizedSrc = String(src || '').trim();
  return Boolean(normalizedSrc && loadedArtworkUrls.has(normalizedSrc));
}

export function markArtworkUrlLoaded(src: string | undefined) {
  const normalizedSrc = String(src || '').trim();

  if (!normalizedSrc) {
    return;
  }

  loadedArtworkUrls.add(normalizedSrc);
}
