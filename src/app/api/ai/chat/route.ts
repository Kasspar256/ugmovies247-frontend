import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import { getCurrentAuthSession } from '@/lib/auth/server';
import {
  AI_RATE_LIMIT_FALLBACK_MESSAGE,
  GeminiRateLimitError,
  generateAiChatPayload,
  normalizeAiPayload,
} from '@/lib/server/aiGemini';
import {
  buildAiUserProfileContext,
  getAiMovieCandidates,
  getAiTrendingHomeCategoryCandidates,
  getAiTrendingMovieCandidates,
  getAiTrendingVjCandidates,
} from '@/lib/server/aiMovieSearch';
import { buildAiPersonalizationContext } from '@/lib/server/aiUserContext';
import { saveAiChatHistoryMessage } from '@/lib/server/aiMemory';
import { getViewerEntitlement } from '@/lib/server/subscriptions';
import { isAppInReview } from '@/lib/appReview';
import type { AiChatRequestMessage, AiChatResponsePayload, AiStreamEvent } from '@/types/aiChat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGE_LENGTH = 1600;
const MAX_HISTORY_MESSAGES = 10;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeMessages(value: unknown): AiChatRequestMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const raw = entry as Partial<AiChatRequestMessage>;
      const role = raw.role === 'assistant' ? 'assistant' : raw.role === 'user' ? 'user' : null;
      const content = String(raw.content || '').trim().slice(0, MAX_MESSAGE_LENGTH);

      if (!role || !content) {
        return null;
      }

      return { role, content };
    })
    .filter(Boolean)
    .slice(-MAX_HISTORY_MESSAGES) as AiChatRequestMessage[];
}

function encodeEvent(event: AiStreamEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function createStreamingResponse(payload: AiChatResponsePayload) {
  const encoder = new TextEncoder();
  const words = payload.reply.split(/(\s+)/).filter((part) => part.length > 0);

  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const word of words) {
          controller.enqueue(encoder.encode(encodeEvent({ type: 'chunk', text: word })));
          await sleep(18);
        }

        controller.enqueue(encoder.encode(encodeEvent({ type: 'final', payload })));
        controller.close();
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    }
  );
}

function fallbackPayload(message: string): AiChatResponsePayload {
  return {
    reply: message,
    movieCards: [],
    deeplinks: [
      {
        route: '/search',
        label: 'Use standard search',
      },
    ],
    actions: [],
  };
}

function adminFirewallPayload(): AiChatResponsePayload {
  return {
    reply:
      'I keep my focus on the movies themselves to give you the best recommendations! What genre are you in the mood for?',
    movieCards: [],
    deeplinks: [],
    actions: [],
  };
}

function releaseStateFirewallPayload(): AiChatResponsePayload {
  return {
    reply:
      "I focus on helping you find great movies and use UG Movies 247. If a feature is not available in this current version, I'll guide you to the closest available option.",
    movieCards: [],
    deeplinks: [
      {
        route: '/browse',
        label: 'Browse Movies',
      },
      {
        route: '/help',
        label: 'Open Help',
      },
    ],
    actions: [],
  };
}

function isInternalStatsRequest(message: string) {
  const normalized = message.toLowerCase();

  return (
    /total\s+(number\s+of\s+)?movies|how\s+many\s+movies\s+(are|do|in)|movie\s+count/.test(normalized) ||
    /registered\s+users|total\s+users|user\s+count|how\s+many\s+users/.test(normalized) ||
    /revenue|sales|earnings|income|billing\s+(total|stats|statistics|report|reports)/.test(normalized)
  );
}

function isInternalReleaseStateRequest(message: string) {
  const normalized = message.toLowerCase();

  return (
    /review\s+mode|app\s+review|play\s+review|google\s+review|store\s+review|reviewer/.test(normalized) ||
    /(why|are|is|did).{0,40}(subscription|payment|checkout|billing).{0,40}(hidden|disabled|missing|blocked|unavailable)/.test(normalized) ||
    /(subscription|payment|checkout|billing).{0,40}(hidden|disabled|missing|blocked|unavailable).{0,40}(why|reason)/.test(normalized)
  );
}

