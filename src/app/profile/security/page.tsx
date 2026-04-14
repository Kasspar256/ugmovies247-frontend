'use client';
import { Shield, Lock, Smartphone, Database } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-[#0B0C10] flex flex-col font-sans pb-24 md:px-8 md:pb-14 lg:px-10">
      <MobilePageHeader title="Security" fallbackHref="/profile" />

      {/* Main Content */}
      <div className="pt-24 px-4 max-w-lg mx-auto w-full md:px-0 md:pt-[138px]">
        
        <div className="flex items-center gap-4 bg-[#1F2833]/40 border border-[#D90429]/30 rounded-xl p-4 mb-8 shadow-lg shadow-[#D90429]/10">
           <Shield size={32} className="text-[#D90429]" />
           <div>
              <p className="text-white font-black text-sm uppercase tracking-widest">Account Status</p>
              <p className="text-green-500 font-bold uppercase text-[10px] tracking-widest flex items-center gap-1.5 mt-1"><span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span> Encrypted & Active</p>
           </div>
        </div>

        <div className="space-y-4">
           {/* Password Change */}
           <div className="bg-[#1F2833]/40 border border-[#1F2833] rounded-xl p-4 shadow-sm group">
              <div className="flex items-center gap-4 mb-4 border-b border-[#1F2833] pb-3">
                 <Lock size={18} className="text-[#888888] group-hover:text-white transition-colors" />
                 <span className="text-white font-black text-sm uppercase tracking-widest">Change Vault Password</span>
              </div>
              <div className="space-y-3">
                 <input type="password" placeholder="Current Password" className="w-full bg-[#0B0C10] border border-[#1F2833] focus:border-[#D90429] focus:ring-1 focus:ring-[#D90429] rounded p-3 text-white text-sm" />
                 <input type="password" placeholder="New Password" className="w-full bg-[#0B0C10] border border-[#1F2833] focus:border-[#D90429] focus:ring-1 focus:ring-[#D90429] rounded p-3 text-white text-sm" />
                 <button className="bg-[#D90429] text-white font-black uppercase text-[10px] tracking-widest px-4 py-2.5 rounded shadow-md mt-2 w-max transition-all hover:bg-[#B00320]">Verify & Save</button>
              </div>
           </div>

           {/* Mobile Sessions */}
           <div className="bg-[#1F2833]/40 border border-[#1F2833] rounded-xl p-4 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-4">
                 <Smartphone size={18} className="text-[#888888]" />
                 <div>
                    <span className="text-white font-black text-sm block tracking-widest uppercase">Active Sessions</span>
                    <span className="text-green-500 text-[10px] font-mono tracking-widest">1 Device Connect</span>
                 </div>
              </div>
              <button className="text-[#D90429] font-black uppercase text-[10px] tracking-widest border border-[#D90429]/30 bg-[#D90429]/10 px-3 py-1.5 rounded transition-all hover:bg-[#D90429] hover:text-white">Revoke</button>
           </div>
           
           {/* Privacy Toggle */}
           <div className="bg-[#1F2833]/40 border border-[#1F2833] rounded-xl p-4 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-4">
                 <Database size={18} className="text-[#888888]" />
                 <div>
                    <span className="text-white font-black text-sm block tracking-widest uppercase">Data Telemetry</span>
                    <span className="text-[#888888] text-[10px] font-mono tracking-widest uppercase">Share bug reports</span>
                 </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" />
                <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#D90429]"></div>
              </label>
           </div>
        </div>

      </div>
    </div>
  );
}
