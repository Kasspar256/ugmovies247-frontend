'use client';
import { User, Phone, CheckCircle, Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';
import MobilePageHeader from '@/components/MobilePageHeader';

export default function EditProfilePage() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  
  const handleUpdate = (e: any) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] flex flex-col font-sans pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pb-14 lg:px-10">
      <MobilePageHeader title="Edit Profile" fallbackHref="/profile" />

      {/* Main Content */}
      <div className="pt-24 px-4 md:mx-auto md:max-w-2xl md:px-0 md:pt-[138px] w-full">
        
        {/* Avatar Container */}
        <div className="flex flex-col items-center mb-8 relative">
           <div className="w-28 h-28 rounded-full bg-[#1F2833] overflow-hidden border-2 border-[#D90429] mb-4 relative shadow-[0_0_20px_rgba(217,4,41,0.5)] group">
             <img src="https://api.dicebear.com/7.x/bottts/svg?seed=AdminBossy&colors=D90429,0B0C10" alt="Avatar" className="w-full h-full object-cover scale-110" />
             <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer backdrop-blur-sm">
                <ImageIcon className="text-white" size={24} />
             </div>
           </div>
           <button className="text-[#D90429] hover:bg-[#D90429]/10 transition-colors bg-[#1F2833] border border-[#D90429]/30 rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-widest flex items-center gap-2 shadow-sm">
             Change Image
           </button>
        </div>

        <form onSubmit={handleUpdate} className="space-y-5">
           <div>
              <label className="text-[#888888] text-xs font-bold uppercase tracking-widest block mb-2 px-1">Display Name</label>
              <div className="relative">
                <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#888888]" />
                <input 
                  type="text" 
                  defaultValue="Mr President" 
                  className="w-full bg-[#1F2833]/80 border border-[#1F2833] focus:border-[#D90429] focus:ring-1 focus:ring-[#D90429] rounded-lg py-3 pl-12 pr-4 text-white font-medium transition-all shadow-inner appearance-none" 
                  required
                />
              </div>
           </div>

           <div>
              <label className="text-[#888888] text-xs font-bold uppercase tracking-widest block mb-2 px-1">Mobile Contact</label>
              <div className="relative">
                <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#888888]" />
                <input 
                  type="tel" 
                  defaultValue="077XXXXX89" 
                  className="w-full bg-[#1F2833]/80 border border-[#1F2833] focus:border-[#D90429] focus:ring-1 focus:ring-[#D90429] rounded-lg py-3 pl-12 pr-4 text-white font-medium transition-all shadow-inner appearance-none"
                />
              </div>
           </div>

           <button 
             type="submit" 
             disabled={loading}
             className={`w-full !mt-8 bg-gradient-to-r from-[#D90429] to-[#800A15] p-4 rounded-xl text-white font-black uppercase tracking-widest shadow-[0_10px_20px_rgba(217,4,41,0.3)] hover:-translate-y-0.5 hover:shadow-[0_15px_30px_rgba(217,4,41,0.5)] transition-all flex justify-center items-center gap-3 ${loading ? 'opacity-80 scale-[0.98]' : ''}`}
           >
             {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <><CheckCircle size={20}/> Update Profile</>}
           </button>
           
           {success && (
             <p className="text-green-500 text-xs font-bold uppercase tracking-widest text-center mt-4 bg-green-500/10 py-2 border border-green-500/20 rounded-lg animate-pulse">
                Info Updated Successfully
             </p>
           )}
        </form>

      </div>
    </div>
  );
}
