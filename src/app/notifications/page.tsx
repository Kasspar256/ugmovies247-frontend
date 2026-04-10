import Link from 'next/link';
import { ArrowLeft, Bell, Play } from 'lucide-react';

export default function NotificationsPage() {
  return (
    <div className="min-h-screen bg-[#0B0C10] pb-24 pt-24 px-4 font-sans">
      <header className="fixed top-0 left-0 w-full z-40 bg-[#0B0C10]/95 backdrop-blur-md border-b border-[#1F2833] flex justify-between items-center gap-4 p-4 shadow-xl md:p-6 md:px-12">
        <div className="flex items-center gap-4">
          <Link href="/profile" className="text-white hover:text-[#D90429] transition-colors bg-[#1F2833] p-1.5 rounded-full flex items-center justify-center">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-lg md:text-xl font-black text-white uppercase tracking-wider drop-shadow-md">Notifications</h1>
        </div>
      </header>

      <div className="mt-2 max-w-lg mx-auto w-full">
        {/* Toggle Controls (UI Only) */}
        <div className="flex items-center justify-between bg-[#1F2833]/40 p-4 rounded-xl border border-white/5 mb-6 shadow-lg">
           <span className="text-sm font-bold text-white tracking-widest uppercase">Push Alerts</span>
           <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" defaultChecked />
              <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#D90429]"></div>
           </label>
        </div>

        {/* Existing Static notifications */}
        <div className="bg-[#1F2833]/30 border-l-4 border-[#D90429]/50 p-4 rounded-r-xl mb-4 hover:bg-[#1F2833]/60 transition-colors cursor-pointer group shadow-md backdrop-blur">
          <div className="flex gap-4 items-start">
             <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center flex-shrink-0 group-hover:shadow-[0_0_15px_rgba(217,4,41,0.4)] transition-shadow border border-[#D90429]/30 mt-1">
               <Bell className="text-[#D90429] animate-pulse" size={20} />
             </div>
             <div>
               <h3 className="text-white font-bold text-sm mb-1 uppercase tracking-wider">New Release Uploaded</h3>
               <p className="text-[#888888] text-xs leading-relaxed">VJ Junior just dropped a new encrypted file in the Dark CDN. Watch now.</p>
               <span className="text-[#D90429] text-[10px] mt-2 block font-black uppercase tracking-widest bg-[#D90429]/10 w-max px-2 py-0.5 rounded border border-[#D90429]/20">2 hours ago</span>
             </div>
          </div>
        </div>

        <div className="bg-[#1F2833]/20 p-4 rounded-xl mb-4 hover:bg-[#1F2833]/60 transition-colors cursor-pointer border border-white/5 group shadow-sm backdrop-blur">
          <div className="flex gap-4 items-start">
             <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center flex-shrink-0 mt-1 border border-white/5">
               <Play className="text-[#888888] group-hover:text-[#D90429] transition-colors" size={20} />
             </div>
             <div>
               <h3 className="text-white font-bold text-sm mb-1 uppercase tracking-wider">Resume Playing</h3>
               <p className="text-[#888888] text-xs leading-relaxed">You left Extraction 2 at 1h 12m. Resume streaming from the vault.</p>
               <span className="text-[#888888] text-[10px] mt-2 block font-black uppercase tracking-widest bg-black/40 w-max px-2 py-0.5 rounded border border-white/5">Yesterday</span>
             </div>
          </div>
        </div>

      </div>
    </div>
  );
}