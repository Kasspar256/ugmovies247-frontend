import type { Movie } from '@/types/movie';

export type AiChatRole = 'user' | 'assistant';

export type AiChatMessage = {
  id: string;
  role: AiChatRole;
  content: string;
  movieCards?: AiMovieCard[];
  deeplinks?: AiDeeplink[];
  actions?: AiAction[];
};

export type AiChatRequestMessage = {
  role: AiChatRole;
  content: string;
};

export type AiMovieCard = Pick<Movie, 'id' | 'title' | 'poster' | 'genres' | 'vj' | 'release_date'> & {
  pitch: string;
};

export type AiDeeplink = {
  route: string;
  label: string;
  reason?: string;
};

export type AiAction = {
  type: 'verify_email' | 'reset_password';
  label: string;
  email?: string;
  reason?: string;
};

export type AiChatResponsePayload = {
  reply: string;
  movieCards: AiMovieCard[];
  deeplinks: AiDeeplink[];
  actions: AiAction[];
};

export type AiStreamEvent =
  | {
      type: 'chunk';
      text: string;
    }
  | {
      type: 'final';
      payload: AiChatResponsePayload;
    }
  | {
      type: 'error';
      message: string;
    };
