type CatalogGridRouteSkeletonProps = {
  title?: string;
  subtitle?: string;
  cards?: number;
};

export default function CatalogGridRouteSkeleton({
  title = 'Loading',
  subtitle = 'Preparing the catalog',
  cards = 24,
}: CatalogGridRouteSkeletonProps) {
  return (
    <main className="min-h-screen overflow-hidden bg-[#060912] pb-[calc(8rem+env(safe-area-inset-bottom))] text-white md:pb-16">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-16%] top-[-12%] h-[24rem] w-[24rem] rounded-full bg-cyan-400/10 blur-[90px]" />
        <div className="absolute right-[-18%] top-[10%] h-[26rem] w-[26rem] rounded-full bg-indigo-500/10 blur-[100px]" />
      </div>

      <section className="relative z-10 mx-auto max-w-[1380px] px-4 pt-20 md:px-8 md:pt-[118px] lg:px-10">
        <div className="mb-7">
          <div className="h-8 w-44 animate-pulse rounded-full bg-white/[0.08] md:h-11 md:w-64" />
          <div className="mt-4 h-3 w-56 animate-pulse rounded-full bg-white/[0.06]" />
          <span className="sr-only">
            {title}. {subtitle}.
          </span>
        </div>

        <div className="mb-6 flex gap-3">
          <div className="h-11 w-28 animate-pulse rounded-full bg-white/[0.08]" />
          <div className="h-11 w-32 animate-pulse rounded-full bg-white/[0.08]" />
        </div>

        <div className="grid grid-cols-3 gap-x-6 gap-y-6 sm:grid-cols-4 md:grid-cols-5 md:gap-x-7 md:gap-y-8 2xl:grid-cols-6">
          {Array.from({ length: cards }).map((_, index) => (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              className="min-w-0"
            >
              <div className="poster-shimmer aspect-[2/3] rounded-[14px] border border-white/8 bg-white/[0.04] md:rounded-[17px]" />
              <div className="mt-3 h-3 w-4/5 animate-pulse rounded-full bg-white/[0.08]" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
