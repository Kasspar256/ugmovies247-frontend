import Link from 'next/link';

export default function Loading() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#0B0C10]">
      <div className="animate-pulse flex flex-col items-center">
        <div className="w-16 h-16 border-4 border-t-[#D90429] border-r-transparent border-b-[#D90429] border-l-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-[#888888] font-medium tracking-widest text-sm">UGMOVIES</p>
      </div>
    </div>
  );
}