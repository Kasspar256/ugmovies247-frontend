'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bookmark, Film } from 'lucide-react';
import { fetchUserWatchlist } from '@/lib/watchlist';
import MobilePageHeader from '@/components/MobilePageHeader';
import type { WatchlistRecord } from '@/types/watchlist';

export default function WatchlistPage() {
  const [watchlistMovies, setWatchlistMovies] = useState<WatchlistRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadWatchlist = async () => {
      try {
        const watchlist = await fetchUserWatchlist();
        setWatchlistMovies(watchlist);
      } catch (err) {
        console.error('Error fetching watchlist:', err);
      } finally {
        setLoading(false);
      }
    };

    loadWatchlist();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#1F2833] border-t-[#D90429] rounded-full animate-spin mb-4"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pb-14 md:pt-[118px] lg:px-10 font-sans">
      <MobilePageHeader title="My List" fallbackHref="/profile" />

      <div className="mt-4 md:mt-2 max-w-5xl mx-auto">
        <div className="hidden md:flex items-center gap-4 mb-8">
          <Bookmark size={32} className="text-[#D90429]" />
          <h1 className="text-3xl font-black text-white uppercase tracking-wider">My List</h1>
        </div>

        <div className="bg-[#1F2833]/30 border border-[#1F2833] rounded-lg p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film size={20} className="text-[#888888]" />
            <span className="text-[#888888] text-sm font-medium">
              Titles saved to your account
            </span>
          </div>
          <span className="text-xs text-[#888888] font-mono">
            {watchlistMovies.length} saved
          </span>
        </div>

        {!watchlistMovies.length ? (
          <div className="bg-[#1F2833]/20 border border-white/10 rounded-lg p-6 text-center">
            <p className="text-white font-bold mb-2">Your watchlist is empty</p>
            <p className="text-[#888888] text-sm">
              Tap Add to My List on any movie page to keep it here for later.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {watchlistMovies.map((movie) => (
              <Link
                href={`/movie/${movie.movieId}`}
                key={movie.id}
                className="group bg-[#1F2833]/20 border border-white/5 hover:border-[#D90429]/50 rounded-lg overflow-hidden transition-colors"
              >
                <div className="aspect-[2/3] bg-[#1F2833] overflow-hidden">
                  <img
                    src={movie.poster}
                    alt={movie.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="p-3">
                  <h3 className="text-white text-sm md:text-base font-bold line-clamp-2 group-hover:text-[#D90429] transition-colors">
                    {movie.title}
                  </h3>
                  <p className="text-[#888888] text-[10px] md:text-xs mt-2 uppercase tracking-wider">
                    Saved to My List
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
