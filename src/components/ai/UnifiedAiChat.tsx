'use client';

import { FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ExternalLink,
  KeyRound,
  MailCheck,
  Menu,
  Play,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { getOptimizedArtworkUrl } from '@/lib/artwork';
import type { AiAction, AiChatMessage, AiChatRequestMessage, AiStreamEvent } from '@/types/aiChat';

const starterPrompts = [
  'Recommend a good action movie',
  'What should I watch with VJ Junior?',
  'How do I change my password?',
];

function getDisplayName(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

function createWelcomeMessage(name?: string): AiChatMessage {
  const displayName = getDisplayName(name || '');

  return {
    id: 'welcome',
    role: 'assistant',
    content: displayName
      ? `Welcome back, ${displayName}! What are we watching today?`
      : 'Welcome back! What are we watching today?',
  };
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toRequestMessages(messages: AiChatMessage[]): AiChatRequestMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))
    .filter((message) => message.content.trim());
}

async function readAiStream(response: Response, onEvent: (event: AiStreamEvent) => void) {
  if (!response.body) {
    throw new Error('The AI response stream did not open.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      const dataLine = event
        .split('\n')
        .find((line) => line.startsWith('data: '));

      if (!dataLine) {
        continue;
      }

      onEvent(JSON.parse(dataLine.slice(6)) as AiStreamEvent);
    }
  }
}

