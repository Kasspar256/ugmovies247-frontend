'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import {
  getOptimizedArtworkUrl,
  hasLoadedArtworkUrl,
  markArtworkUrlLoaded,
  type ArtworkVariant,
} from '@/lib/artwork';

type CatalogArtworkImageProps = {
  src?: string | string[];
  alt: string;
  imageClassName: string;
  logoClassName?: string;
  priority?: boolean;
  variant?: ArtworkVariant;
};

function normalizeArtworkCandidates(src: string | string[] | undefined, variant: ArtworkVariant) {
  const candidates = Array.isArray(src) ? src : [src || ''];
  const seen = new Set<string>();

  return candidates
    .map((candidate) => getOptimizedArtworkUrl(candidate, variant))
    .filter((candidate) => {
      if (!candidate || seen.has(candidate)) {
        return false;
      }

      seen.add(candidate);
      return true;
    });
}

const CatalogArtworkImage = memo(function CatalogArtworkImage({
  src,
  alt,
  imageClassName,
  logoClassName = 'h-14 w-14 scale-[1.8] object-contain opacity-70',
  priority = false,
  variant = 'card',
}: CatalogArtworkImageProps) {
  const candidates = useMemo(() => normalizeArtworkCandidates(src, variant), [src, variant]);
  const candidateKey = candidates.join('\n');
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const normalizedSrc = candidates[candidateIndex] || '';

  useEffect(() => {
    const loadedIndex = candidates.findIndex((candidate) => hasLoadedArtworkUrl(candidate));
    setCandidateIndex(loadedIndex >= 0 ? loadedIndex : 0);
    setIsLoaded(loadedIndex >= 0);
    setHasError(false);
    // candidateKey intentionally represents candidate identity while keeping the array local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateKey]);

  useEffect(() => {
    if (hasLoadedArtworkUrl(normalizedSrc)) {
      setIsLoaded(true);
      setHasError(false);
      return;
    }

    setIsLoaded(false);
    setHasError(false);

    if (!normalizedSrc || typeof window === 'undefined') {
      return;
    }

    let active = true;
    const image = new window.Image();
    image.decoding = 'async';
    image.src = normalizedSrc;

    if (image.complete && image.naturalWidth > 0) {
      markArtworkUrlLoaded(normalizedSrc);

      if (active) {
        setIsLoaded(true);
      }

      return () => {
        active = false;
      };
    }

    image.onload = () => {
      markArtworkUrlLoaded(normalizedSrc);

      if (active) {
        setHasError(false);
        setIsLoaded(true);
      }
    };

    image.onerror = () => {
      if (!active) {
        return;
      }

      if (candidateIndex < candidates.length - 1) {
        setCandidateIndex((currentIndex) =>
          currentIndex === candidateIndex
            ? Math.min(currentIndex + 1, candidates.length - 1)
            : currentIndex
        );
        return;
      }

      setHasError(true);
      setIsLoaded(false);
    };

    return () => {
      active = false;
    };
  }, [candidateIndex, candidates.length, normalizedSrc]);

  const showLoadingShimmer = Boolean(normalizedSrc && !isLoaded && !hasError);
  const showPlaceholder = !normalizedSrc || hasError;

  return (
    <div
      className={`absolute inset-0 overflow-hidden ${
        showLoadingShimmer
          ? 'poster-shimmer'
          : 'bg-[radial-gradient(circle_at_center,rgba(34,41,54,0.98)_0%,rgba(20,24,34,0.98)_56%,rgba(11,12,16,1)_100%)]'
      }`}
    >
      {showPlaceholder ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src="/logow.png"
            alt=""
            aria-hidden="true"
            className={logoClassName}
          />
        </div>
      ) : null}

      {normalizedSrc ? (
        <img
          key={normalizedSrc}
          src={normalizedSrc}
          alt={alt}
          className={`${imageClassName} ${isLoaded && !hasError ? 'opacity-100' : 'opacity-0'}`}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onLoad={() => {
            markArtworkUrlLoaded(normalizedSrc);
            setHasError(false);
            setIsLoaded(true);
          }}
          onError={() => {
            if (candidateIndex < candidates.length - 1) {
              setCandidateIndex((currentIndex) =>
                currentIndex === candidateIndex
                  ? Math.min(currentIndex + 1, candidates.length - 1)
                  : currentIndex
              );
              return;
            }

            setHasError(true);
            setIsLoaded(false);
          }}
        />
      ) : null}
    </div>
  );
});

export default CatalogArtworkImage;
