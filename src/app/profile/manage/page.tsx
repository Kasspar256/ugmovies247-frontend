'use client';
import { Bell, Smartphone, MonitorPlay, Save } from 'lucide-react';
import { useState } from 'react';
import MobilePageHeader from '@/components/MobilePageHeader';

export default function SubSettingsPage() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSave = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] flex flex-col font-sans pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pb-14 lg:px-10">
      <MobilePageHeader title="App Settings" fallbackHref="/profile" />

      {/* Main Container */}
      <div className="pt-24 px-4 max-w-2xl mx-auto w-full md:px-0 md:pt-[138px]">
        
        <p className="text-[#888888] text-sm font-medium mb-6 px-1">Customize your Dark CDN streaming experience and network preferences.</p>

        <div className="bg-[#1F2833]/40 border border-[#1F2833] rounded-xl p-4 mb-6 shadow-lg">
          <h3 className="text-white font-black tracking-widest uppercase text-xs border-b border-[#1F2833] pb-3 mb-4 flex items-center gap-2"><MonitorPlay size={16} className="text-[#D90429]"/> Media Playback</h3>
          
          <div className="flex items-center justify-between mb-5">
            <div>
              <span className="text-white font-bold text-sm block mb-1 hover:text-[#D90429] transition-colors cursor-pointer">Auto-Play Next Episode</span>
              <span className="text-[#888888] text-xs font-medium">Seamlessly transition to the next part in a series.</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" defaultChecked />
              <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#D90429]"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-white font-bold text-sm block mb-1">Default Video Quality</span>
              <span className="text-[#888888] text-xs font-medium">Auto-adjusts based on your connection speed.</span>
            </div>
            <select className="bg-[#0B0C10] text-[#D90429] font-black text-xs uppercase px-3 py-2 rounded border border-[#1F2833] focus:outline-none focus:border-[#D90429]">
               <option>Auto (Recommended)</option>
               <option>1080p HD</option>
               <option>720p Std</option>
               <option>Data Saver</option>
            </select>
          </div>
        </div>

        <div className="bg-[#1F2833]/40 border border-[#1F2833] rounded-xl p-4 mb-6 shadow-lg">
          <h3 className="text-white font-black tracking-widest uppercase text-xs border-b border-[#1F2833] pb-3 mb-4 flex items-center gap-2"><Smartphone size={16} className="text-[#D90429]"/> Downloads & Storage</h3>
          
          <div className="flex items-center justify-between mb-5">
            <div>
              <span className="text-white font-bold text-sm block mb-1">Wi-Fi Only Downloads</span>
              <span className="text-[#888888] text-xs font-medium">Prevent cellular data drain during background sync.</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" defaultChecked />
              <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-white font-bold">Storage Usage</span>
              <span className="text-[#888888] font-mono">1.2 GB / 64 GB</span>
            </div>
            <div className="w-full bg-[#0B0C10] rounded-full h-2 overflow-hidden border border-[#1F2833]">
               <div className="bg-[#D90429] h-full" style={{ width: '15%' }}></div>
            </div>
            <button className="text-[#D90429] border border-[#D90429]/30 hover:bg-[#D90429]/10 transition-colors font-bold uppercase text-[10px] w-max px-4 py-1.5 rounded mt-2">Clear Cache</button>
          </div>
        </div>

        <div className="bg-[#1F2833]/40 border border-[#1F2833] rounded-xl p-4 shadow-lg mb-8">
          <h3 className="text-white font-black tracking-widest uppercase text-xs border-b border-[#1F2833] pb-3 mb-4 flex items-center gap-2"><Bell size={16} className="text-[#D90429]"/> Push Notifications</h3>
          
          <div className="flex items-center justify-between mb-4">
            <span className="text-white font-bold text-sm block">New VJ Movie Releases</span>
            <input type="checkbox" className="accent-[#D90429] w-5 h-5 bg-[#0B0C10] border-[#1F2833] rounded cursor-pointer" defaultChecked />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-white font-bold text-sm block">Requested Content Updates</span>
            <input type="checkbox" className="accent-[#D90429] w-5 h-5 bg-[#0B0C10] border-[#1F2833] rounded cursor-pointer" defaultChecked />
          </div>
        </div>

        <button 
          onClick={handleSave} 
          disabled={loading}
          className={`w-full bg-[#D90429] hover:bg-[#B00320] text-white font-black uppercase tracking-widest py-4 rounded-xl shadow-[0_0_20px_rgba(217,4,41,0.4)] transition-all flex items-center justify-center gap-2 ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          {loading ? (
             <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <><Save size={20} /> Save Configuration</>
          )}
        </button>

        {success && (
          <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 text-green-500 font-bold text-xs text-center rounded-lg uppercase tracking-wider animate-pulse transition-opacity duration-300">
             Settings Sync Successful
          </div>
        )}

      </div>
    </div>
  );
}
