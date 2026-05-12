import { createHash } from 'node:crypto';
import type { AiChatRequestMessage, AiChatResponsePayload } from '@/types/aiChat';
import type {
  AiMovieCandidate,
  AiTrendingHomeCategory,
  AiTrendingVj,
  AiUserProfileContext,
} from '@/lib/server/aiMovieSearch';
import { isAppInReview } from '@/lib/appReview';
import { VJ_DIRECTORY } from '@/config/constants';
import { SUBSCRIPTION_PLAN_LIST } from '@/lib/subscriptions/plans';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_CACHE_API_URL = 'https://generativelanguage.googleapis.com/v1beta/cachedContents';
const GEMINI_STATIC_CACHE_TTL_SECONDS = 60 * 60;
const GEMINI_STATIC_CACHE_REFRESH_BUFFER_MS = 60 * 1000;

export const AI_RATE_LIMIT_FALLBACK_MESSAGE =
  'The AI is taking a quick break! Please use the standard search.';

export class GeminiRateLimitError extends Error {
  constructor(message = AI_RATE_LIMIT_FALLBACK_MESSAGE) {
    super(message);
    this.name = 'GeminiRateLimitError';
  }
}

export type RawAiRecommendation = {
  movieID?: string;
  movieId?: string;
  title?: string;
  pitch?: string;
};

export type RawAiDeeplink = {
  route?: string;
  label?: string;
  reason?: string;
};

export type RawAiAction = {
  type?: string;
  label?: string;
  reason?: string;
};

type RawGeminiAiPayload = {
  reply?: string;
  recommendations?: RawAiRecommendation[];
  deeplinks?: RawAiDeeplink[];
  actions?: RawAiAction[];
};

type GeminiStaticCacheRecord = {
  name: string;
  signature: string;
  expiresAtMs: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __ugmoviesGeminiStaticCache: GeminiStaticCacheRecord | undefined;
  // eslint-disable-next-line no-var
  var __ugmoviesGeminiStaticCachePromise: Promise<GeminiStaticCacheRecord | null> | undefined;
  // eslint-disable-next-line no-var
  var __ugmoviesGeminiStaticCacheDisabledUntilMs: number | undefined;
}

type GenerateAiChatPayloadInput = {
  messages: AiChatRequestMessage[];
  movies: AiMovieCandidate[];
  staticCatalogMovies?: AiMovieCandidate[];
  profile: AiUserProfileContext | null;
  personalization?: AiPersonalizationContext | null;
  trendingMovies?: AiMovieCandidate[];
  trendingVjs?: AiTrendingVj[];
  trendingHomeCategories?: AiTrendingHomeCategory[];
};

export type AiPersonalizationMovieItem = {
  movieID: string;
  title: string;
  poster?: string;
  status?: string;
  savedAt?: string | null;
  downloadedAt?: string | null;
  likedAt?: string | null;
  lastWatchedAt?: string | null;
  progressPercent?: number;
  completed?: boolean;
  watchHref?: string;
};

export type AiPersonalizationContext = {
  signedIn: boolean;
  watchlist: {
    total: number;
    items: AiPersonalizationMovieItem[];
  };
  downloads: {
    total: number;
    items: AiPersonalizationMovieItem[];
  };
  likes: {
    total: number;
    items: AiPersonalizationMovieItem[];
  };
  watchHistory: {
    available: boolean;
    total: number;
    items: AiPersonalizationMovieItem[];
    note?: string;
  };
  notes?: string[];
};

const APP_NAVIGATION = [
  { section: 'Home / Browse', route: '/browse', labels: ['home', 'browse', 'latest movies', 'trailers'] },
  { section: 'Search', route: '/search', labels: ['search', 'find movies', 'standard search'] },
  { section: 'AI Chat', route: '/search/ai-chat', labels: ['ask ai', 'ai chat', 'assistant'] },
  { section: 'VJ Categories', route: '/vjs', labels: ['vjs', 'vj categories', 'translators'] },
  { section: 'Genres', route: '/genres', labels: ['genres', 'categories'] },
  { section: 'Series', route: '/series', labels: ['series', 'shows'] },
  { section: 'Profile', route: '/profile', labels: ['profile', 'account', 'my account'] },
  { section: 'Edit Profile', route: '/profile/edit', labels: ['edit profile', 'name', 'profile photo'] },
  { section: 'Profile Settings', route: '/profile/settings', labels: ['settings', 'app settings'] },
  { section: 'Manage Account', route: '/profile/manage', labels: ['manage account', 'account details'] },
  { section: 'Security', route: '/profile/security', labels: ['password', 'security', 'change password'] },
  { section: 'Help', route: '/profile/help', labels: ['help', 'support', 'contact support'] },
  { section: 'Public Help', route: '/help', labels: ['help center', 'public help'] },
  { section: 'Notifications', route: '/notifications', labels: ['notifications', 'alerts'] },
  { section: 'Watched / Continue Watching', route: '/profile', labels: ['watch history', 'watched movies', 'continue watching'] },
  { section: 'Watchlist', route: '/watchlist', labels: ['watchlist', 'saved movies'] },
  { section: 'Likes', route: '/likes', labels: ['likes', 'liked movies'] },
  { section: 'Downloads', route: '/downloads', labels: ['downloads', 'offline downloads'] },
  { section: 'Request a Movie', route: '/request', labels: ['request movie', 'request a movie'] },
  { section: 'Subscribe', route: '/subscribe', labels: ['subscribe', 'subscription', 'plans', 'premium'] },
  { section: 'Payment Method', route: '/subscribe/payment-method', labels: ['payment method', 'choose payment'] },
  { section: 'Mobile Money Checkout', route: '/subscribe/mobile-money', labels: ['mobile money', 'mtn', 'airtel'] },
  { section: 'Card Checkout', route: '/subscribe/card', labels: ['card', 'visa', 'mastercard'] },
  { section: 'Billing / Current Plan', route: '/profile/billing', labels: ['billing', 'current plan'] },
  { section: 'Payment History', route: '/profile/payments', labels: ['payments', 'payment history', 'receipts'] },
  { section: 'Terms', route: '/terms', labels: ['terms', 'terms and conditions'] },
  { section: 'Privacy', route: '/privacy', labels: ['privacy', 'privacy policy'] },
  { section: 'Account Deletion', route: '/account-deletion', labels: ['delete account', 'account deletion'] },
  { section: 'DMCA', route: '/dmca', labels: ['dmca', 'copyright'] },
] as const;

