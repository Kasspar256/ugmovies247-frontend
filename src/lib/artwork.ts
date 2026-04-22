export type ArtworkVariant = 'card' | 'backdrop' | 'hero' | 'genre';

const TMDB_SIZE_BY_VARIANT: Record<ArtworkVariant, string> = {
  card: 'w342',
  backdrop: 'w780',
  hero: 'w1280',
  genre: 'w500',
};

export function getOptimizedArtworkUrl(src: string | undefined, variant: ArtworkVariant = 'card') {
  const normalizedSrc = String(src || '').trim();

  if (!normalizedSrc) {
    return '';
  }

  if (!/https?:\/\/image\.tmdb\.org\/t\/p\//i.test(normalizedSrc)) {
    return normalizedSrc;
  }

  const targetSize = TMDB_SIZE_BY_VARIANT[variant];
  return normalizedSrc.replace(/\/t\/p\/[^/]+\//i, `/t/p/${targetSize}/`);
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
