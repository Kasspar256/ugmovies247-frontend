import type { Movie } from '@/types/movie';
import type { SubscriptionEntitlement } from '@/types/subscriptions';

function isPremiumAccessTier(accessTier: unknown, subscriptionRequired?: unknown) {
  if (subscriptionRequired === false) {
    return false;
  }

  return accessTier !== 'free';
}

export function movieRequiresSubscription(movie: Partial<Movie> | Record<string, unknown>) {
  return isPremiumAccessTier(
    (movie as Record<string, unknown>).accessTier,
    (movie as Record<string, unknown>).subscriptionRequired
  );
}

function sanitizeEpisodeForViewer(
  episode: Record<string, unknown>,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(episode.accessTier, episode.subscriptionRequired);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;

  if (!isLocked) {
    return {
      ...episode,
      subscriptionRequired,
      isLocked: false,
    };
  }

  return {
    ...episode,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    masterPlaylistUrl: '',
    availableRenditions: [],
    subscriptionRequired,
    isLocked: true,
  };
}

function sanitizeMoviePartForViewer(
  part: Record<string, unknown>,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(part.accessTier, part.subscriptionRequired);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;

  if (!isLocked) {
    return {
      ...part,
      subscriptionRequired,
      isLocked: false,
    };
  }

  return {
    ...part,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    masterPlaylistUrl: '',
    availableRenditions: [],
    subscriptionRequired,
    isLocked: true,
  };
}

export function sanitizeMovieForViewer(
  movie: Record<string, unknown>,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(movie.accessTier, movie.subscriptionRequired);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;
  const parts = Array.isArray(movie.parts)
    ? movie.parts.map((part) =>
        sanitizeMoviePartForViewer(part as Record<string, unknown>, entitlement)
      )
    : [];
  const seasons = Array.isArray(movie.seasons)
    ? movie.seasons.map((season) => {
        const rawSeason = season as Record<string, unknown>;
        const episodes = Array.isArray(rawSeason.episodes)
          ? rawSeason.episodes.map((episode) =>
              sanitizeEpisodeForViewer(episode as Record<string, unknown>, entitlement)
            )
          : [];

        return {
          ...rawSeason,
          episodes,
        };
      })
    : [];

  if (!isLocked) {
    return {
      ...movie,
      parts,
      seasons,
      accessTier: subscriptionRequired ? 'premium' : 'free',
      subscriptionRequired,
      isLocked: false,
    };
  }

  return {
    ...movie,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    masterPlaylistUrl: '',
    availableRenditions: [],
    parts,
    seasons,
    accessTier: 'premium',
    subscriptionRequired: true,
    isLocked: true,
  };
}