function formatPlanAmount(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString('en-US')}`;
}

function getSubscriptionPlanKnowledge() {
  return SUBSCRIPTION_PLAN_LIST.map((plan) => ({
    type: plan.type,
    name: plan.name,
    price: formatPlanAmount(plan.amount, plan.currency),
    duration: `${plan.durationValue} ${plan.durationUnit}`,
    description: plan.description,
  }));
}

function getVjKnowledge() {
  return VJ_DIRECTORY.map((vj) => ({
    id: vj.id,
    name: vj.name,
    route: `/vjs/${vj.id}`,
  }));
}

function getNavigationKnowledge() {
  const hiddenDuringReview = new Set([
    'Subscribe',
    'Payment Method',
    'Mobile Money Checkout',
    'Card Checkout',
    'Billing / Current Plan',
    'Payment History',
  ]);
  const entries = isAppInReview
    ? APP_NAVIGATION.filter((entry) => !hiddenDuringReview.has(entry.section))
    : APP_NAVIGATION;

  return entries.map((entry) => ({
    section: entry.section,
    route: entry.route,
    labels: entry.labels,
  }));
}

function getGeminiApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim();
}

export function getGeminiChatModel() {
  return String(process.env.GEMINI_CHAT_MODEL || 'gemini-3.1-flash-lite').trim();
}

export function getGeminiEmbeddingModel() {
  return String(process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2').trim();
}

export function getGeminiEmbeddingDimensions() {
  const dimensions = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 768);
  return Number.isFinite(dimensions) && dimensions > 0 ? Math.floor(dimensions) : 768;
}

function getGeminiEndpoint(model: string, action: 'generateContent' | 'embedContent') {
  return `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:${action}`;
}

function getGeminiModelResourceName(model: string) {
  return model.startsWith('models/') ? model : `models/${model}`;
}

function isGeminiContextCacheEnabled() {
  const value = String(process.env.GEMINI_CONTEXT_CACHE_ENABLED || 'true').trim().toLowerCase();

  return value !== '0' && value !== 'false' && value !== 'off';
}

function getGeminiStaticCacheTtlSeconds() {
  const value = Number(process.env.GEMINI_CONTEXT_CACHE_TTL_SECONDS || GEMINI_STATIC_CACHE_TTL_SECONDS);

  if (!Number.isFinite(value) || value <= 0) {
    return GEMINI_STATIC_CACHE_TTL_SECONDS;
  }

  return Math.min(Math.floor(value), GEMINI_STATIC_CACHE_TTL_SECONDS);
}

function getCacheSignature(model: string, staticContext: string) {
  return createHash('sha256')
    .update(model)
    .update('\n')
    .update(buildSystemPrompt())
    .update('\n')
    .update(staticContext)
    .digest('hex');
}

async function parseGeminiResponseText(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: {
      code?: number;
      message?: string;
      status?: string;
    };
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  if (!response.ok) {
    const status = payload.error?.status || '';
    const message = payload.error?.message || `Gemini request failed with ${response.status}.`;

    if (response.status === 429 || /quota|rate/i.test(status) || /quota|rate limit/i.test(message)) {
      throw new GeminiRateLimitError();
    }

    throw new Error(message);
  }

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';

  if (!text.trim()) {
    throw new Error('Gemini returned an empty response.');
  }

  return text;
}

function buildSystemPrompt() {
  return [
    'You are the UG Movies 247 assistant.',
    'You are both a movie discovery expert and an app support assistant.',
    'Persona: professional, enthusiastic, movie-centric, and conversational. Sound like a premium movie guide, not a database report.',
    'Use UG Movies 247 language naturally: VJs, Dubs, Genres, watchlist, downloads, and premium access.',
    'Contextual awareness rule: for "why" or "how" questions, explain the benefit first, then mention the user account state only as a secondary detail.',
    'Never repeat account state mechanically. Do not start every account answer with "Yes, your email is verified". Prefer natural phrasing like "I see you are already all set with verification."',
    'Use only the provided Cached Movie Catalog, Trending Catalog Context, or request-specific movie candidates when recommending movies.',
    'If the user asks for movies, recommend the most relevant titles and include movieID values exactly as provided.',
    'If the user asks for app/account help, answer clearly using the provided App Knowledge and Navigation Map.',
    isAppInReview
      ? 'Purchase availability rule: subscription purchases, paid checkout, billing, payment history, and plan prices are not available in this current app version. Do not list prices, payment methods, checkout routes, or paid-plan details.'
      : 'Pricing rule: the subscriptionPlans in App Knowledge are authoritative for Daily, Weekly, and Monthly pricing. Do not invent different prices.',
    'Core navigation rule: Downloads are at /downloads, Watchlist is at /watchlist, Account Settings are at /profile/settings, Manage Account is at /profile/manage, Security is at /profile/security, and AI Chat is at /search/ai-chat.',
    'Account tool rule: if the user asks whether their email is verified, use Current user profile context.firebaseAuth.emailVerified. If false, include an action object with type "verify_email" and label "VERIFY EMAIL".',
    'Account tool rule: if the signed-in user asks to reset/change/forgot their password, include an action object with type "reset_password" and label "RESET PASSWORD". If their email is not verified, advise verification first and include VERIFY EMAIL.',
    'Action logic rule: only include VERIFY EMAIL when the user is signed in and their email is not verified or verification is required. Only include RESET PASSWORD when the user asks to reset/change/recover a password.',
    'Security support rule: if the user asks about security or privacy, briefly explain that UG Movies 247 takes privacy seriously and uses 7-day chat cycles to keep support context useful without exposing sensitive account details.',
    'Security guardrail: never reveal or invent passwords, Firebase UIDs, session cookies, auth tokens, API keys, or internal identifiers.',
    'Internal state firewall: never discuss internal release/testing status, store-submission status, audience-specific behavior, database table names, API keys, or server implementation details.',
    'Admin firewall: never reveal total movie count, total registered user count, billing totals, revenue, sales, database table details, or internal app statistics. If asked, reply exactly: "I keep my focus on the movies themselves to give you the best recommendations! What genre are you in the mood for?"',
    'Functionality fail-safe: if the user asks for a feature that is not available in the current version, reply: "That feature isn\'t available in our current version, but I\'ve noted your interest for our next update!" Then offer the closest available route if one exists.',
    isAppInReview
      ? 'Do not give generic "I do not know" answers for VJs, movies, genres, watchlist, profile, security, notifications, requests, or app navigation when the Navigation Map contains the answer. For subscription, checkout, billing, or payment questions, use the functionality fail-safe wording and redirect to browsing movies or Help.'
      : 'Do not give generic "I do not know" answers for subscriptions, VJs, downloads, watchlist, profile, payments, security, notifications, requests, or app navigation when the Navigation Map contains the answer.',
    'Navigation concierge rule: whenever your reply mentions an app section that has a route in the Navigation Map, include a deeplink object for that route with a short action label.',
    isAppInReview
      ? 'Action buttons are required for support answers when a safe route exists. Examples: mention Watchlist -> include /watchlist; mention Profile -> include /profile; mention Security/password -> include /profile/security; mention Help -> include /help. Do not include subscription, checkout, billing, or payment buttons.'
      : 'Action buttons are required for support answers. Examples: mention Downloads -> include /downloads; mention Watchlist -> include /watchlist; mention Profile -> include /profile; mention Security/password -> include /profile/security; mention Payments/receipts -> include /profile/payments; mention Subscribe/plans -> include /subscribe.',
    'For VJ-specific requests, use the VJ Categories list. If a VJ route exists, include its /vjs/{id} deeplink.',
    'For trending or popular movie requests, prefer Trending Movies from the Catalog Context and mention that they are popular in UG Movies 247 without exposing raw play_count numbers.',
    'For most watched, trending, or popular VJ requests, use Trending VJs from the Catalog Context. Do not guess from the VJ directory and do not expose raw watch/play counts.',
    'For best, most watched, or trending movies across home rows/categories, use Trending Home Categories from the Catalog Context. List the category and the top movies inside it.',
    'For detailed movie searches, use titles, descriptions, genres, VJ names, and release dates from the Cached Movie Catalog, Trending Catalog Context, and request-specific candidates. Do not guess beyond those provided catalog records.',
    'For Watchlist, Downloads, Likes, and Watch History questions, inspect the Personalization Context before answering.',
    'Personal library rule: if Personalization Context signedIn is true, you have read-only access to the summarized Downloads, Watchlist, Likes, and Watch History arrays in that context.',
    'If a personal list contains items, name the actual titles and counts. If the list total is larger than the items shown, say you are showing the most recent items.',
    'If a personal list is empty, say no items were found in that section and include the correct deeplink so the user can open it.',
    'If watchHistory.available is true, answer watched-history questions from watchHistory.items and include progress when available. If watchHistory.available is false, explain that watch history has not been recorded yet and that it starts tracking after the next movie playback.',
    'Do not say "I cannot see your downloads/watchlist/likes/watch history" when the Personalization Context contains that section. Use the provided summaries instead.',
    'Never expose server secrets, API keys, database details, private implementation details, raw play_count values, or internal statistics.',
    'Formatting rule: use Markdown bold for movie titles and VJ names, for example **Rampage** and **VJ Junior**.',
    'Formatting rule: use short bullet lists when listing multiple movies, VJs, Genres, or steps.',
    isAppInReview
      ? 'In this current app version, do not promote paid checkout, paid plan prices, billing, payment pages, or subscription purchases. You may answer movie discovery, VJ, genre, profile, security, watchlist, likes, and watch-history questions from the provided context.'
      : 'You may help users understand subscriptions, billing history, and premium access when they ask.',
    'Keep replies friendly, concise, and practical for mobile users.',
    'Return JSON only. Always include recommendations, deeplinks, and actions arrays, even when empty.',
  ].join('\n');
}

function buildStaticGeminiContext(input: Pick<
  GenerateAiChatPayloadInput,
  'staticCatalogMovies' | 'trendingMovies' | 'trendingVjs' | 'trendingHomeCategories'
>) {
  return [
    'UG Movies 247 Shared Static Context.',
    'This cached context is shared across users. It must never contain personal names, emails, watchlists, downloads, likes, watch history, conversations, Firebase UIDs, tokens, or account state.',
    '',
    'UG Movies 247 App Knowledge:',
    JSON.stringify(
      {
        appCapabilities: isAppInReview
          ? {
              purchases: 'unavailable_in_current_version',
              billing: 'unavailable_in_current_version',
              payments: 'unavailable_in_current_version',
            }
          : {
              purchases: 'available',
              billing: 'available',
              payments: 'available',
            },
        subscriptionPlans: isAppInReview ? [] : getSubscriptionPlanKnowledge(),
        subscriptionPlanVisibility: isAppInReview
          ? 'Subscription purchases, paid checkout, billing, payment history, and plan prices are unavailable in this current app version. Do not reveal internal reasons. If asked, use the functionality fail-safe wording and offer Help or movie discovery.'
          : 'Subscriptions may be explained normally. Include Subscribe, Payment Method, Billing, or Payment History deeplinks when relevant.',
        vjCategories: getVjKnowledge(),
        navigationMap: getNavigationKnowledge(),
      },
      null,
      2
    ),
    '',
    'Cached Movie Catalog from Neon:',
    JSON.stringify(
      (input.staticCatalogMovies || []).map((movie) => ({
        movieID: movie.id,
        title: movie.title,
        genres: movie.genres,
        category: movie.category,
        vj: movie.vj,
        release_date: movie.release_date,
        description: movie.description,
        popularity: movie.playCount && movie.playCount > 0 ? 'popular' : 'standard',
        trendingRank: movie.trendingRank,
      })),
      null,
      2
    ),
    '',
    'Catalog Context - Trending Movies:',
    JSON.stringify(
      (input.trendingMovies || []).map((movie) => ({
        movieID: movie.id,
        title: movie.title,
        genres: movie.genres,
        vj: movie.vj,
        release_date: movie.release_date,
        description: movie.description,
        trendingRank: movie.trendingRank,
      })),
      null,
      2
    ),
    '',
    'Catalog Context - Trending VJs:',
    JSON.stringify(
      (input.trendingVjs || []).map((vj) => ({
        name: vj.name,
        route: vj.route,
        trendingRank: vj.trendingRank,
        popularMovies: vj.movieSamples,
      })),
      null,
      2
    ),
    '',
    'Catalog Context - Trending Home Categories:',
    JSON.stringify(input.trendingHomeCategories || [], null, 2),
  ].join('\n');
}

function buildDynamicGeminiPrompt(input: GenerateAiChatPayloadInput) {
  const conversation = input.messages.slice(-8).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 1200),
  }));

  return [
    'Use the cached static UG Movies 247 context for persona, navigation, VJ rules, standard safety rules, and shared catalog/trending knowledge.',
    'The data below is dynamic per request and must not be cached.',
    '',
    'Current user profile context:',
    JSON.stringify(input.profile || { signedIn: false }, null, 2),
    '',
    'Personalization Context from Neon-backed user-library data:',
    JSON.stringify(
      input.personalization || {
        signedIn: false,
        watchlist: { total: 0, items: [] },
        downloads: { total: 0, items: [] },
        likes: { total: 0, items: [] },
        watchHistory: {
          available: false,
          total: 0,
          items: [],
          note: 'Watch history is not attached to the AI context.',
        },
        note:
          'Personal library data is not attached to this request. Do not pretend to see exact items; provide navigation deeplinks instead.',
      },
      null,
      2
    ),
    '',
    'Relevant UG Movies 247 movie catalog candidates:',
    JSON.stringify(
      input.movies.map((movie) => ({
        movieID: movie.id,
        title: movie.title,
        genres: movie.genres,
        vj: movie.vj,
        release_date: movie.release_date,
        description: movie.description,
        popularity: movie.playCount && movie.playCount > 0 ? 'popular' : 'standard',
        trendingRank: movie.trendingRank,
      })),
      null,
      2
    ),
    '',
    'Conversation:',
    JSON.stringify(conversation, null, 2),
    '',
    'Return JSON only. Include recommendations only when they help the user. Include deeplinks whenever your reply mentions or recommends opening any mapped app section. Include actions for verification and password reset tasks.',
  ].join('\n');
}

function buildGeminiPrompt(input: GenerateAiChatPayloadInput) {
  return [buildStaticGeminiContext(input), '', buildDynamicGeminiPrompt(input)].join('\n');
}

const aiResponseSchema = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'The assistant message shown in the chat UI.',
    },
    recommendations: {
      type: 'array',
      description: 'Movie recommendations using exact movieID values from the provided static or request-specific catalog records.',
      items: {
        type: 'object',
        properties: {
          movieID: {
            type: 'string',
            description: 'Exact movieID from the provided static or request-specific catalog records.',
          },
          title: {
            type: 'string',
            description: 'Movie title.',
          },
          pitch: {
            type: 'string',
            description: 'Short reason this movie matches the user request.',
          },
        },
        required: ['movieID', 'pitch'],
      },
    },
    deeplinks: {
      type: 'array',
      description: 'App navigation actions for support/account tasks.',
      items: {
        type: 'object',
        properties: {
          route: {
            type: 'string',
            description: 'Internal app route such as /profile/security or /subscribe.',
          },
          label: {
            type: 'string',
            description: 'Short button label.',
          },
          reason: {
            type: 'string',
            description: 'Optional short reason for the navigation.',
          },
        },
        required: ['route', 'label'],
      },
    },
    actions: {
      type: 'array',
      description: 'Account actions that the UI can execute safely for the signed-in user.',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['verify_email', 'reset_password'],
          },
          label: {
            type: 'string',
            description: 'Short button label such as VERIFY EMAIL or RESET PASSWORD.',
          },
          reason: {
            type: 'string',
            description: 'Optional short reason for the action.',
          },
        },
        required: ['type', 'label'],
      },
    },
  },
  required: ['reply', 'recommendations', 'deeplinks', 'actions'],
};

async function createGeminiStaticCache(input: GenerateAiChatPayloadInput, apiKey: string) {
  const model = getGeminiChatModel();
  const staticContext = buildStaticGeminiContext(input);
  const signature = getCacheSignature(model, staticContext);
  const ttlSeconds = getGeminiStaticCacheTtlSeconds();
  const currentCache = globalThis.__ugmoviesGeminiStaticCache;

  if (
    currentCache?.signature === signature &&
    currentCache.expiresAtMs > Date.now() + GEMINI_STATIC_CACHE_REFRESH_BUFFER_MS
  ) {
    return currentCache;
  }

  if (globalThis.__ugmoviesGeminiStaticCachePromise) {
    const pendingCache = await globalThis.__ugmoviesGeminiStaticCachePromise;

    if (
      pendingCache?.signature === signature &&
      pendingCache.expiresAtMs > Date.now() + GEMINI_STATIC_CACHE_REFRESH_BUFFER_MS
    ) {
      return pendingCache;
    }
  }

  globalThis.__ugmoviesGeminiStaticCachePromise = (async () => {
    const response = await fetch(GEMINI_CACHE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model: getGeminiModelResourceName(model),
        systemInstruction: {
          parts: [{ text: buildSystemPrompt() }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: staticContext }],
          },
        ],
        ttl: `${ttlSeconds}s`,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      name?: string;
      error?: {
        message?: string;
        status?: string;
      };
    };

    if (!response.ok || !payload.name) {
      throw new Error(payload.error?.message || `Gemini context cache create failed with ${response.status}.`);
    }

    const cache = {
      name: payload.name,
      signature,
      expiresAtMs: Date.now() + ttlSeconds * 1000,
    };
    globalThis.__ugmoviesGeminiStaticCache = cache;
    globalThis.__ugmoviesGeminiStaticCacheDisabledUntilMs = undefined;

    return cache;
  })()
    .catch((error) => {
      console.warn('[ai-chat] Gemini context cache unavailable; using direct prompt', error);
      globalThis.__ugmoviesGeminiStaticCacheDisabledUntilMs = Date.now() + 5 * 60 * 1000;
      return null;
    })
    .finally(() => {
      globalThis.__ugmoviesGeminiStaticCachePromise = undefined;
    });

  return globalThis.__ugmoviesGeminiStaticCachePromise;
}

async function getGeminiStaticCacheName(input: GenerateAiChatPayloadInput, apiKey: string) {
  if (!isGeminiContextCacheEnabled()) {
    return null;
  }

  if (
    globalThis.__ugmoviesGeminiStaticCacheDisabledUntilMs &&
    globalThis.__ugmoviesGeminiStaticCacheDisabledUntilMs > Date.now()
  ) {
    return null;
  }

  const cache = await createGeminiStaticCache(input, apiKey);

  return cache?.name || null;
}

function buildGeminiGenerateBody(input: GenerateAiChatPayloadInput, cachedContent?: string | null) {
  return {
    ...(cachedContent
      ? {
          cachedContent,
          contents: [
            {
              role: 'user',
              parts: [{ text: buildDynamicGeminiPrompt(input) }],
            },
          ],
        }
      : {
          systemInstruction: {
            parts: [{ text: buildSystemPrompt() }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: buildGeminiPrompt(input) }],
            },
          ],
        }),
    generationConfig: {
      temperature: 0.45,
      maxOutputTokens: 1400,
      responseMimeType: 'application/json',
      responseJsonSchema: aiResponseSchema,
    },
  };
}

async function shouldRetryWithoutGeminiCache(response: Response) {
  if (response.ok) {
    return false;
  }

  const payload = (await response.clone().json().catch(() => ({}))) as {
    error?: {
      message?: string;
      status?: string;
    };
  };
  const message = `${payload.error?.status || ''} ${payload.error?.message || ''}`;

  return response.status === 404 || /cached\s*content|cachedContent|cache/i.test(message);
}

export async function generateAiChatPayload(input: GenerateAiChatPayloadInput) {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY.');
  }

  const cachedContent = await getGeminiStaticCacheName(input, apiKey);
  const endpoint = getGeminiEndpoint(getGeminiChatModel(), 'generateContent');
  let response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(buildGeminiGenerateBody(input, cachedContent)),
  });

  if (cachedContent && (await shouldRetryWithoutGeminiCache(response))) {
    globalThis.__ugmoviesGeminiStaticCache = undefined;
    globalThis.__ugmoviesGeminiStaticCacheDisabledUntilMs = Date.now() + 5 * 60 * 1000;
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(buildGeminiGenerateBody(input)),
    });
  }

  const text = await parseGeminiResponseText(response);
  return JSON.parse(text) as RawGeminiAiPayload;
}

export async function createGeminiEmbedding(text: string, purpose: 'query' | 'document') {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return null;
  }

  const dimensions = getGeminiEmbeddingDimensions();
  const isEmbedding2 = getGeminiEmbeddingModel() === 'gemini-embedding-2';
  const preparedText = isEmbedding2
    ? purpose === 'query'
      ? `task: search result | query: ${text}`
      : text
    : text;
  const body = isEmbedding2
    ? {
        model: `models/${getGeminiEmbeddingModel()}`,
        content: {
          parts: [{ text: preparedText }],
        },
        output_dimensionality: dimensions,
      }
    : {
        taskType: purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        content: {
          parts: [{ text: preparedText }],
        },
        output_dimensionality: dimensions,
      };

  const response = await fetch(getGeminiEndpoint(getGeminiEmbeddingModel(), 'embedContent'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    embedding?: { values?: number[] };
    embeddings?: Array<{ values?: number[] }>;
    error?: { message?: string; status?: string };
  };

  if (!response.ok) {
    if (response.status === 429 || /quota|rate/i.test(payload.error?.status || payload.error?.message || '')) {
      throw new GeminiRateLimitError();
    }

    throw new Error(payload.error?.message || `Gemini embedding request failed with ${response.status}.`);
  }

  return payload.embedding?.values || payload.embeddings?.[0]?.values || null;
}

export function normalizeAiPayload(input: {
  rawPayload: RawGeminiAiPayload;
  movies: AiMovieCandidate[];
  staticCatalogMovies?: AiMovieCandidate[];
  trendingMovies?: AiMovieCandidate[];
  trendingVjs?: AiTrendingVj[];
  trendingHomeCategories?: AiTrendingHomeCategory[];
  profile?: AiUserProfileContext | null;
  latestUserMessage?: string;
}): AiChatResponsePayload {
  const movieById = new Map<string, AiMovieCandidate>(
    [
      ...(input.staticCatalogMovies || []),
      ...(input.trendingMovies || []),
      ...input.movies,
    ].map((movie) => [movie.id, movie] as const)
  );
  const movieCards = (input.rawPayload.recommendations || [])
    .map((recommendation) => {
      const id = String(recommendation.movieID || recommendation.movieId || '').trim();
      const movie = movieById.get(id);

      if (!movie) {
        return null;
      }

      return {
        id: movie.id,
        title: movie.title,
        poster: movie.poster,
        genres: movie.genres,
        vj: movie.vj,
        release_date: movie.release_date,
        pitch: String(recommendation.pitch || '').trim() || 'Tap to start watching.',
      };
    })
    .filter(Boolean)
    .slice(0, 4) as AiChatResponsePayload['movieCards'];
  const allowedRoutes = new Set([
    '/browse',
    '/search',
    '/ai',
    '/search/ai-chat',
    '/profile',
    '/profile/edit',
    '/profile/manage',
    '/profile/settings',
    '/profile/security',
    '/profile/help',
    '/profile/billing',
    '/help',
    '/notifications',
    '/downloads',
    '/request',
    '/watchlist',
    '/likes',
    '/vjs',
    '/genres',
    '/series',
    '/terms',
    '/privacy',
    '/privacy-policy',
    '/account-deletion',
    '/dmca',
    '/dcma',
    ...(
      isAppInReview
        ? []
        : [
            '/profile/payments',
            '/subscribe',
            '/subscribe/payment-method',
            '/subscribe/mobile-money',
            '/subscribe/card',
            '/mobile-checkout',
          ]
    ),
  ]);
  const allowedRoutePrefixes = ['/vjs/', '/genres/', '/category/', '/browse/', '/movie/'];

  function normalizeRoute(route: string) {
    const trimmed = route.trim();
    const pathOnly = trimmed.split(/[?#]/)[0] || '';

    return pathOnly.length > 1 ? pathOnly.replace(/\/+$/, '') : pathOnly;
  }

  function isAllowedRoute(route: string) {
    if (allowedRoutes.has(route)) {
      return true;
    }

    return allowedRoutePrefixes.some((prefix) => route.startsWith(prefix));
  }

  let deeplinks = (input.rawPayload.deeplinks || [])
    .map((deeplink) => {
      const route = normalizeRoute(String(deeplink.route || ''));

      if (!isAllowedRoute(route)) {
        return null;
      }

      return {
        route,
        label: String(deeplink.label || 'Open').trim() || 'Open',
        reason: String(deeplink.reason || '').trim(),
      };
    })
    .filter(Boolean)
    .slice(0, 3) as AiChatResponsePayload['deeplinks'];

  function addDeeplink(route: string, label: string, reason?: string) {
    const normalizedRoute = normalizeRoute(route);

    if (!isAllowedRoute(normalizedRoute) || deeplinks.some((deeplink) => deeplink.route === normalizedRoute)) {
      return;
    }

    deeplinks = [
      ...deeplinks,
      {
        route: normalizedRoute,
        label,
        reason: reason || '',
      },
    ].slice(0, 3);
  }

  const rawQuestion = String(input.latestUserMessage || '').toLowerCase();
  const emailVerified =
    input.profile?.signedIn === true
      ? input.profile.firebaseAuth?.emailVerified === true || input.profile.emailVerified === true
      : false;
  const userEmail = input.profile?.signedIn === true ? input.profile.email : '';
  const isEmailVerificationQuestion = /email.*verif|verif.*email/i.test(rawQuestion);
  const isWhyOrHowQuestion = /\b(why|how)\b/i.test(rawQuestion);
  const isTrendingVjQuestion =
    /(most\s+watched|popular|trending|top).{0,28}vj|vj.{0,28}(most\s+watched|popular|trending|top)/i.test(
      rawQuestion
    );
  const isTrendingHomeCategoryQuestion =
    /((best|most\s+watched|popular|trending|top).{0,40}(home|category|categories|genre|genres|row|section))|((home|category|categories|genre|genres|row|section).{0,40}(best|most\s+watched|popular|trending|top))/i.test(
      rawQuestion
    );
  const isTrendingMovieQuestion =
    /((most\s+watched|popular|trending|top|best)\s+(movies|films))|((movies|films).{0,32}(most\s+watched|popular|trending|top|best))/i.test(
      rawQuestion
    );
  const isPasswordResetQuestion =
    /(reset|forgot|change).{0,24}password|password.{0,24}(reset|forgot|change)/i.test(rawQuestion);
  const actionsByType = new Map<string, AiChatResponsePayload['actions'][number]>();

  function addAction(action: AiChatResponsePayload['actions'][number]) {
    actionsByType.set(action.type, action);
  }

  for (const action of input.rawPayload.actions || []) {
    const type = String(action.type || '').trim();

    if (type !== 'verify_email' && type !== 'reset_password') {
      continue;
    }

    if (type === 'verify_email' && (input.profile?.signedIn !== true || emailVerified)) {
      continue;
    }

    if (type === 'reset_password' && (input.profile?.signedIn !== true || !isPasswordResetQuestion || !emailVerified)) {
      continue;
    }

    addAction({
      type,
      label:
        String(action.label || '').trim() ||
        (type === 'verify_email' ? 'VERIFY EMAIL' : 'RESET PASSWORD'),
      email: type === 'reset_password' ? userEmail : undefined,
      reason: String(action.reason || '').trim(),
    });
  }

  if (input.profile?.signedIn === true && isEmailVerificationQuestion && !emailVerified) {
    addAction({
      type: 'verify_email',
      label: 'VERIFY EMAIL',
      reason: 'Send a new verification email.',
    });
  }

  if (input.profile?.signedIn === true && isPasswordResetQuestion) {
    if (!emailVerified) {
      addAction({
        type: 'verify_email',
        label: 'VERIFY EMAIL',
        reason: 'Verify your email before resetting your password.',
      });
    }

    if (emailVerified) {
      addAction({
        type: 'reset_password',
        label: 'RESET PASSWORD',
        email: userEmail,
        reason: 'Send a password reset link to your account email.',
      });
    }
  }
  const actions = Array.from(actionsByType.values()).slice(0, 2);
  let reply =
    String(input.rawPayload.reply || '').trim() ||
    (movieCards.length ? 'I found a few strong picks for you.' : 'I can help with movies and app support.');

  if (input.profile?.signedIn === true && isEmailVerificationQuestion) {
    const lastSignInTime = input.profile.firebaseAuth?.metadata.lastSignInTime;
    if (isWhyOrHowQuestion) {
      reply = emailVerified
        ? 'Verifying your email protects your UG Movies 247 account, helps with password recovery, and keeps your watchlist, downloads, VJs, and Genres tied safely to you. I see you are already all set with verification, so no extra action is needed.'
        : 'Verifying your email protects your UG Movies 247 account, helps with password recovery, and keeps your watchlist, downloads, VJs, and Genres tied safely to you. Your account still needs verification, so tap VERIFY EMAIL and check your inbox.';
    } else {
      reply = emailVerified
        ? `I see you are already all set with email verification.${lastSignInTime ? ` Your last sign-in was ${lastSignInTime}.` : ''}`
        : 'Your email is not verified yet. Tap VERIFY EMAIL and check your inbox for the confirmation link.';
    }
  } else if (input.profile?.signedIn === true && isPasswordResetQuestion) {
    reply = emailVerified
      ? 'I can send a password reset link to your account email. Tap RESET PASSWORD, then check your inbox.'
      : 'I can help with that. First tap VERIFY EMAIL to confirm this account, then I can send the password reset link safely.';
  } else if (isTrendingVjQuestion) {
    const topVjs = (input.trendingVjs || []).slice(0, 3);

    if (topVjs.length) {
      const leader = topVjs[0];
      reply = [
        `Based on recent UG Movies 247 watch activity, **${leader.name}** is leading the VJ charts right now.`,
        '',
        ...topVjs.map((vj) => {
          const samples = vj.movieSamples
            .slice(0, 2)
            .map((movie) => `**${movie.title}**`)
            .join(', ');

          return `- **${vj.name}**${samples ? ` - popular Dubs include ${samples}` : ''}`;
        }),
      ].join('\n');
      addDeeplink(leader.route, `Open ${leader.name}`, 'Explore this VJ category.');
    } else {
      reply =
        'I do not have enough watch activity yet to rank the most watched VJs accurately. Try asking for a VJ recommendation by Genre, and I can still help you find a strong Dub.';
      addDeeplink('/vjs', 'Explore VJs', 'Browse all VJ categories.');
    }
  } else if (isTrendingHomeCategoryQuestion) {
    const rows = (input.trendingHomeCategories || []).slice(0, 6);

    if (rows.length) {
      reply = [
        'Here are the strongest picks across the UG Movies 247 home categories right now:',
        '',
        ...rows.map((row) => {
          const movies = row.movies
            .slice(0, 3)
            .map((movie) => `**${movie.title}**${movie.vj ? ` (${movie.vj})` : ''}`)
            .join(', ');

          return `- **${row.title}**: ${movies}`;
        }),
      ].join('\n');
      addDeeplink(rows[0].route, `Open ${rows[0].title}`, 'Explore this home category.');
      addDeeplink('/browse', 'Browse Home', 'Open all home categories.');
    } else {
      reply =
        'I do not have enough watch activity yet to rank home categories accurately, but I can still recommend movies by VJ, Dub, or Genre.';
      addDeeplink('/browse', 'Browse Home', 'Explore home categories.');
    }
  } else if (isTrendingMovieQuestion) {
    const topMovies = (input.trendingMovies || []).slice(0, 6);

    if (topMovies.length) {
      reply = [
        'These are the hottest movies on UG Movies 247 right now:',
        '',
        ...topMovies.map((movie) => `- **${movie.title}**${movie.vj ? ` (${movie.vj})` : ''}`),
      ].join('\n');
      addDeeplink('/browse', 'Browse Home', 'Open trending picks.');
    } else {
      reply =
        'I do not have enough watch activity yet to rank the most watched movies accurately, but I can still recommend a strong movie by VJ, Dub, or Genre.';
      addDeeplink('/browse', 'Browse Home', 'Explore movies.');
    }
  }

  if (/review\s+mode|app\s+review|play\s+review|reviewer|hidden\s+for\s+review/i.test(reply)) {
    reply =
      "I focus on helping you find great movies and use UG Movies 247. If a feature is not available in this current version, I'll guide you to the closest available option.";
    deeplinks = [];
    addDeeplink('/browse', 'Browse Movies', 'Explore available movies.');
    addDeeplink('/help', 'Open Help', 'Get help with available app features.');
  }

  return {
    reply,
    movieCards,
    deeplinks,
    actions,
  };
}
