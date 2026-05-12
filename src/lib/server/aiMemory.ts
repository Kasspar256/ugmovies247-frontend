import type { AiChatMessage } from '@/types/aiChat';
import type { DownloadRecord } from '@/types/downloads';
import type { WatchlistRecord } from '@/types/watchlist';

type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

type PgModule = {
  Pool?: new (config: Record<string, unknown>) => PgPool;
  default?: {
    Pool?: new (config: Record<string, unknown>) => PgPool;
  };
};

export type AiMemoryLibraryItem = {
  movieID: string;
  title: string;
  poster: string;
  savedAt?: string | null;
  downloadedAt?: string | null;
  status?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __ugmoviesAiMemoryPgPool: PgPool | undefined;
}

let ensuredAiMemorySchema = false;

function getNeonDatabaseUrl() {
  return String(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '').trim();
}

async function loadPgPoolConstructor() {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<PgModule>;
  const pgModule = await dynamicImport('pg');
  const PoolConstructor = pgModule.Pool || pgModule.default?.Pool;

  if (!PoolConstructor) {
    throw new Error('The pg package is installed but did not expose Pool.');
  }

  return PoolConstructor;
}

async function getPool() {
  const connectionString = getNeonDatabaseUrl();

  if (!connectionString) {
    return null;
  }

  if (!globalThis.__ugmoviesAiMemoryPgPool) {
    const PoolConstructor = await loadPgPoolConstructor();
    globalThis.__ugmoviesAiMemoryPgPool = new PoolConstructor({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: connectionString.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
    });
  }

  return globalThis.__ugmoviesAiMemoryPgPool;
}

async function ensureAiMemorySchema(pool: PgPool) {
  if (ensuredAiMemorySchema) {
    await pool.query('delete from chat_history where created_at < now() - interval \'7 days\'');
    await scrubInternalStateMessages(pool);
    return;
  }

  await pool.query(`
    create table if not exists chat_history (
      id bigserial primary key,
      user_id text not null,
      message text not null,
      sender text not null check (sender in ('user', 'ai')),
      created_at timestamptz not null default now()
    )
  `);
  await pool.query('create index if not exists chat_history_user_created_idx on chat_history (user_id, created_at desc)');
  await pool.query('create index if not exists chat_history_created_idx on chat_history (created_at)');
  await pool.query(`
    create table if not exists ai_watchlist (
      user_id text not null,
      movie_id text not null,
      title text not null,
      poster text,
      saved_at timestamptz,
      updated_at timestamptz not null default now(),
      primary key (user_id, movie_id)
    )
  `);
  await pool.query(`
    create table if not exists ai_download_list (
      user_id text not null,
      movie_id text not null,
      title text not null,
      poster text,
      status text,
      downloaded_at timestamptz,
      updated_at timestamptz not null default now(),
      primary key (user_id, movie_id)
    )
  `);
  await pool.query('create index if not exists ai_watchlist_user_saved_idx on ai_watchlist (user_id, saved_at desc)');
  await pool.query('create index if not exists ai_download_list_user_downloaded_idx on ai_download_list (user_id, downloaded_at desc)');
  await pool.query('delete from chat_history where created_at < now() - interval \'7 days\'');
  await scrubInternalStateMessages(pool);
  ensuredAiMemorySchema = true;
}

async function scrubInternalStateMessages(pool: PgPool) {
  await pool.query(
    `
      update chat_history
      set message = $1
      where sender = 'ai'
        and message ~* '(review mode|app review|play review|reviewer|hidden for review|hidden-for-review)'
    `,
    [
      "I focus on helping you find great movies and use UG Movies 247. If a feature is not available in this current version, I'll guide you to the closest available option.",
    ]
  );
}

async function withPool<T>(fallback: T, callback: (pool: PgPool) => Promise<T>) {
  const pool = await getPool();

  if (!pool) {
    return fallback;
  }

  await ensureAiMemorySchema(pool);
  return callback(pool);
}

function toIso(value: unknown) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object' && value !== null) {
    const raw = value as { seconds?: number; toDate?: () => Date };

    if (typeof raw.seconds === 'number') {
      return new Date(raw.seconds * 1000).toISOString();
    }

    if (typeof raw.toDate === 'function') {
      return raw.toDate().toISOString();
    }
  }

  return null;
}

