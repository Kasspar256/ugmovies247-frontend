import {
  listUserDownloads,
  listUserLikes,
  listUserWatchHistory,
  listUserWatchlist,
} from '@/lib/server/userLibrary';
import {
  readAiLibraryFromNeon,
  syncAiLibraryToNeon,
  type AiMemoryLibraryItem,
} from '@/lib/server/aiMemory';
import type {
  AiPersonalizationContext,
  AiPersonalizationMovieItem,
} from '@/lib/server/aiGemini';
import type { DownloadRecord } from '@/types/downloads';
import type { LikeRecord } from '@/types/likes';
import type { WatchHistoryRecord } from '@/types/watchHistory';
import type { WatchlistRecord } from '@/types/watchlist';

const MAX_LIBRARY_ITEMS_FOR_AI = 20;

function timestampToIso(value: { seconds?: number } | null | undefined) {
  if (!value?.seconds) {
    return null;
  }

  return new Date(value.seconds * 1000).toISOString();
}

function summarizeDownload(record: DownloadRecord): AiPersonalizationMovieItem {
  return {
    movieID: record.movieId,
    title: record.title,
    poster: record.poster,
    status: record.status || 'completed',
    downloadedAt: timestampToIso(record.downloadedAt),
  };
}

function summarizeNeonDownload(record: AiMemoryLibraryItem): AiPersonalizationMovieItem {
  return {
    movieID: record.movieID,
    title: record.title,
    poster: record.poster,
    status: record.status || 'completed',
    downloadedAt: record.downloadedAt,
  };
}

function summarizeWatchlist(record: WatchlistRecord): AiPersonalizationMovieItem {
  return {
    movieID: record.movieId,
    title: record.title,
    poster: record.poster,
    savedAt: timestampToIso(record.savedAt),
  };
}

function summarizeNeonWatchlist(record: AiMemoryLibraryItem): AiPersonalizationMovieItem {
  return {
    movieID: record.movieID,
    title: record.title,
    poster: record.poster,
    savedAt: record.savedAt,
  };
}

function summarizeLike(record: LikeRecord): AiPersonalizationMovieItem {
  return {
    movieID: record.movieId,
    title: record.title,
    poster: record.poster,
    likedAt: timestampToIso(record.likedAt),
  };
}

function summarizeWatchHistory(record: WatchHistoryRecord): AiPersonalizationMovieItem {
  return {
    movieID: record.movieId,
    title: record.title,
    poster: record.poster,
    status: record.completed ? 'completed' : 'in_progress',
    lastWatchedAt: timestampToIso(record.lastWatchedAt),
    progressPercent: record.progressPercent,
    completed: record.completed,
    watchHref: record.watchHref,
  };
}

function limitItems<T>(items: T[]) {
  return items.slice(0, MAX_LIBRARY_ITEMS_FOR_AI);
}

export async function buildAiPersonalizationContext(
  uid: string | null | undefined
): Promise<AiPersonalizationContext> {
  if (!uid) {
    return {
      signedIn: false,
      watchlist: { total: 0, items: [] },
      downloads: { total: 0, items: [] },
      likes: { total: 0, items: [] },
      watchHistory: {
        available: false,
        total: 0,
        items: [],
        note: 'The user is not signed in, so personal library data is unavailable.',
      },
      notes: ['Ask the user to sign in before discussing personal library items.'],
    };
  }

  const [downloadsResult, watchlistResult, likesResult, watchHistoryResult] = await Promise.allSettled([
    listUserDownloads(uid),
    listUserWatchlist(uid),
    listUserLikes(uid),
    listUserWatchHistory(uid),
  ]);
  const downloads = downloadsResult.status === 'fulfilled' ? downloadsResult.value : [];
  const watchlist = watchlistResult.status === 'fulfilled' ? watchlistResult.value : [];
  const likes = likesResult.status === 'fulfilled' ? likesResult.value : [];
  const watchHistory = watchHistoryResult.status === 'fulfilled' ? watchHistoryResult.value : [];
  const canSafelyMirrorLibrary =
    downloadsResult.status === 'fulfilled' && watchlistResult.status === 'fulfilled';
  let neonLibrary: Awaited<ReturnType<typeof readAiLibraryFromNeon>> | null = null;

  try {
    if (canSafelyMirrorLibrary) {
      await syncAiLibraryToNeon({ userId: uid, downloads, watchlist });
    }

    neonLibrary = await readAiLibraryFromNeon(uid);
  } catch (error) {
    console.warn('[ai-chat] Neon user library sync/read failed, using Firestore summaries', error);
  }

  const neonWatchlist = neonLibrary?.watchlist || [];
  const neonDownloads = neonLibrary?.downloads || [];

  return {
    signedIn: true,
    watchlist: {
      total: Math.max(watchlist.length, neonWatchlist.length),
      items: neonWatchlist.length
        ? limitItems(neonWatchlist).map(summarizeNeonWatchlist)
        : limitItems(watchlist).map(summarizeWatchlist),
    },
    downloads: {
      total: Math.max(downloads.length, neonDownloads.length),
      items: neonDownloads.length
        ? limitItems(neonDownloads).map(summarizeNeonDownload)
        : limitItems(downloads).map(summarizeDownload),
    },
    likes: {
      total: likes.length,
      items: limitItems(likes).map(summarizeLike),
    },
    watchHistory: {
      available: true,
      total: watchHistory.length,
      items: limitItems(watchHistory).map(summarizeWatchHistory),
      note:
        watchHistory.length > 0
          ? 'Watch history is available from server-side playback records.'
          : 'No watched-history records found yet. New playback activity will appear here after the user watches a movie.',
    },
    notes: [
      neonLibrary
        ? 'Watchlist and downloads are mirrored through Neon for AI context.'
        : 'Watchlist and downloads are available from Firestore fallback summaries.',
    ],
  };
}
