'use client';

import Link from 'next/link';
import { Send, Clapperboard, Mic2, AlertCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { VJ_DIRECTORY } from '@/config/constants';
import MobilePageHeader from '@/components/MobilePageHeader';

export default function RequestPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [formData, setFormData] = useState({ title: '', vj: '', notes: '' });

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formData.title) return;
    
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: formData.title,
          preferredVj: formData.vj,
          notes: formData.notes,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to submit movie request.');
      }

      setIsSubmitting(false);
      setShowToast(true);
      setFormData({ title: '', vj: '', notes: '' });
      setTimeout(() => setShowToast(false), 3000);
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to submit movie request.');
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pb-14 lg:px-10 font-sans">

      {/* Floating Action Toast */}
      {showToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] bg-green-600 text-white px-6 py-3 rounded-full font-black uppercase tracking-widest text-[10px] md:text-sm shadow-[0_0_20px_rgba(34,197,94,0.5)] animate-pulse whitespace-nowrap">
          Movie Request Sent!
        </div>
      )}

      <MobilePageHeader title="Request a Movie" fallbackHref="/browse" />

      {/* Main Content */}
      <div className="px-4 pt-24 md:mx-auto md:max-w-3xl md:px-0 md:pt-[138px]">
        
        <div className="text-center mb-8">
          <div className="w-16 h-16 md:w-20 md:h-20 bg-[#1F2833]/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#D90429]/30 shadow-[0_0_15px_rgba(217,4,41,0.2)]">
            <Clapperboard className="text-[#D90429]" size={32} />
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-3">Request A Movie</h1>
          <p className="text-[#888888] text-sm md:text-base leading-relaxed px-4">
            If the movie you want is not currently available, enter the title and your preferred VJ below. Our team will review the request and consider it for upload.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#1F2833]/20 p-6 md:p-8 rounded-xl border border-white/5 shadow-xl space-y-5">
          {errorMessage && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {errorMessage}
            </div>
          )}
          
          {/* Movie Title */}
          <div>
            <label className="block text-[#888888] text-xs font-bold uppercase tracking-widest mb-2">Movie Title / Year *</label>
            <div className="relative">
              <input 
                type="text" 
                required
                value={formData.title}
                onChange={(e) => setFormData({...formData, title: e.target.value})}
                placeholder="e.g. Spider-Man: Brand New Day (2026)" 
                className="w-full bg-[#1F2833]/80 text-white rounded-lg p-4 focus:outline-none focus:ring-1 focus:ring-[#D90429] placeholder-[#888888]/50 border border-white/5 focus:border-[#D90429] transition-all"
              />
            </div>
          </div>

          {/* Preferred VJ Dropdown */}
          <div>
            <label className="block text-[#888888] text-xs font-bold uppercase tracking-widest mb-2">Preferred VJ</label>
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
            <label className="block text-[#888888] text-xs font-bold uppercase tracking-widest mb-2">Additional Information</label>
            <textarea 
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              placeholder="You may include the lead actor, alternate title, release year, or any other helpful details." 
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
          <p className="text-[#888888] text-xs leading-relaxed">
            All requests are sent directly to the UGMOVIES 24_7 admin console. Frequently requested titles are reviewed, prepared, and added as quickly as possible, typically within 48 hours.
          </p>
        </div>

      </div>
    </div>
  );
}