export async function listAiChatHistory(userId: string, limit = 50) {
  return withPool<AiChatMessage[]>([], async (pool) => {
    const result = await pool.query(
      `
        select id, sender, message, created_at
        from chat_history
        where user_id = $1
        order by created_at desc
        limit $2
      `,
      [userId, Math.max(1, Math.min(limit, 50))]
    );

    return result.rows
      .reverse()
      .map((row) => ({
        id: `history-${String(row.id)}`,
        role: row.sender === 'user' ? 'user' : 'assistant',
        content: String(row.message || ''),
      }));
  });
}

export async function saveAiChatHistoryMessage(userId: string, sender: 'user' | 'ai', message: string) {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    return;
  }

  await withPool(null, async (pool) => {
    await pool.query(
      'insert into chat_history (user_id, sender, message) values ($1, $2, $3)',
      [userId, sender, trimmedMessage.slice(0, 8000)]
    );
    return null;
  });
}

export async function clearAiChatHistory(userId: string) {
  await withPool(null, async (pool) => {
    await pool.query('delete from chat_history where user_id = $1', [userId]);
    return null;
  });
}

export async function syncAiLibraryToNeon(options: {
  userId: string;
  watchlist: WatchlistRecord[];
  downloads: DownloadRecord[];
}) {
  await withPool(null, async (pool) => {
    for (const item of options.watchlist.slice(0, 100)) {
      if (!item.movieId) {
        continue;
      }

      await pool.query(
        `
          insert into ai_watchlist (user_id, movie_id, title, poster, saved_at, updated_at)
          values ($1, $2, $3, $4, $5, now())
          on conflict (user_id, movie_id) do update set
            title = excluded.title,
            poster = excluded.poster,
            saved_at = excluded.saved_at,
            updated_at = now()
        `,
        [
          options.userId,
          item.movieId,
          item.title,
          item.poster || '',
          toIso(item.savedAt),
        ]
      );
    }

    for (const item of options.downloads.slice(0, 100)) {
      if (!item.movieId) {
        continue;
      }

      await pool.query(
        `
          insert into ai_download_list (user_id, movie_id, title, poster, status, downloaded_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, now())
          on conflict (user_id, movie_id) do update set
            title = excluded.title,
            poster = excluded.poster,
            status = excluded.status,
            downloaded_at = excluded.downloaded_at,
            updated_at = now()
        `,
        [
          options.userId,
          item.movieId,
          item.title,
          item.poster || '',
          item.status || 'completed',
          toIso(item.downloadedAt),
        ]
      );
    }

    await pool.query(
      `
        delete from ai_watchlist
        where user_id = $1
          and not (movie_id = any($2::text[]))
      `,
      [options.userId, options.watchlist.map((item) => item.movieId).filter(Boolean)]
    );
    await pool.query(
      `
        delete from ai_download_list
        where user_id = $1
          and not (movie_id = any($2::text[]))
      `,
      [options.userId, options.downloads.map((item) => item.movieId).filter(Boolean)]
    );

    return null;
  });
}

export async function readAiLibraryFromNeon(userId: string) {
  return withPool(
    {
      watchlist: [] as AiMemoryLibraryItem[],
      downloads: [] as AiMemoryLibraryItem[],
    },
    async (pool) => {
      const [watchlistResult, downloadResult] = await Promise.all([
        pool.query(
          `
            select movie_id, title, poster, saved_at
            from ai_watchlist
            where user_id = $1
            order by saved_at desc nulls last, updated_at desc
            limit 50
          `,
          [userId]
        ),
        pool.query(
          `
            select movie_id, title, poster, status, downloaded_at
            from ai_download_list
            where user_id = $1
            order by downloaded_at desc nulls last, updated_at desc
            limit 50
          `,
          [userId]
        ),
      ]);

      return {
        watchlist: watchlistResult.rows.map((row) => ({
          movieID: String(row.movie_id || ''),
          title: String(row.title || ''),
          poster: String(row.poster || ''),
          savedAt: toIso(row.saved_at),
        })),
        downloads: downloadResult.rows.map((row) => ({
          movieID: String(row.movie_id || ''),
          title: String(row.title || ''),
          poster: String(row.poster || ''),
          status: String(row.status || 'completed'),
          downloadedAt: toIso(row.downloaded_at),
        })),
      };
    }
  );
}

