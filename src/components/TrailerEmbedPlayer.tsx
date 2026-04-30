'use client';

import { getYouTubeEmbedUrl } from '@/lib/reviewTrailers';

type TrailerEmbedPlayerProps = {
  trailerUrl: string;
  title: string;
  autoplay?: boolean;
  fill?: boolean;
  className?: string;
};

export default function TrailerEmbedPlayer({
  trailerUrl,
  title,
  autoplay = false,
  fill = false,
  className = '',
}: TrailerEmbedPlayerProps) {
  const embedUrl = getYouTubeEmbedUrl(trailerUrl, { autoplay });

  if (!embedUrl) {
    return (
      <div
        className={`${fill ? 'absolute inset-0' : 'w-full'} flex items-center justify-center rounded-[24px] border border-white/10 bg-black px-5 py-12 text-center text-sm font-bold text-white/68 ${className}`}
        style={fill ? undefined : { aspectRatio: '16 / 9' }}
      >
        Trailer is not available right now.
      </div>
    );
  }

  return (
    <div
      className={`${fill ? 'absolute inset-0' : 'relative w-full'} overflow-hidden bg-black ${className}`}
      style={fill ? undefined : { aspectRatio: '16 / 9' }}
    >
      <iframe
        src={embedUrl}
        title={title}
        className="absolute inset-0 h-full w-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
