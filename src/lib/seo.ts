import type { Metadata } from 'next';
import { VJ_DIRECTORY } from '@/config/constants';
import { isAppInReview } from '@/lib/appReview';
import type { Movie } from '@/types/movie';

export const SITE_URL = (
  process.env.APP_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://ugmovies247.com'
).replace(/\/$/, '');

export const SITE_NAME = 'UG Movies 247';
export const SITE_TITLE = isAppInReview
  ? 'UG Movies 247 - Movie Trailers, VJs & Discovery Catalog'
  : 'UG Movies 247 - Watch Ugandan, Luganda & Translated Movies Online';
export const SITE_DESCRIPTION =
  isAppInReview
    ? 'Discover movie trailers, VJ catalog information, genres, and saved title lists on UG Movies 247.'
    : 'Watch Ugandan movies, Luganda translated movies, Uganda translated films, VJ movies, series, and trending entertainment online on UG Movies 247.';
const REVIEW_SITE_KEYWORDS = [
  'ugmovies247',
  'UG Movies 247',
  'movie trailers Uganda',
  'Uganda movie trailers',
  'Luganda translated movie trailers',
  'VJ movie trailers',
  'movie discovery Uganda',
  'UG Movies 247 trailers',
  ...VJ_DIRECTORY.map((vj) => `${vj.name} trailers`),
];
const FULL_SITE_KEYWORDS = [
  'ugmovies247',
  'UG Movies 247',
  'ug movies',
  'ug movies online',
  'ugandan movies online',
  'watch ugandan movies',
  'watch ugandan movies online',
  'uganda movies online',
  'uganda movie streaming',
  'uganda films online',
  'uganda series online',
  'uganda entertainment platform',
  'ug movies streaming',
  'ug movies download',
  'best movie app in uganda',
  'uganda netflix alternative',
  'free movie apps in uganda',
  'luganda translated movies',
  'uganda translated movies',
  'translated movies in luganda',
  'watch luganda translated movies online',
  'watch uganda translated movies online',
  'luganda movies online',
  'luganda movies streaming',
  'luganda translated action movies',
  'luganda translated series',
  'luganda translated hollywood movies',
  'uganda translated action movies',
  'uganda translated hollywood movies',
  'latest translated movies in uganda',
  'latest luganda translated movies',
  'VJ translated movies',
  'VJ movies Uganda',
  'translated movies by Ugandan VJs',
  'watch ugandan movies online free',
  'best ugandan movie streaming site',
  'uganda movies 2025 latest',
  'uganda movies 2026 latest',
  'download ugandan movies HD',
  'uganda series full episodes online',
  'uganda comedy movies online',
  'uganda action movies streaming',
  'uganda love movies online',
  'uganda TV shows online streaming',
  'where to watch ugandan movies',
  'uganda movies website',
  'latest movies 2025 uganda',
  'latest movies 2026 uganda',
  'trending ugandan movies',
  'trending ugandan series',
  'top ugandan films',
  'east africa movies online',
  'african movies uganda',
  'kampala movie streaming',
  ...VJ_DIRECTORY.map((vj) => `${vj.name} movies`),
  'VJ translated movies Uganda',
  'Luganda VJ movies',
  'Ugandan VJ movies online',
];
export const SITE_KEYWORDS = isAppInReview ? REVIEW_SITE_KEYWORDS : FULL_SITE_KEYWORDS;

export const SITE_ICON = '/siteicon.png';
export const SITE_OG_IMAGE = '/siteicon.png';

export function absoluteUrl(path = '/') {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function canonicalUrl(path = '/') {
  return absoluteUrl(path);
}

export function cleanText(value?: string, fallback = '') {
  return String(value || fallback)
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncateMeta(value: string, maxLength = 155) {
  const clean = cleanText(value);

  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, maxLength - 3).trim()}...`;
}

export function getMovieTitle(movie: Pick<Movie, 'title' | 'original_title' | 'name'>) {
  return cleanText(movie.title || movie.name || movie.original_title || 'Movie');
}

export function getMovieVjLabel(movie: Pick<Movie, 'vj'>) {
  const vj = cleanText(movie.vj || '');

  if (!vj || vj.toLowerCase() === 'unknown') {
    return '';
  }

  return vj.toUpperCase().startsWith('VJ ') ? vj : `VJ ${vj}`;
}

export function getMovieDescription(movie: Partial<Movie>) {
  const title = getMovieTitle(movie as Movie);
  const vjLabel = getMovieVjLabel(movie);
  const releaseYear = movie.releaseYear || (movie.release_date ? new Date(movie.release_date).getFullYear() : '');
  const typeLabel = movie.contentType === 'series' ? 'series' : 'movie';
  const baseDescription = cleanText(movie.description || movie.overview || '');
  const genreText = (movie.genres || []).slice(0, 3).join(', ');
  const keywordLine = [
    isAppInReview ? `Watch the ${title} trailer` : `Watch ${title}`,
    vjLabel ? `${vjLabel} translated ${typeLabel}` : `Uganda translated ${typeLabel}`,
    releaseYear ? `${releaseYear}` : '',
    genreText ? `in ${genreText}` : '',
    `on ${SITE_NAME}`,
  ]
    .filter(Boolean)
    .join(' ');

  return truncateMeta(baseDescription ? `${keywordLine}. ${baseDescription}` : keywordLine, 180);
}

export function buildPageMetadata(options: {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  type?: 'website' | 'article';
  keywords?: string[];
  noIndex?: boolean;
}): Metadata {
  const title = options.title || SITE_TITLE;
  const description = options.description || SITE_DESCRIPTION;
  const path = options.path || '/';
  const image = absoluteUrl(options.image || SITE_OG_IMAGE);
  const url = absoluteUrl(path);

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    keywords: [...SITE_KEYWORDS, ...(options.keywords || [])],
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      images: [
        {
          url: image,
          width: 512,
          height: 512,
          alt: isAppInReview ? `${SITE_NAME} trailer catalog` : `${SITE_NAME} streaming platform`,
        },
      ],
      locale: 'en_UG',
      type: options.type || 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
    robots: options.noIndex
      ? {
          index: false,
          follow: false,
        }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            'max-image-preview': 'large',
            'max-snippet': -1,
            'max-video-preview': -1,
          },
        },
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl(SITE_ICON),
    email: 'info@ugmovies247.com',
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: '+256727261375',
      contactType: 'customer support',
      areaServed: ['UG', 'EA'],
      availableLanguage: ['English', 'Luganda'],
    },
  };
}

export function movieJsonLd(movie: Movie, path: string) {
  const title = getMovieTitle(movie);
  const vjLabel = getMovieVjLabel(movie);

  return {
    '@context': 'https://schema.org',
    '@type': movie.contentType === 'series' ? 'TVSeries' : 'Movie',
    name: title,
    description: getMovieDescription(movie),
    image: movie.poster ? absoluteUrl(movie.poster) : absoluteUrl(SITE_OG_IMAGE),
    url: absoluteUrl(path),
    genre: movie.genres || [],
    datePublished: movie.release_date || movie.date_added || undefined,
    inLanguage: movie.language || 'en',
    keywords: [
      title,
      vjLabel,
      'Luganda translated movies',
      'Uganda translated movies',
      'VJ movies Uganda',
      ...(movie.tags || []),
      ...(movie.category || []),
      ...(movie.genres || []),
    ].filter(Boolean),
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}
