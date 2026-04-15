'use client';
import { ArrowLeft, MessageCircle, HelpCircle, FileText, Send, Mail } from 'lucide-react';
import { useState } from 'react';
import MobilePageHeader from '@/components/MobilePageHeader';

export default function HelpSupportPage() {
  const [expandedText, setExpanded] = useState<number | null>(null);

  const toggle = (i: number) => {
    if (expandedText === i) setExpanded(null);
    else setExpanded(i);
  };

  const FAQS = [
    { q: "How do I download a movie?", a: "Head to any movie detail page and tap the Download icon. Content will appear in the My Downloads section for offline viewing. Subscriptions must be active." },
    { q: "My video is buffering constantly, why?", a: "UGMOVIES 247 leverages the ultra-fast Cloudflare Dark CDN. Buffering usually indicates a poor connection on your MTN or Airtel line. Try lowering the stream quality in Settings." },
    { q: "Can I request a VJ if my movie isn't there?", a: "Yes. Use the Request target in our navigation menu on the homepage or submit directly through our Telegram community channel." }
  ];

  return (
    <div className="min-h-screen bg-[#0B0C10] flex flex-col font-sans pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pb-14 lg:px-10">
      <MobilePageHeader title="Support Center" fallbackHref="/profile" />

      {/* Main Content */}
      <div className="pt-24 px-4 md:mx-auto md:max-w-2xl md:px-0 md:pt-[138px] w-full">
        
        <div className="flex justify-center mb-8">
           <div className="w-20 h-20 rounded-full bg-[#1F2833]/40 border-2 border-[#D90429]/40 shadow-[0_0_20px_rgba(217,4,41,0.2)] flex items-center justify-center">
              <HelpCircle size={40} className="text-[#D90429]" />
           </div>
        </div>

        <h2 className="text-white font-black text-2xl uppercase tracking-widest text-center mb-2">How can we help?</h2>
        <p className="text-[#888888] text-sm text-center mb-8 px-4 font-medium leading-relaxed">Search through the guides or drop a direct secure message to the admin terminal.</p>

        {/* Direct Connect Buttons */}
        <div className="flex gap-4 mb-6">
           <button onClick={() => window.open('https://wa.me/27836376772', '_blank')} className="flex-1 bg-[#1F2833]/60 hover:bg-[#1F2833] border border-green-500/20 transition-all rounded-xl p-4 flex flex-col items-center justify-center gap-2 group shadow-sm">
             <MessageCircle size={24} className="text-green-500 group-hover:text-white transition-colors" />
             <span className="text-white font-black text-[10px] uppercase tracking-widest text-center">Instant WhatsApp</span>
           </button>
           <button onClick={() => window.open('https://t.me/+8d6j762RBs8zYjY0', '_blank')} className="flex-1 bg-[#1F2833]/60 hover:bg-[#1F2833] border border-blue-500/20 transition-all rounded-xl p-4 flex flex-col items-center justify-center gap-2 group shadow-sm">
             <Send size={24} className="text-blue-500 group-hover:text-white transition-colors" />
             <span className="text-white font-black text-[10px] uppercase tracking-widest text-center">Telegram Support</span>
           </button>
        </div>

        {/* Feedback Section */}
        <button onClick={() => window.location.href='mailto:support@ugmovies247.com?subject=App Feedback'} className="w-full bg-[#1F2833]/40 hover:bg-[#1F2833] border border-[#1F2833] hover:border-[#D90429]/50 transition-all rounded-xl p-4 flex items-center justify-between mb-10 shadow-sm group">
           <div className="flex items-center gap-4">
             <div className="w-10 h-10 bg-black/40 rounded-lg flex items-center justify-center group-hover:bg-[#1F2833] transition-colors">
               <Mail size={20} className="text-yellow-500" />
             </div>
             <div className="text-left">
               <span className="text-white font-black text-sm uppercase tracking-widest block mb-0.5">Send Feedback</span>
               <span className="text-[#888888] text-[10px] font-bold uppercase tracking-wider block">Help us improve the app</span>
             </div>
           </div>
           <ArrowLeft size={16} className="text-[#888888] rotate-180 group-hover:text-[#D90429] transition-colors" />
        </button>

        {/* FAQs */}
        <h3 className="text-white font-black tracking-widest uppercase text-xs border-b border-[#1F2833] pb-3 mb-4 flex items-center gap-2"><FileText size={16} className="text-[#D90429]"/> Frequently Asked Questions</h3>
        
        <div className="space-y-3">
          {FAQS.map((faq, idx) => (
             <div onClick={() => toggle(idx)} key={idx} className="bg-[#1F2833]/40 border border-[#1F2833] rounded-lg p-4 cursor-pointer hover:border-[#D90429]/50 transition-colors shadow-sm">
                <div className="flex justify-between items-center gap-4">
                   <h4 className="text-white font-bold text-xs uppercase tracking-wider">{faq.q}</h4>
                   <span className="text-[#D90429] font-black">{expandedText === idx ? '−' : '+'}</span>
                </div>
                {expandedText === idx && (
                   <p className="mt-3 text-[#888888] text-xs leading-relaxed font-mono">{faq.a}</p>
                )}
             </div>
          ))}
        </div>

      </div>
    </div>
  );
}
