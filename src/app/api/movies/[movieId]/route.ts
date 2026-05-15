import { NextResponse } from 'next/server';
import { adminDb, getFirebaseAdminSetupError } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession } from '@/lib/auth/server';
import {
  getSubscriptionSnapshotFromData,
  getViewerEntitlement,
} from '@/lib/server/subscriptions';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import { isAppInReview } from '@/lib/appReview';
import { getMappedTrailerUrlForTitle } from '@/lib/reviewTrailers';
import type { SubscriptionEntitlement } from '@/types/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ENTITLEMENT: SubscriptionEntitlement = {
  hasPremiumAccess: false,
  requiresSubscription: true,
  subscription: getSubscriptionSnapshotFromData(null),
};

function isPremiumAccessTier(accessTier: unknown) {
  return accessTier !== 'free';
}

function isPlaybackAssetReady(asset: Record<string, unknown>) {
  const jobStatus = typeof asset.jobStatus === 'string' ? asset.jobStatus : '';
  return !jobStatus || jobStatus === 'ready';
}

function sanitizeEpisodeForViewer(
  episode: Record<string, unknown>,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(episode.accessTier);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;
  const sanitizedEpisode = {
    ...episode,
    masterPlaylistUrl: '',
    availableRenditions: [],
    playbackType: 'mp4',
  };

  if (!isLocked && isPlaybackAssetReady(episode)) {
    return {
      ...sanitizedEpisode,
      subscriptionRequired,
      isLocked: false,
    };
  }

  if (!isLocked) {
    return {
      ...sanitizedEpisode,
      video_url: '',
      sourceUrl: '',
      sourceFileName: '',
      subscriptionRequired,
      isLocked: false,
    };
  }

  return {
    ...sanitizedEpisode,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    subscriptionRequired,
    isLocked: true,
  };
}

function sanitizeMoviePartForViewer(
  part: Record<string, unknown>,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(part.accessTier);
  const isLocked = subscriptionRequired && !entitlement.hasPremiumAccess;
  const sanitizedPart = {
    ...part,
    masterPlaylistUrl: '',
    availableRenditions: [],
    playbackType: 'mp4',
  };

  if (!isLocked && isPlaybackAssetReady(part)) {
    return {
      ...sanitizedPart,
      subscriptionRequired,
      isLocked: false,
    };
  }

  if (!isLocked) {
    return {
      ...sanitizedPart,
      video_url: '',
      sourceUrl: '',
      sourceFileName: '',
      subscriptionRequired,
      isLocked: false,
    };
  }

  return {
    ...sanitizedPart,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    subscriptionRequired,
    isLocked: true,
  };
}

function sanitizeMovieForViewerLocally(
  movie: Record<string, unknown>,
  entitlement: SubscriptionEntitlement
) {
  const subscriptionRequired = isPremiumAccessTier(movie.accessTier);
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
    const shouldExposePrimaryMovieSource = parts.length === 0 && isPlaybackAssetReady(movie);

    return {
      ...movie,
      video_url: shouldExposePrimaryMovieSource ? String(movie.video_url || '') : '',
      sourceUrl: shouldExposePrimaryMovieSource ? String(movie.sourceUrl || '') : '',
      sourceFileName: shouldExposePrimaryMovieSource ? String(movie.sourceFileName || '') : '',
      parts,
      seasons,
      masterPlaylistUrl: '',
      availableRenditions: [],
      playbackType: 'mp4',
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
    parts,
    seasons,
    masterPlaylistUrl: '',
    availableRenditions: [],
    playbackType: 'mp4',
    accessTier: 'premium',
    subscriptionRequired: true,
    isLocked: true,
  };
}

