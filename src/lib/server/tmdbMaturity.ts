import { mergeMatureExclusiveCategory } from '@/lib/matureContent';

type TmdbMaturityMediaType = 'movie' | 'tv';

export async function applyTmdbMatureExclusiveCategory(options: {
  categories: unknown;
  tmdbId?: unknown;
  mediaType: TmdbMaturityMediaType;
  tmdbPayload?: unknown;
  isKnownMatureExclusive?: boolean;
}) {
  return mergeMatureExclusiveCategory(options.categories);
}
