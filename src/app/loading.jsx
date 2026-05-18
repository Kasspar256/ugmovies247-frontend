export default function Loading() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#0B0C10] px-6 text-center">
      <div className="flex max-w-sm flex-col items-center">
        <div className="animate-pulse">
          <div className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-b-[#D90429] border-l-transparent border-r-transparent border-t-[#D90429]" />
          <p className="mt-4 text-sm font-medium tracking-widest text-[#888888]">UGMOVIES247</p>
        </div>
      </div>
    </div>
  );
}