function sanitizeConversationForGemini(messages: AiChatRequestMessage[]) {
  return messages.map((message) => {
    if (isInternalReleaseStateRequest(message.content)) {
      return {
        ...message,
        content: 'I asked about feature availability in the current app version.',
      };
    }

    if (isInternalStatsRequest(message.content)) {
      return {
        ...message,
        content: 'I asked for internal app statistics.',
      };
    }

    return message;
  });
}

export async function POST(request: Request) {
  let session: Awaited<ReturnType<typeof getCurrentAuthSession>> = null;

  try {
    const body = await request.json().catch(() => ({}));
    const messages = sanitizeMessages((body as { messages?: unknown }).messages);
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');

    if (!latestUserMessage) {
      return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    }

    session = await getCurrentAuthSession({ hydrateUserRecord: true }).catch(() => null);

    if (session) {
      void saveAiChatHistoryMessage(session.uid, 'user', latestUserMessage.content).catch((error) => {
        console.warn('[ai-chat] failed to persist user message', error);
      });
    }

    if (isInternalStatsRequest(latestUserMessage.content)) {
      const payload = adminFirewallPayload();

      if (session && !request.signal.aborted) {
        void saveAiChatHistoryMessage(session.uid, 'ai', payload.reply).catch((error) => {
          console.warn('[ai-chat] failed to persist firewall response', error);
        });
      }

      return createStreamingResponse(payload);
    }

    if (isInternalReleaseStateRequest(latestUserMessage.content)) {
      const payload = releaseStateFirewallPayload();

      if (session && !request.signal.aborted) {
        void saveAiChatHistoryMessage(session.uid, 'ai', payload.reply).catch((error) => {
          console.warn('[ai-chat] failed to persist release-state firewall response', error);
        });
      }

      return createStreamingResponse(payload);
    }

    const [
      movies,
      trendingMovies,
      trendingVjs,
      trendingHomeCategories,
      entitlement,
      personalization,
      firebaseAuthUser,
    ] = await Promise.all([
      getAiMovieCandidates(latestUserMessage.content),
      getAiTrendingMovieCandidates(),
      getAiTrendingVjCandidates(),
      getAiTrendingHomeCategoryCandidates(),
      session && !isAppInReview
        ? getViewerEntitlement(session.uid, {
            email: session.email,
            role: session.role,
          }).catch(() => null)
        : Promise.resolve(null),
      buildAiPersonalizationContext(session?.uid),
      session ? adminAuth.getUser(session.uid).catch(() => null) : Promise.resolve(null),
    ]);
    const profile = buildAiUserProfileContext(session, entitlement?.subscription || null, firebaseAuthUser);
    const geminiMessages = sanitizeConversationForGemini(messages);
    const rawPayload = await generateAiChatPayload({
      messages: geminiMessages,
      movies,
      profile,
      personalization,
      trendingMovies,
      trendingVjs,
      trendingHomeCategories,
    });
    const payload = normalizeAiPayload({
      rawPayload,
      movies,
      trendingMovies,
      trendingVjs,
      trendingHomeCategories,
      profile,
      latestUserMessage: latestUserMessage.content,
    });

    if (session && !request.signal.aborted) {
      void saveAiChatHistoryMessage(session.uid, 'ai', payload.reply).catch((error) => {
        console.warn('[ai-chat] failed to persist AI response', error);
      });
    }

    return createStreamingResponse(payload);
  } catch (error) {
    const fallbackMessage =
      error instanceof GeminiRateLimitError
        ? AI_RATE_LIMIT_FALLBACK_MESSAGE
        : error instanceof Error && /GEMINI_API_KEY/i.test(error.message)
          ? 'The AI is not connected yet. Please use the standard search for now.'
          : 'The AI could not answer right now. Please use the standard search.';

    if (session && !request.signal.aborted) {
      void saveAiChatHistoryMessage(session.uid, 'ai', fallbackMessage).catch((historyError) => {
        console.warn('[ai-chat] failed to persist fallback response', historyError);
      });
    }

    if (error instanceof GeminiRateLimitError) {
      return createStreamingResponse(fallbackPayload(fallbackMessage));
    }

    console.error('[ai-chat] request failed', error);
    return createStreamingResponse(fallbackPayload(fallbackMessage));
  }
}