function sanitizeMovieForReviewMode(movie: Record<string, unknown>) {
  const stripPlaybackFields = (entry: Record<string, unknown>) => ({
    ...entry,
    video_url: '',
    sourceUrl: '',
    sourceFileName: '',
    masterPlaylistUrl: '',
    availableRenditions: [],
    playbackType: 'mp4',
    accessTier: 'free',
    subscriptionRequired: false,
    isLocked: false,
  });

  const parts = Array.isArray(movie.parts)
    ? movie.parts.map((part) => stripPlaybackFields(part as Record<string, unknown>))
    : [];
  const seasons = Array.isArray(movie.seasons)
    ? movie.seasons.map((season) => {
        const rawSeason = season as Record<string, unknown>;
        const episodes = Array.isArray(rawSeason.episodes)
          ? rawSeason.episodes.map((episode) => stripPlaybackFields(episode as Record<string, unknown>))
          : [];

        return {
          ...rawSeason,
          episodes,
        };
      })
    : [];

  return {
    ...stripPlaybackFields(movie),
    parts,
    seasons,
  };
}

function hasPublicPlaybackAsset(movieDoc: Record<string, unknown>) {
  const parts = Array.isArray(movieDoc.parts) ? movieDoc.parts : [];

  if (parts.length === 0 && isPlaybackAssetReady(movieDoc) && Boolean(movieDoc.video_url)) {
    return true;
  }

  if (
    parts.some((part) => {
      const rawPart = part as Record<string, unknown>;
      return isPlaybackAssetReady(rawPart) && Boolean(rawPart.video_url);
    })
  ) {
    return true;
  }

  const seasons = Array.isArray(movieDoc.seasons) ? movieDoc.seasons : [];

  return seasons.some((season) => {
    const rawSeason = season as Record<string, unknown>;
    const episodes = Array.isArray(rawSeason.episodes) ? rawSeason.episodes : [];

    return episodes.some((episode) => {
      const rawEpisode = episode as Record<string, unknown>;
      return isPlaybackAssetReady(rawEpisode) && Boolean(rawEpisode.video_url);
    });
  });
}

function withReviewTrailerFallback(movieDoc: Record<string, unknown>): Record<string, unknown> {
  const trailerUrl =
    String(movieDoc.trailer_url || '').trim() ||
    getMappedTrailerUrlForTitle(String(movieDoc.title || '')) ||
    getMappedTrailerUrlForTitle(String(movieDoc.name || '')) ||
    getMappedTrailerUrlForTitle(String(movieDoc.original_title || '')) ||
    getMappedTrailerUrlForTitle(String(movieDoc.file_name || '')) ||
    getMappedTrailerUrlForTitle(String(movieDoc.sourceFileName || ''));

  return {
    ...movieDoc,
    trailer_url: trailerUrl,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: { movieId: string } }
) {
  try {
    const adminSetupError = getFirebaseAdminSetupError();

    if (adminSetupError) {
      return NextResponse.json(
        { error: 'Movie backend is not configured.', detail: adminSetupError },
        { status: 500 }
      );
    }

    const movieId = decodeURIComponent(String(params.movieId || '')).trim();

    if (!movieId) {
      return NextResponse.json({ error: 'Missing movie ID.' }, { status: 400 });
    }

    const session = await getCurrentAuthSession();
    const entitlement = session
      ? await getViewerEntitlement(session.uid, {
          email: session.email,
          role: session.role,
        })
      : DEFAULT_ENTITLEMENT;
    const snapshot = await adminDb.collection(MOVIES_COLLECTION).doc(movieId).get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: 'Movie not found.' }, { status: 404 });
    }

    const movieDoc = withReviewTrailerFallback({
      id: snapshot.id,
      ...snapshot.data(),
    });

    if (isAppInReview && movieDoc.is_for_review !== true) {
      return NextResponse.json({ error: 'Movie not found.' }, { status: 404 });
    }

    if (!isAppInReview && !hasPublicPlaybackAsset(movieDoc)) {
      return NextResponse.json({ error: 'Movie is not ready yet.' }, { status: 409 });
    }

    const sanitizedMovie = sanitizeMovieForViewerLocally(movieDoc, entitlement);
    const movie = isAppInReview ? sanitizeMovieForReviewMode(sanitizedMovie) : sanitizedMovie;

    return NextResponse.json({ movie, entitlement });
  } catch (error) {
    console.error('[movie-api] failed to load movie', error);
    return NextResponse.json(
      {
        error: 'Failed to load movie.',
        detail: error instanceof Error ? error.message : 'Unknown movie API error.',
      },
      { status: 500 }
    );
  }
}
