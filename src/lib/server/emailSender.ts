import { createHash } from 'crypto';
import net from 'net';
import tls from 'tls';
import { adminDb } from '@/lib/firebaseAdmin';
import type {
  TransactionalEmailLogDocument,
  TransactionalEmailType,
} from '@/types/transactionalEmail';

const EMAIL_LOGS_COLLECTION = 'transactional_email_logs';
const SMTP_TIMEOUT_MS = 15000;

type MailConfig = {
  host: string;
  port: number;
  security: string;
  user: string;
  pass: string;
  from: string;
  fromName: string;
  replyTo: string;
  supportEmail: string;
};

type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SafeTransactionalEmailInput = SendMailInput & {
  type: TransactionalEmailType;
  userId?: string;
  dedupeKey?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function encodeHeader(value: string) {
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value;
  }

  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function formatAddress(email: string, name?: string) {
  const cleanEmail = email.trim();

  if (!name?.trim()) {
    return cleanEmail;
  }

  return `"${name.replace(/"/g, '\\"')}" <${cleanEmail}>`;
}

function dotStuff(value: string) {
  return value.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function getMailConfig(): MailConfig {
  const port = Number(process.env.MAIL_PORT || 587);

  return {
    host: process.env.MAIL_HOST || '',
    port: Number.isFinite(port) ? port : 587,
    security: (process.env.MAIL_SECURITY || 'STARTTLS').toUpperCase(),
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
    from: process.env.MAIL_FROM || 'contact@ugmovies247.com',
    fromName: process.env.MAIL_FROM_NAME || 'UG Movies 247',
    replyTo: process.env.MAIL_REPLY_TO || process.env.SUPPORT_EMAIL || 'info@ugmovies247.com',
    supportEmail: process.env.SUPPORT_EMAIL || 'info@ugmovies247.com',
  };
}

export function getSupportEmail() {
  return getMailConfig().supportEmail;
}

function assertMailConfig(config: MailConfig) {
  const missing = [
    ['MAIL_HOST', config.host],
    ['MAIL_USER', config.user],
    ['MAIL_PASS', config.pass],
    ['MAIL_FROM', config.from],
  ].filter(([, value]) => !value);

  if (missing.length) {
    throw new Error(`Missing mail environment variable(s): ${missing.map(([key]) => key).join(', ')}`);
  }
}

function buildMimeMessage(input: SendMailInput, config: MailConfig) {
  const boundary = `ugmovies247-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const date = new Date().toUTCString();
  const headers = [
    `From: ${formatAddress(config.from, config.fromName)}`,
    `To: ${formatAddress(input.to)}`,
    `Reply-To: ${formatAddress(config.replyTo)}`,
    `Subject: ${encodeHeader(input.subject)}`,
    `Date: ${date}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  return `${headers.join('\r\n')}\r\n\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: text/plain; charset=UTF-8\r\n' +
    'Content-Transfer-Encoding: 8bit\r\n\r\n' +
    `${input.text}\r\n\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: text/html; charset=UTF-8\r\n' +
    'Content-Transfer-Encoding: 8bit\r\n\r\n' +
    `${input.html}\r\n\r\n` +
    `--${boundary}--\r\n`;
}

function createSmtpSession(config: MailConfig) {
  let socket: net.Socket | tls.TLSSocket = net.connect(config.port, config.host);
  socket.setTimeout(SMTP_TIMEOUT_MS);

  const cleanup = () => {
    socket.removeAllListeners();
    socket.end();
    socket.destroy();
  };

  const readResponse = () =>
    new Promise<string>((resolve, reject) => {
      let buffer = '';

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        const lastLine = lines[lines.length - 1] || '';

        if (/^\d{3}\s/.test(lastLine)) {
          socket.off('data', onData);
          socket.off('error', onError);
          socket.off('timeout', onTimeout);
          resolve(buffer);
        }
      };
      const onError = (error: Error) => {
        socket.off('data', onData);
        socket.off('timeout', onTimeout);
        reject(error);
      };
      const onTimeout = () => {
        socket.off('data', onData);
        socket.off('error', onError);
        reject(new Error('SMTP connection timed out.'));
      };

      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
    });

  const writeCommand = async (command: string, expected: number | number[]) => {
    socket.write(`${command}\r\n`);
    const response = await readResponse();
    const code = Number(response.slice(0, 3));
    const expectedCodes = Array.isArray(expected) ? expected : [expected];

    if (!expectedCodes.includes(code)) {
      throw new Error(`SMTP command failed (${command.split(' ')[0]}): ${response.trim()}`);
    }

    return response;
  };

  const upgradeToTls = async () => {
    await writeCommand('STARTTLS', 220);

    socket = tls.connect({
      socket,
      servername: config.host,
    });
    socket.setTimeout(SMTP_TIMEOUT_MS);

    await new Promise<void>((resolve, reject) => {
      const onSecure = () => {
        socket.off('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        socket.off('secureConnect', onSecure);
        reject(error);
      };

      socket.once('secureConnect', onSecure);
      socket.once('error', onError);
    });
  };

  return {
    cleanup,
    readResponse,
    writeCommand,
    upgradeToTls,
    get socket() {
      return socket;
    },
  };
}

async function sendMail(input: SendMailInput) {
  const config = getMailConfig();
  assertMailConfig(config);

  const session = createSmtpSession(config);
  const message = dotStuff(buildMimeMessage(input, config));

  try {
    await session.readResponse();
    await session.writeCommand('EHLO ugmovies247.com', 250);

    if (config.security === 'STARTTLS') {
      await session.upgradeToTls();
      await session.writeCommand('EHLO ugmovies247.com', 250);
    }

    await session.writeCommand('AUTH LOGIN', 334);
    await session.writeCommand(Buffer.from(config.user).toString('base64'), 334);
    await session.writeCommand(Buffer.from(config.pass).toString('base64'), 235);
    await session.writeCommand(`MAIL FROM:<${config.from}>`, 250);
    await session.writeCommand(`RCPT TO:<${input.to}>`, [250, 251]);
    await session.writeCommand('DATA', 354);
    session.socket.write(`${message}\r\n.\r\n`);
    const response = await session.readResponse();
    const code = Number(response.slice(0, 3));

    if (code !== 250) {
      throw new Error(`SMTP DATA failed: ${response.trim()}`);
    }

    await session.writeCommand('QUIT', 221).catch(() => '');
    return response.trim();
  } finally {
    session.cleanup();
  }
}

async function writeEmailLog(log: TransactionalEmailLogDocument) {
  if (log.dedupeKey) {
    await adminDb.collection(EMAIL_LOGS_COLLECTION).doc(sha256(log.dedupeKey)).set(log, { merge: true });
    return;
  }

  await adminDb.collection(EMAIL_LOGS_COLLECTION).add(log);
}

async function hasSentDedupeEmail(dedupeKey?: string) {
  if (!dedupeKey) {
    return false;
  }

  const snapshot = await adminDb.collection(EMAIL_LOGS_COLLECTION).doc(sha256(dedupeKey)).get();
  const data = snapshot.data() as Partial<TransactionalEmailLogDocument> | undefined;
  return data?.status === 'sent';
}

export async function sendTransactionalEmailSafely(input: SafeTransactionalEmailInput) {
  const email = input.to.trim().toLowerCase();
  const dedupeKey = input.dedupeKey || '';

  try {
    if (!email) {
      throw new Error('Missing recipient email.');
    }

    if (await hasSentDedupeEmail(dedupeKey)) {
      console.info(`Email skipped: ${input.type} to ${email} - duplicate`);
      return { ok: true, skipped: true };
    }

    const providerResponse = await sendMail(input);

    await writeEmailLog({
      userId: input.userId || '',
      email,
      type: input.type,
      status: 'sent',
      dedupeKey,
      providerResponse,
      error: '',
      createdAt: nowIso(),
    });
    console.info(`Email sent: ${input.type} to ${email}`);
    return { ok: true, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown email error.');

    await writeEmailLog({
      userId: input.userId || '',
      email,
      type: input.type,
      status: 'failed',
      dedupeKey,
      providerResponse: '',
      error: message,
      createdAt: nowIso(),
    }).catch(() => undefined);
    console.warn(`Email failed: ${input.type} to ${email} - ${message}`);
    return { ok: false, skipped: false, error: message };
  }
}
