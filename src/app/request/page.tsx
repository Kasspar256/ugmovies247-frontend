'use client';

import Link from 'next/link';
import { ArrowLeft, Send, Clapperboard, Mic2, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { VJ_DIRECTORY } from '@/config/constants';

export default function RequestPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [formData, setFormData] = useState({ title: '', vj: '', notes: '' });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.title) return;
    
    setIsSubmitting(true);
    // Simulate API call to the Dark CDN backend
    setTimeout(() => {
      setIsSubmitting(false);
      setShowToast(true);
      setFormData({ title: '', vj: '', notes: '' });
      setTimeout(() => setShowToast(false), 3000);
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-24 font-sans">
      
      {/* Desktop Header */}
      <header className="hidden md:flex fixed top-0 w-full z-50 justify-between items-center p-6 bg-gradient-to-b from-black/90 to-transparent left-0">
        <div className="flex items-center gap-12">
          <Link href="/" className="flex items-center justify-center p-1 w-64 hover:scale-105 transition-transform z-50">
             <img src="/logo2_perfect.png" alt="UG Movies 247" className="h-16 md:h-20 w-auto object-contain drop-shadow-[0_2px_20px_rgba(217,4,41,0.9)]" />
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/" className="text-[#888888] hover:text-[#D90429] transition-colors">Home</Link>
            <Link href="/vjs" className="text-[#888888] hover:text-[#D90429] transition-colors">VJ Directory</Link>
            <Link href="/genres" className="text-[#888888] hover:text-[#D90429] transition-colors">Genres</Link>
            <Link href="/search" className="text-[#888888] hover:text-[#D90429] transition-colors">Search</Link>
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/profile" className="w-10 h-10 rounded-md bg-[#1F2833] overflow-hidden border border-[#D90429] hover:border-white transition-colors cursor-pointer shadow-[0_0_10px_rgba(217,4,41,0.5)]">
            <img src="https://api.dicebear.com/7.x/bottts/svg?seed=AdminBossy&colors=D90429,0B0C10" alt="Profile" className="w-full h-full object-cover scale-110" />
          </Link>
        </div>
      </header>

      {/* Floating Action Toast */}
      {showToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] bg-green-600 text-white px-6 py-3 rounded-full font-black uppercase tracking-widest text-[10px] md:text-sm shadow-[0_0_20px_rgba(34,197,94,0.5)] animate-pulse whitespace-nowrap">
          Movie Request Sent!
        </div>
      )}

      {/* Mobile Top App Bar */}
      <header className="fixed top-0 left-0 w-full z-40 bg-[#0B0C10]/95 backdrop-blur-md border-b border-[#1F2833] flex items-center p-4 shadow-xl md:hidden">
        <Link href="/profile" className="text-white hover:text-[#D90429] transition-colors absolute left-4 bg-[#1F2833] p-1.5 rounded-full flex items-center justify-center">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-black text-white tracking-widest uppercase w-full text-center">Request Movie</h1>
      </header>

      {/* Main Content */}
      <div className="pt-24 md:pt-32 px-4 max-w-2xl mx-auto">
        
        <div className="text-center mb-8">
          <div className="w-16 h-16 md:w-20 md:h-20 bg-[#1F2833]/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#D90429]/30 shadow-[0_0_15px_rgba(217,4,41,0.2)]">
            <Clapperboard className="text-[#D90429]" size={32} />
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-3">Target A Movie</h1>
          <p className="text-[#888888] text-sm md:text-base leading-relaxed px-4">
            Can't find the movie you want to watch? Enter the title and your favorite VJ below, and we will upload it for you.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#1F2833]/20 p-6 md:p-8 rounded-xl border border-white/5 shadow-xl space-y-5">
          
          {/* Movie Title */}
          <div>
            <label className="block text-[#888888] text-xs font-bold uppercase tracking-widest mb-2">Movie Title / Year *</label>
            <div className="relative">
              <input 
                type="text" 
                required
                value={formData.title}
                onChange={(e) => setFormData({...formData, title: e.target.value})}
                placeholder="e.g. Fast X (2023)" 
                className="w-full bg-[#1F2833]/80 text-white rounded-lg p-4 focus:outline-none focus:ring-1 focus:ring-[#D90429] placeholder-[#888888]/50 border border-white/5 focus:border-[#D90429] transition-all"
              />
            </div>
          </div>

          {/* Preferred VJ Dropdown */}
          <div>
            <label className="block text-[#888888] text-xs font-bold uppercase tracking-widest mb-2">Preferred Translator</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Mic2 className="text-[#888888]/50" size={18} />
              </div>
              <select 
                value={formData.vj}
                onChange={(e) => setFormData({...formData, vj: e.target.value})}
                className="w-full bg-[#1F2833]/80 text-white rounded-lg p-4 pl-11 appearance-none focus:outline-none focus:ring-1 focus:ring-[#D90429] border border-white/5 focus:border-[#D90429] transition-all"
              >
                <option value="" className="text-[#888888]">Any Available VJ</option>
                {VJ_DIRECTORY.map(vj => (
                  <option key={vj.id} value={vj.name}>{vj.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Additional Notes */}
          <div>
            <label className="block text-[#888888] text-xs font-bold uppercase tracking-widest mb-2">Additional Info</label>
            <textarea 
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              placeholder="Any specific action scene, actor, or alternate title? Let us know." 
              className="w-full bg-[#1F2833]/80 text-white rounded-lg p-4 focus:outline-none focus:ring-1 focus:ring-[#D90429] placeholder-[#888888]/50 border border-white/5 focus:border-[#D90429] transition-all resize-none"
            ></textarea>
          </div>

          <button 
            type="submit" 
            disabled={isSubmitting}
            className={`w-full bg-[#D90429] text-white font-black text-lg p-4 rounded-lg hover:bg-[#B00320] transition-all shadow-[0_0_20px_rgba(217,4,41,0.4)] tracking-widest uppercase mt-4 flex items-center justify-center gap-3 ${isSubmitting ? 'opacity-80 cursor-not-allowed' : ''}`}
          >
            {isSubmitting ? (
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <><Send size={20} /> Submit Request</>
            )}
          </button>

        </form>

        <div className="mt-8 flex items-start gap-4 p-4 bg-[#D90429]/10 border border-[#D90429]/20 rounded-lg">
          <AlertCircle className="text-[#D90429] flex-shrink-0 mt-0.5" size={20} />
          <p className="text-[#888888] text-xs leading-relaxed font-mono">
            All requests are pushed directly to the UGMOVIES 24_7 admin console. Highest requested movies are processed, dubbed, and vaulted within 48 hours.
          </p>
        </div>

      </div>
    </div>
  );
}
