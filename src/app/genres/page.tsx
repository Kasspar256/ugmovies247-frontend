'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search as SearchIcon } from 'lucide-react';
import { type Movie } from '@/types/movie';
import { fetchPublicMovies, readCachedPublicMovies } from '@/lib/publicMovies';
import MobilePageHeader from '@/components/MobilePageHeader';

const GENRES = [
  "Action", "Adventure", "Animation", "Comedy", "Crime", 
  "Detective", "Drama", "Family", "Fantasy", "History", 
  "Horror", "Indian", "K-Drama", "Love Story", "Mystery", 
  "Romance", "Sci-Fi", "Sport", "Thriller", "War"
];

const getGenreImage = (genreName: string, movies: Movie[]) => {
  const movie = movies.find(m => m.genres?.includes(genreName) || m.country === genreName || (genreName === 'Indian' && m.country === 'India'));
  return movie ? movie.poster : 'https://image.tmdb.org/t/p/w500/1E5baAaEse26fej7uHcjOgEE2t2.jpg';
}

export default function GenresDirectory() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cachedMovies = readCachedPublicMovies();

    if (cachedMovies.length) {
      setMovies(cachedMovies);
      setLoading(false);
    }

    const fetchMovies = async () => {
      try {
        const data = await fetchPublicMovies();
        setMovies(data);
      } catch (err) {
        console.error("Error fetching movies:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMovies();
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
      
      {/* Desktop Header */}
      <header className="hidden md:flex absolute top-0 w-full z-50 justify-between items-center p-6 bg-gradient-to-b from-black/90 to-transparent left-0">
        <div className="flex items-center gap-12">
          <Link href="/" className="flex items-center justify-center p-1 w-64 hover:scale-105 transition-transform z-50">
             <img src="/logo2_perfect.png" alt="UG Movies 247" className="h-16 md:h-20 w-auto object-contain drop-shadow-[0_2px_20px_rgba(217,4,41,0.9)]" />
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/" className="text-[#888888] hover:text-[#D90429] transition-colors">Home</Link>
            <Link href="/vjs" className="text-[#888888] hover:text-[#D90429] transition-colors">VJ Directory</Link>
            <Link href="/genres" className="text-white hover:text-[#D90429] transition-colors">Genres</Link>
            <Link href="/search" className="text-[#888888] hover:text-[#D90429] transition-colors">Search</Link>
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/profile" className="w-10 h-10 rounded-md bg-[#1F2833] overflow-hidden border border-[#D90429] hover:border-white transition-colors cursor-pointer shadow-[0_0_10px_rgba(217,4,41,0.5)]">
            <img src="https://api.dicebear.com/7.x/bottts/svg?seed=AdminBossy&colors=D90429,0B0C10" alt="Profile" className="w-full h-full object-cover scale-110" />
          </Link>
        </div>
      </header>
      
      <MobilePageHeader
        title="Movie Genres"
        subtitle="Browse by category"
        fallbackHref="/"
        actionHref="/search"
        actionIcon={<SearchIcon size={18} />}
        actionAriaLabel="Search movies"
      />

      <div className="mt-4 md:mt-10 max-w-7xl mx-auto">
        <h2 className="hidden md:block text-3xl font-black text-white uppercase tracking-widest mb-2 border-l-4 border-[#D90429] pl-4 drop-shadow-md">Explore Categories</h2>
        <p className="text-[#888888] text-sm md:text-base mb-4 md:mb-8 font-medium md:pl-5">Filter the Dark CDN Vault by precise cinematic categories.</p>

        {/* Simple inline search bar for the Genres page */}
        <div className="mb-6 md:mb-8 bg-[#1F2833]/80 border border-[#D90429]/30 rounded-full flex items-center px-4 py-1.5 md:p-2 sticky top-[72px] md:top-[80px] z-30 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-xl mx-4 md:mx-0 md:ml-4 max-w-lg transition-all focus-within:border-[#D90429] focus-within:ring-2 focus-within:ring-[#D90429]/20">
           <div className="text-[#888888] flex-shrink-0"><SearchIcon size={18} /></div>
           <input 
             type="text" 
             placeholder="Find a specific genre..." 
             className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-white px-3 py-2 text-base md:text-sm placeholder-[#888888]/60 appearance-none"
             onChange={(e) => {
               const val = e.target.value.toLowerCase();
               const cards = document.querySelectorAll('.genre-card');
               cards.forEach((el: any) => {
                  const genreName = el.getAttribute('data-genrename')?.toLowerCase() || "";
                  if (genreName.includes(val)) {
                     el.style.display = 'block';
                  } else {
                     el.style.display = 'none';
                  }
               });
             }}
           />
        </div>
        
        {/* Sleek, Professional Cinematic Grid Design like Disney+ / Apple TV+ */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6 pb-20">
          {GENRES.map((genre) => (
            <Link 
              href={`/genres/${genre.toLowerCase()}`} 
              key={genre}
              data-genrename={genre}
              className="genre-card group relative aspect-video md:aspect-[16/9] rounded-xl overflow-hidden cursor-pointer border border-[#1F2833] hover:border-[#D90429] transition-all duration-300 shadow-xl"
            >
              <img 
                src={getGenreImage(genre, movies)} 
                alt={genre} 
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 opacity-60 group-hover:opacity-80" 
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-black/40 to-transparent group-hover:via-[#D90429]/20 transition-colors" />
              
              {/* Centered Typography for maximum impact */}
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <h2 className="text-white font-black text-xl md:text-2xl uppercase tracking-widest drop-shadow-[0_5px_5px_rgba(0,0,0,1)] group-hover:text-[#D90429] group-hover:scale-105 transition-all text-center">
                  {genre}
                </h2>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
