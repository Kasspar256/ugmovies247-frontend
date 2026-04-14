'use client';
import Link from 'next/link';
import { VJ_DIRECTORY } from '@/config/constants';
import { Mic2, ChevronRight, Search as SearchIcon } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';

export default function VJsDirectory() {
  return (
    <div className="min-h-screen bg-[#0B0C10] pb-24 md:px-8 md:pb-14 md:pt-[118px] lg:px-10">

      <MobilePageHeader
        title="VJ Directory"
        subtitle="Browse dubbed collections"
        fallbackHref="/"
        actionHref="/search"
        actionIcon={<SearchIcon size={18} />}
        actionAriaLabel="Search movies"
      />

      <div className="mt-6 md:mt-2 max-w-[1380px] mx-auto">
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
    </div>
  );
}