function renderInlineFormatting(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${part}-${index}`} className="font-black text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }

    return part;
  });
}

function renderFormattedMessage(content: string) {
  const blocks: ReactNode[] = [];
  const bulletItems: ReactNode[][] = [];

  function flushBullets() {
    if (!bulletItems.length) {
      return;
    }

    blocks.push(
      <ul key={`bullets-${blocks.length}`} className="ml-4 list-disc space-y-1">
        {bulletItems.splice(0).map((item, index) => (
          <li key={`bullet-${index}`} className="pl-1">
            {item}
          </li>
        ))}
      </ul>
    );
  }

  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushBullets();
      return;
    }

    const bulletMatch = trimmed.match(/^(?:[-*]|\u2022)\s+(.+)$/);

    if (bulletMatch) {
      bulletItems.push(renderInlineFormatting(bulletMatch[1]));
      return;
    }

    flushBullets();
    blocks.push(
      <p key={`line-${index}`} className="whitespace-pre-wrap">
        {renderInlineFormatting(line)}
      </p>
    );
  });
  flushBullets();

  return <div className="space-y-2 text-sm leading-6 md:text-[15px]">{blocks}</div>;
}

export default function UnifiedAiChat() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const scrollAreaRef = useRef<HTMLElement | null>(null);
  const latestMessageRef = useRef<HTMLDivElement | null>(null);
  const scrollTailRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([createWelcomeMessage()]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [profileName, setProfileName] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerHeight, setComposerHeight] = useState(88);
  const [isCompactViewport, setIsCompactViewport] = useState(true);
  const [actionFeedback, setActionFeedback] = useState<Record<string, string>>({});
  const abortControllerRef = useRef<AbortController | null>(null);
  const localInteractionRef = useRef(false);

  useEffect(() => {
    let active = true;

    const loadHistory = async () => {
      try {
        const response = await fetch('/api/ai/history', {
          credentials: 'include',
          cache: 'no-store',
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => ({}))) as {
          messages?: AiChatMessage[];
          user?: {
            name?: string;
          };
        };
        const historyMessages = Array.isArray(payload.messages)
          ? payload.messages.filter((message) => message.content?.trim())
          : [];
        const loadedProfileName = getDisplayName(payload.user?.name || '');

        if (active && loadedProfileName) {
          setProfileName(loadedProfileName);
        }

        if (active && !localInteractionRef.current) {
          setMessages(
            historyMessages.length ? historyMessages : [createWelcomeMessage(loadedProfileName)]
          );
        }
      } catch (error) {
        console.warn('[ai-chat] history load failed', error);
      } finally {
        if (active) {
          setHistoryLoading(false);
        }
      }
    };

    void loadHistory();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const updateViewportSize = () => {
      const viewport = window.visualViewport;
      const height = Math.round(viewport?.height || window.innerHeight);
      const top = Math.round(viewport?.offsetTop || 0);

      document.documentElement.style.setProperty('--ai-chat-viewport-height', `${height}px`);
      document.documentElement.style.setProperty('--ai-chat-viewport-top', `${top}px`);
      setIsCompactViewport(window.innerWidth < 768);
    };

    updateViewportSize();

    window.visualViewport?.addEventListener('resize', updateViewportSize);
    window.visualViewport?.addEventListener('scroll', updateViewportSize);
    window.addEventListener('resize', updateViewportSize);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewportSize);
      window.visualViewport?.removeEventListener('scroll', updateViewportSize);
      window.removeEventListener('resize', updateViewportSize);
      document.documentElement.style.removeProperty('--ai-chat-viewport-height');
      document.documentElement.style.removeProperty('--ai-chat-viewport-top');
    };
  }, []);

  useEffect(() => {
    const composer = composerRef.current;

    if (!composer) {
      return;
    }

    const updateComposerHeight = () => {
      setComposerHeight(Math.ceil(composer.getBoundingClientRect().height));
    };

    updateComposerHeight();

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateComposerHeight);

    resizeObserver?.observe(composer);
    window.addEventListener('resize', updateComposerHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateComposerHeight);
    };
  }, []);

  useEffect(() => {
    document.body.classList.add('ai-chat-page');

    return () => {
      document.body.classList.remove('ai-chat-page');
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('ai-chat-input-focused', composerFocused);

    return () => {
      document.body.classList.remove('ai-chat-input-focused');
    };
  }, [composerFocused]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [input]);

  useEffect(() => {
    if (messages.length <= 1) {
      return;
    }

    const scrollArea = scrollAreaRef.current;

    if (!scrollArea) {
      return;
    }

    const scrollToBottom = () => {
      scrollArea.scrollTo({
        top: scrollArea.scrollHeight,
        behavior: loading ? 'smooth' : 'auto',
      });
      const target = latestMessageRef.current || scrollTailRef.current;

      target?.scrollIntoView({
        block: 'end',
        behavior: loading ? 'smooth' : 'auto',
      });
    };

    const frame = window.requestAnimationFrame(scrollToBottom);
    const timers = loading
      ? [
          window.setTimeout(scrollToBottom, 140),
          window.setTimeout(scrollToBottom, 360),
        ]
      : [];

    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [messages, loading]);

  useEffect(() => {
    if (!composerFocused) {
      return;
    }

    const timer = window.setTimeout(() => {
      const scrollArea = scrollAreaRef.current;

      if (!scrollArea) {
        return;
      }

      if (messages.length <= 1) {
        scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
        window.scrollTo({ top: 0, behavior: 'auto' });
        return;
      }

      (latestMessageRef.current || scrollTailRef.current)?.scrollIntoView({
        block: 'end',
        behavior: 'smooth',
      });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [composerFocused, messages.length]);

  const sendPrompt = async (prompt: string) => {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || loading) {
      return;
    }

    const userMessage: AiChatMessage = {
      id: createId('user'),
      role: 'user',
      content: trimmedPrompt,
    };
    const assistantMessageId = createId('assistant');
    const assistantMessage: AiChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
    };
    const nextMessages = [...messages, userMessage, assistantMessage];

    localInteractionRef.current = true;
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        signal: abortController.signal,
        body: JSON.stringify({
          messages: toRequestMessages([...messages, userMessage]),
        }),
      });

      if (!response.ok) {
        throw new Error('The AI could not answer right now.');
      }

      await readAiStream(response, (event) => {
        if (event.type === 'chunk') {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    content: `${message.content}${event.text}`,
                  }
                : message
            )
          );
        }

        if (event.type === 'final') {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    content: event.payload.reply,
                    movieCards: event.payload.movieCards,
                    deeplinks: event.payload.deeplinks,
                    actions: event.payload.actions,
                  }
                : message
            )
          );
        }

        if (event.type === 'error') {
          throw new Error(event.message);
        }
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return;
      }

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content:
                  error instanceof Error
                    ? error.message
                    : 'The AI could not answer right now. Please use the standard search.',
                deeplinks: [
                  {
                    route: '/search',
                    label: 'Use standard search',
                  },
                ],
              }
            : message
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendPrompt(input);
  };

  const stopResponse = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
    setMessages((currentMessages) =>
      currentMessages.map((message, index) =>
        index === currentMessages.length - 1 &&
        message.role === 'assistant' &&
        !message.content.trim()
          ? {
              ...message,
              content: 'Response stopped.',
            }
          : message
      )
    );

    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const clearChat = async () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
    setClearingChat(true);
    localInteractionRef.current = true;

    try {
      await fetch('/api/ai/history', {
        method: 'DELETE',
        credentials: 'include',
        cache: 'no-store',
      });
    } catch (error) {
      console.warn('[ai-chat] clear chat failed', error);
    } finally {
      setMessages([createWelcomeMessage(profileName)]);
      setInput('');
      setActionFeedback({});
      setClearingChat(false);
      setDrawerOpen(false);
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }
  };

  const composerBottomClass = composerFocused
    ? 'bottom-[calc(0.75rem+env(safe-area-inset-bottom))]'
    : 'bottom-[calc(5.9rem+env(safe-area-inset-bottom))]';
  const composerReserveOffsetRem = isCompactViewport
    ? composerFocused
      ? 1.35
      : 6.65
    : 2;
  const contentBottomPadding = `calc(${composerHeight}px + ${composerReserveOffsetRem}rem + env(safe-area-inset-bottom))`;
  const showStarterPrompts =
    !historyLoading && messages.length === 1 && messages[0]?.id === 'welcome' && !input.trim();

  const runAiAction = async (action: AiAction, feedbackKey: string) => {
    if (action.type === 'reset_password' && !action.email) {
      router.push('/forgot-password');
      return;
    }

    setActionFeedback((current) => ({
      ...current,
      [feedbackKey]: 'Sending...',
    }));

    try {
      const response =
        action.type === 'verify_email'
          ? await fetch('/api/auth/verification-email', {
              method: 'POST',
              credentials: 'include',
            })
          : await fetch('/api/auth/password-reset', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'include',
              body: JSON.stringify({ email: action.email }),
            });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || 'This action could not be completed right now.');
      }

      setActionFeedback((current) => ({
        ...current,
        [feedbackKey]:
          payload.message ||
          (action.type === 'verify_email'
            ? 'Verification email sent.'
            : 'Password reset email sent.'),
      }));
    } catch (error) {
      setActionFeedback((current) => ({
        ...current,
        [feedbackKey]:
          error instanceof Error
            ? error.message
            : 'This action could not be completed right now.',
      }));
    }
  };

  return (
    <main
      className="fixed left-0 w-full overflow-hidden bg-[#080A0F] px-4 pt-4 text-white md:px-8 md:pt-8"
      style={{
        top: 'var(--ai-chat-viewport-top, 0px)',
        height: 'var(--ai-chat-viewport-height, 100dvh)',
      }}
    >
      <style jsx global>{`
        body.ai-chat-page {
          overflow: hidden;
          overscroll-behavior: none;
        }

        body.ai-chat-input-focused .mobile-bottom-nav,
        body.ai-chat-input-focused .environment-badge {
          display: none !important;
        }

        .ai-chat-scroll {
          -webkit-overflow-scrolling: touch;
          scroll-padding-bottom: 1rem;
        }

        @keyframes ai-thinking-dot {
          0% {
            opacity: 0.28;
          }

          35% {
            opacity: 1;
          }

          70%,
          100% {
            opacity: 0.28;
          }
        }

        .ai-thinking-dot {
          animation: ai-thinking-dot 1.15s ease-in-out infinite;
        }
      `}</style>
      <div
        className="relative mx-auto flex h-full max-w-4xl flex-col overflow-hidden"
        style={{ paddingBottom: contentBottomPadding }}
      >
        <header className="sticky top-0 z-20 -mx-4 border-b border-white/10 bg-[#080A0F]/88 px-4 pb-4 pt-2 backdrop-blur-2xl md:static md:mx-0 md:border md:bg-[#11141C]/72 md:p-4 md:rounded-[28px]">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/browse"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/75 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Back to browse"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.28em] text-[#FFB3C1]">
                <Sparkles size={14} />
                UG Movies AI
              </div>
              <h1 className="mt-1 truncate text-2xl font-black tracking-[-0.04em] text-white md:text-3xl">
                Ask anything
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-[#D90429]/25 bg-[#D90429]/12 text-[#FFB3C1] shadow-[0_0_28px_rgba(217,4,41,0.16)] transition-colors hover:bg-[#D90429]/20 hover:text-white"
              aria-label="Open AI chat menu"
            >
              <Menu size={20} />
            </button>
          </div>
        </header>

        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className={`fixed inset-0 z-50 bg-black/48 backdrop-blur-sm transition-opacity ${
            drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          aria-label="Close AI chat menu overlay"
        />
        <aside
          className={`fixed bottom-0 right-0 top-0 z-[60] flex w-[min(22rem,88vw)] flex-col border-l border-white/10 bg-[#0B0E14]/96 p-5 text-white shadow-[-28px_0_70px_rgba(0,0,0,0.48)] backdrop-blur-2xl transition-transform duration-300 ${
            drawerOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
          aria-hidden={!drawerOpen}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#FFB3C1]">
                AI Menu
              </p>
              <h2 className="mt-1 text-xl font-black tracking-[-0.03em]">Chat settings</h2>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close AI chat menu"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-8 grid gap-3">
            <button
              type="button"
              onClick={() => void clearChat()}
              disabled={clearingChat}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#D90429]/30 bg-[#D90429] px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-white shadow-[0_0_28px_rgba(217,4,41,0.26)] transition-colors hover:bg-[#b80424] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 size={16} />
              {clearingChat ? 'Clearing...' : 'Clear Chat'}
            </button>
            <p className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white/62">
              This only clears your AI conversation. Your watchlist, downloads, likes, and
              profile stay safe.
            </p>
          </div>

          <p className="mt-auto border-t border-white/10 pt-4 text-xs font-semibold leading-5 text-white/48">
            History is cleared every 7 days for your privacy
          </p>
        </aside>

        <section
          ref={scrollAreaRef}
          className="ai-chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain py-4 pr-1 md:py-5"
        >
          <div className="flex min-h-full flex-col justify-end gap-4">
            {messages.map((message, index) => {
              const isUser = message.role === 'user';
              const isLatestMessage = index === messages.length - 1;
              const isTypingMessage = !message.content.trim() && message.role === 'assistant';

              if (isTypingMessage) {
                return null;
              }

              return (
                <div
                  key={message.id}
                  ref={isLatestMessage ? latestMessageRef : undefined}
                  className={`flex scroll-mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[92%] rounded-[26px] px-4 py-3 shadow-[0_18px_38px_rgba(0,0,0,0.24)] md:max-w-[76%] ${
                      isUser
                        ? 'bg-[#D90429] text-white'
                        : 'border border-white/10 bg-[#11141C]/88 text-white/86'
                    }`}
                  >
                    {renderFormattedMessage(message.content)}

                    {message.movieCards?.length ? (
                      <div className="mt-4 grid gap-3">
                        {message.movieCards.map((movie) => (
                          <button
                            key={movie.id}
                            type="button"
                            onClick={() => router.push(`/movie/${encodeURIComponent(movie.id)}?autoplay=1`)}
                            className="group flex gap-3 rounded-[22px] border border-white/10 bg-white/[0.04] p-2 text-left transition-colors hover:border-[#D90429]/40 hover:bg-[#D90429]/10"
                          >
                            <div className="relative aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-2xl bg-white/5">
                              {movie.poster ? (
                                <img
                                  src={getOptimizedArtworkUrl(movie.poster, 'card')}
                                  alt={movie.title}
                                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-white/35">
                                  <Search size={20} />
                                </div>
                              )}
                              <div className="absolute inset-0 flex items-center justify-center bg-black/36 opacity-0 transition-opacity group-hover:opacity-100">
                                <Play size={22} className="fill-white text-white" />
                              </div>
                            </div>
                            <div className="min-w-0 flex-1 py-1">
                              <div className="line-clamp-2 text-sm font-black leading-tight text-white">
                                {movie.title}
                              </div>
                              <div className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#FFB3C1]">
                                {movie.vj ? `VJ ${movie.vj}` : movie.genres?.[0] || 'Movie'}
                              </div>
                              <p className="mt-2 line-clamp-3 text-xs leading-5 text-white/62">
                                {movie.pitch}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {message.deeplinks?.length ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {message.deeplinks.map((deeplink) => (
                          <button
                            key={`${message.id}-${deeplink.route}`}
                            type="button"
                            onClick={() => router.push(deeplink.route)}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition-colors hover:border-[#D90429]/40 hover:bg-[#D90429]/18"
                          >
                            {deeplink.label}
                            <ExternalLink size={13} />
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {message.actions?.length ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {message.actions.map((action) => {
                          const feedbackKey = `${message.id}-${action.type}`;
                          const feedback = actionFeedback[feedbackKey];

                          return (
                            <div key={feedbackKey} className="min-w-0">
                              <button
                                type="button"
                                onClick={() => void runAiAction(action, feedbackKey)}
                                className="inline-flex items-center gap-2 rounded-full border border-[#D90429]/30 bg-[#D90429]/16 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#D90429]/28"
                              >
                                {action.type === 'verify_email' ? (
                                  <MailCheck size={14} />
                                ) : (
                                  <KeyRound size={14} />
                                )}
                                {action.label}
                              </button>
                              {feedback ? (
                                <p className="mt-1 max-w-[15rem] text-[11px] font-semibold leading-4 text-white/55">
                                  {feedback}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {showStarterPrompts ? (
              <div className="grid gap-2 pt-1 md:grid-cols-3">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendPrompt(prompt)}
                    className="rounded-[22px] border border-white/10 bg-white/[0.035] px-4 py-3 text-left text-sm font-semibold text-white/76 transition-colors hover:border-[#D90429]/35 hover:bg-[#D90429]/10 hover:text-white"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
            <div
              ref={scrollTailRef}
              aria-hidden="true"
              className={composerFocused ? 'h-2 md:h-3' : 'h-3 md:h-4'}
            />
          </div>
        </section>

        {loading ? (
          <div
            className={`pointer-events-none absolute ${
              composerFocused
                ? 'bottom-[calc(6.35rem+env(safe-area-inset-bottom))]'
                : 'bottom-[calc(11.75rem+env(safe-area-inset-bottom))] md:bottom-[calc(6.45rem+env(safe-area-inset-bottom))]'
            } left-2 z-30 inline-flex rounded-full border border-white/10 bg-[#11141C]/94 px-2.5 py-1.5 shadow-[0_16px_36px_rgba(0,0,0,0.32)] backdrop-blur-xl transition-[bottom] duration-200`}
            aria-label="AI is responding"
          >
            <span className="inline-flex items-center gap-1">
              <span className="ai-thinking-dot h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.28)]" />
              <span className="ai-thinking-dot h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.28)] [animation-delay:0.16s]" />
              <span className="ai-thinking-dot h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.28)] [animation-delay:0.32s]" />
            </span>
          </div>
        ) : null}

        <form
          ref={composerRef}
          onSubmit={handleSubmit}
          className={`absolute ${composerBottomClass} left-0 right-0 z-40 rounded-[30px] border border-white/10 bg-[#11141C]/94 p-2.5 shadow-[0_22px_56px_rgba(0,0,0,0.52)] backdrop-blur-2xl transition-[bottom] duration-200 md:bottom-6`}
        >
          <div className="flex items-end gap-2 rounded-[24px] bg-white/[0.025] px-1">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={1}
              placeholder="Ask for a movie, your plan, password help..."
              className="min-h-[3.25rem] flex-1 resize-none overflow-y-auto bg-transparent px-3 py-3.5 text-base leading-6 text-white outline-none placeholder:text-white/42 md:text-sm"
              disabled={loading}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => {
                window.setTimeout(() => {
                  if (document.activeElement !== textareaRef.current) {
                    setComposerFocused(false);
                  }
                }, 120);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendPrompt(input);
                }
              }}
            />
            <button
              type={loading ? 'button' : 'submit'}
              onClick={loading ? stopResponse : undefined}
              disabled={!loading && !input.trim()}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white transition-all disabled:cursor-not-allowed disabled:opacity-45 ${
                loading
                  ? 'bg-[#D90429] text-white shadow-[0_0_30px_rgba(217,4,41,0.38)]'
                  : 'bg-[#D90429] shadow-[0_0_26px_rgba(217,4,41,0.32)]'
              }`}
              aria-label={loading ? 'Stop response' : 'Send message'}
            >
              {loading ? <Square size={14} className="fill-current" /> : <Send size={18} />}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
