'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bookmark, Film } from 'lucide-react';
import { getClientDownloadUserId } from '@/lib/downloads';
import { fetchUserWatchlist } from '@/lib/watchlist';
import type { WatchlistRecord } from '@/types/watchlist';

export default function WatchlistPage() {
  const [watchlistMovies, setWatchlistMovies] = useState<WatchlistRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadWatchlist = async () => {
      try {
        const userId = await getClientDownloadUserId();
        const watchlist = await fetchUserWatchlist(userId);
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
    <div className="min-h-screen bg-[#0B0C10] pb-24 md:pb-12 pt-16 md:pt-28 px-4 md:px-12 font-sans">
      <header className="hidden md:flex absolute top-0 w-full z-50 justify-between items-center p-6 bg-gradient-to-b from-black/90 to-transparent left-0">
        <div className="flex items-center gap-12">
          <Link href="/" className="flex items-center justify-center p-1 w-64 hover:scale-105 transition-transform z-50">
            <img
              src="/logo2_perfect.png"
              alt="UG Movies 247"
              className="h-16 md:h-20 w-auto object-contain drop-shadow-[0_2px_20px_rgba(217,4,41,0.9)]"
            />
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/" className="text-[#888888] hover:text-[#D90429] transition-colors">Home</Link>
            <Link href="/downloads" className="text-[#888888] hover:text-[#D90429] transition-colors">Downloads</Link>
            <Link href="/watchlist" className="text-white hover:text-[#D90429] transition-colors">My List</Link>
            <Link href="/search" className="text-[#888888] hover:text-[#D90429] transition-colors">Search</Link>
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/profile" className="w-10 h-10 rounded-md bg-[#1F2833] overflow-hidden border border-[#D90429] hover:border-white transition-colors cursor-pointer shadow-[0_0_10px_rgba(217,4,41,0.5)]">
            <img
              src="https://api.dicebear.com/7.x/bottts/svg?seed=AdminBossy&colors=D90429,0B0C10"
              alt="Profile"
              className="w-full h-full object-cover scale-110"
            />
          </Link>
        </div>
      </header>

      <header className="md:hidden fixed top-0 left-0 w-full z-40 bg-[#0B0C10] border-b border-[#1F2833] shadow-lg">
        <div className="flex items-center gap-3 p-4">
          <Bookmark className="text-[#D90429]" size={24} />
          <h1 className="text-lg font-black text-white uppercase tracking-wider">My List</h1>
        </div>
      </header>

      <div className="mt-4 md:mt-8 max-w-5xl mx-auto">
        <div className="hidden md:flex items-center gap-4 mb-8">
          <Bookmark size={32} className="text-[#D90429]" />
          <h1 className="text-3xl font-black text-white uppercase tracking-wider">Watchlist Vault</h1>
        </div>

        <div className="bg-[#1F2833]/30 border border-[#1F2833] rounded-lg p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film size={20} className="text-[#888888]" />
            <span className="text-[#888888] text-sm font-medium">
              Saved for later viewing
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
