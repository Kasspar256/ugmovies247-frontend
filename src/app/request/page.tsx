'use client';

import { Send, Clapperboard, Mic2, CheckCircle2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { VJ_DIRECTORY } from '@/config/constants';
import MobilePageHeader from '@/components/MobilePageHeader';

export default function RequestPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestSucceeded, setRequestSucceeded] = useState(false);
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
      setRequestSucceeded(true);
      setFormData({ title: '', vj: '', notes: '' });
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to submit movie request.');
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pb-14 lg:px-10 font-sans">

      <MobilePageHeader title="Request a Movie" fallbackHref="/browse" />

      {/* Main Content */}
      <div className="px-4 pt-24 md:mx-auto md:max-w-3xl md:px-0 md:pt-[138px]">
        
        <div className="text-center mb-8">
          <div className="w-16 h-16 md:w-20 md:h-20 bg-[#1F2833]/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#D90429]/30 shadow-[0_0_15px_rgba(217,4,41,0.2)]">
            <Clapperboard className="text-[#D90429]" size={32} />
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-3">Request A Movie</h1>
          <div className="mx-auto mt-5 max-w-2xl rounded-[22px] border border-white/10 bg-amber-500/[0.05] px-5 py-4 text-left shadow-[0_18px_42px_rgba(0,0,0,0.22)] backdrop-blur-md">
            <p className="text-sm leading-7 text-amber-50/88 md:text-base">
              Your request goes straight to our Priority Desk. ⚡ Our team works around the clock to have your favorite movies live within just 2 hours.
            </p>
          </div>
        </div>

        {requestSucceeded ? (
          <section className="rounded-[28px] border border-emerald-300/15 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(14,165,233,0.08),rgba(31,40,51,0.22))] p-7 text-center shadow-[0_22px_55px_rgba(0,0,0,0.28)] backdrop-blur-md md:p-9">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-200/20 bg-emerald-400/12 text-emerald-200 shadow-[0_0_34px_rgba(16,185,129,0.2)]">
              <CheckCircle2 size={34} strokeWidth={2.2} />
            </div>
            <h2 className="mt-5 text-2xl font-black uppercase tracking-[0.16em] text-white md:text-3xl">
              Request Received! 🚀
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-8 text-white/72 md:text-lg">
              We're on it. Your movie will be uploaded within 2 hours, and you'll receive a confirmation as soon as it's ready for you to watch!
            </p>
          </section>
        ) : (
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
        )}

      </div>
    </div>
  );
}
