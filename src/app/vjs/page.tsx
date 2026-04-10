'use client';
import Link from 'next/link';
import { VJ_DIRECTORY } from '@/config/constants';
import { Mic2, ChevronRight, Home, Search as SearchIcon } from 'lucide-react';

export default function VJsDirectory() {
  return (
    <div className="min-h-screen bg-[#0B0C10] pb-24 md:pb-12 pt-16 md:pt-24 px-4 md:px-12">
      {/* Desktop Top Nav (Hidden on Mobile) */}
      <header className="hidden md:flex absolute top-0 w-full z-50 justify-between items-center p-6 bg-gradient-to-b from-black/90 to-transparent left-0">
        <div className="flex items-center gap-12">
          <Link href="/" className="text-[#D90429] font-black text-3xl tracking-tighter cursor-pointer">
            UGMOVIES<span className="text-white tracking-widest">24_7</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/" className="text-[#888888] hover:text-[#D90429] transition-colors">Home</Link>
            <Link href="/vjs" className="text-white hover:text-[#D90429] transition-colors">VJ Directory</Link>
            <Link href="/search" className="text-[#888888] hover:text-[#D90429] transition-colors">Search</Link>
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/profile" className="w-10 h-10 rounded-md bg-[#1F2833] overflow-hidden border border-[#1F2833] hover:border-[#D90429] transition-colors cursor-pointer">
            <img src="https://api.dicebear.com/7.x/bottts/svg?seed=Admin&colors=D90429" alt="Profile" className="w-full h-full object-cover" />
          </Link>
        </div>
      </header>

      {/* Mobile Header fixed */}
      <header className="md:hidden fixed top-0 left-0 w-full z-40 bg-[#0B0C10]/95 backdrop-blur-md border-b border-[#1F2833] p-4 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-3">
           <Mic2 className="text-[#D90429]" size={24} />
           <h1 className="text-xl font-bold text-white tracking-wide">VJ Directory</h1>
        </div>
        <Link href="/search" className="text-[#888888] hover:text-white transition-colors">
           <SearchIcon size={24} />
        </Link>
      </header>

      <div className="mt-6 md:mt-10 max-w-7xl mx-auto">
        <p className="text-[#888888] text-sm md:text-lg mb-4 md:mb-8 max-w-2xl px-1">Select a translator to browse their entire fully-dubbed underground collection. High-octane action, strictly in Luganda.</p>
        
        {/* Simple inline search bar for the VJ Directory */}
        <div className="mb-6 md:mb-8 bg-[#1F2833]/80 border border-[#D90429]/30 rounded-full flex items-center px-4 py-1.5 md:p-2 sticky top-[72px] md:top-[80px] z-30 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-xl mx-4 md:mx-0 transition-all focus-within:border-[#D90429] focus-within:ring-2 focus-within:ring-[#D90429]/20">
           <div className="text-[#888888] flex-shrink-0"><SearchIcon size={18} /></div>
           <input 
             type="text" 
             placeholder="Search specific VJ..." 
             className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-white px-3 py-2 text-base md:text-sm placeholder-[#888888]/60 appearance-none"
             onChange={(e) => {
               const val = e.target.value.toLowerCase();
               const cards = document.querySelectorAll('.vj-card');
               cards.forEach((el: any) => {
                  const vjName = el.getAttribute('data-vjname')?.toLowerCase() || "";
                  if (vjName.includes(val)) {
                     el.style.display = 'block';
                  } else {
                     el.style.display = 'none';
                  }
               });
             }}
           />
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6 pb-20">
          {VJ_DIRECTORY.map((vj, idx) => (
            <Link 
              href={`/vjs/${vj.id}`} 
              key={vj.id}
              data-vjname={vj.name}
              className="vj-card group relative h-32 md:h-48 rounded-xl overflow-hidden bg-[#1F2833] border border-[#1F2833]/50 hover:border-[#D90429] transition-all hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(217,4,41,0.2)]"
            >
              {/* Dynamic Abstract Background for VJs */}
              <div 
                className="absolute inset-0 bg-cover bg-center opacity-40 group-hover:opacity-60 transition-opacity"
                style={{ 
                  backgroundImage: `url(https://picsum.photos/seed/${vj.id}/400/400?grayscale&blur=2)`,
                  mixBlendMode: 'luminosity'
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-black/50 to-transparent group-hover:via-[#D90429]/20 transition-colors" />
              
              <div className="absolute inset-0 p-4 md:p-6 flex flex-col justify-between">
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/10 group-hover:border-[#D90429] group-hover:text-[#D90429] transition-all">
                  <Mic2 size={16} className="md:w-5 md:h-5" />
                </div>
                <div>
                  <div className="text-[#D90429] text-[10px] font-bold uppercase tracking-widest mb-1 opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0">Dubbed By</div>
                  <h2 className="text-white font-black text-lg md:text-xl drop-shadow-lg group-hover:text-[#D90429] transition-colors flex items-center justify-between">
                    {vj.name}
                    <ChevronRight size={20} className="text-[#888888] group-hover:text-[#D90429] transition-colors translate-x-0 group-hover:translate-x-2" />
                  </h2>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
      
      {/* Shared Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-[#0B0C10] border-t border-white/5 flex items-center justify-around px-2 z-50 md:hidden pb-safe">
        <Link href="/" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
           <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
           <span className="text-[10px] font-bold">Home</span>
        </Link>
        <Link href="/vjs" className="flex flex-col items-center gap-1 text-[#D90429] w-16 transition-colors">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
           <span className="text-[10px] font-bold">VJs</span>
        </Link>
        <Link href="/genres" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"></path></svg>
           <span className="text-[10px] font-bold">Genres</span>
        </Link>
        <Link href="/search" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
           <span className="text-[10px] font-bold">Search</span>
        </Link>
        <Link href="/profile" className="flex flex-col items-center gap-1 text-gray-500 w-16 hover:text-[#D90429] transition-colors">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
           <span className="text-[10px] font-bold">Profile</span>
        </Link>
      </div>

    </div>
  );
}