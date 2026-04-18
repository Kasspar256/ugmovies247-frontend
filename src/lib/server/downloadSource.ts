import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'http';
import https from 'https';
import net from 'net';
import path from 'path';
import { lookup } from 'dns/promises';
import { pipeline } from 'stream/promises';
import {
  DIRECT_URL_IMPORT_MAX_FILE_SIZE_BYTES,
  DIRECT_URL_IMPORT_PROBE_TIMEOUT_MS,
} from './env';
import { ensureParentDir } from './fsUtils';
import { downloadR2ObjectToFile, getR2ObjectKeyFromPublicUrl } from './r2';

const REMOTE_DOWNLOAD_TIMEOUT_MS = Number(
  process.env.REMOTE_DOWNLOAD_TIMEOUT_MS || 1000 * 60 * 60 * 4
);
const REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS = Number(
  process.env.REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS || 1000 * 60 * 10
);
const REMOTE_DOWNLOAD_MAX_REDIRECTS = Number(process.env.REMOTE_DOWNLOAD_MAX_REDIRECTS || 5);

type SafeRemoteRequestOptions = {
  method: 'HEAD' | 'GET';
  headers?: Record<string, string>;
  timeoutMs: number;
  maxRedirects?: number;
};

export type DirectMp4ImportValidation = {
  finalUrl: string;
  sourceFileName: string;
  contentType: string;
  contentLength: number | null;
  warningMessage?: string;
};

export type RemoteDownloadProgress = {
  downloadedBytes: number;
  totalBytes: number | null;
  progressPercent: number | null;
};

function getHttpModule(url: URL) {
  return url.protocol === 'https:' ? https : http;
}

function isRedirect(statusCode?: number) {
  return Boolean(statusCode && [301, 302, 303, 307, 308].includes(statusCode));
}

function getLowerCaseHeaderValue(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return String(value[0] || '').trim().toLowerCase();
  }

  return String(value || '').trim().toLowerCase();
}

function getHeaderValue(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }

  return String(value || '').trim();
}

function parseContentLength(headers: IncomingHttpHeaders) {
  const rawValue = getHeaderValue(headers, 'content-length');

  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function decodePathnameFileName(url: URL) {
  const decoded = decodeURIComponent(url.pathname || '/');
  const lastSegment = decoded.split('/').filter(Boolean).pop() || '';
  return lastSegment || 'source.mp4';
}

function looksLikeDirectMp4Url(url: URL) {
  return decodeURIComponent(url.pathname || '').toLowerCase().endsWith('.mp4');
}

function looksLikeMp4FileSignature(sample: Buffer | null | undefined) {
  if (!sample || sample.length < 12) {
    return false;
  }

  return sample.subarray(4, 8).toString('ascii').toLowerCase() === 'ftyp';
}

function normalizeFormatName(value: string) {
  return value
    .toLowerCase()
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isLikelyPrivateHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home') ||
    normalized.endsWith('.lan')
  );
}

function isPrivateIpv4(address: string) {
  const octets = address.split('.').map((part) => Number(part));

  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function expandIpv6Address(address: string) {
  const [headPart, tailPart = ''] = address.toLowerCase().split('::');
  const head = headPart ? headPart.split(':').filter(Boolean) : [];
  const tail = tailPart ? tailPart.split(':').filter(Boolean) : [];

  if (head.length + tail.length > 8) {
    return null;
  }

  const missingGroups = 8 - head.length - tail.length;
  const expanded = [
    ...head,
    ...Array.from({ length: missingGroups }, () => '0'),
    ...tail,
  ].map((group) => group.padStart(4, '0'));

  return expanded.length === 8 ? expanded : null;
}

function isPrivateIpv6(address: string) {
  const expanded = expandIpv6Address(address);

  if (!expanded) {
    return true;
  }

  const firstGroup = Number.parseInt(expanded[0] || '0', 16);
  const secondGroup = Number.parseInt(expanded[1] || '0', 16);

  return (
    address === '::' ||
    address === '::1' ||
    (firstGroup & 0xfe00) === 0xfc00 ||
    (firstGroup === 0xfe80 && (secondGroup & 0xfc00) === 0) ||
    firstGroup === 0xff00
  );
}

function isPrivateOrReservedIp(address: string) {
  const version = net.isIP(address);

  if (version === 4) {
    return isPrivateIpv4(address);
  }

  if (version === 6) {
    return isPrivateIpv6(address);
  }

  return true;
}

async function assertSafeRemoteUrlTarget(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https source links are supported.');
  }

  if (isLikelyPrivateHostname(url.hostname)) {
    throw new Error('Localhost and internal source URLs are not allowed.');
  }

  if (net.isIP(url.hostname)) {
    if (isPrivateOrReservedIp(url.hostname)) {
      throw new Error('Private, internal, link-local, and metadata IP targets are not allowed.');
    }

    return;
  }

  const resolvedAddresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(
    () => []
  );

  if (!resolvedAddresses.length) {
    throw new Error('The source host could not be resolved from the VPS.');
  }

  if (resolvedAddresses.some((entry) => isPrivateOrReservedIp(entry.address))) {
    throw new Error('The source host resolved to a private or internal network address.');
  }
}

function validateDirectMp4Headers(
  remoteUrl: URL,
  headers: IncomingHttpHeaders,
  maxFileSizeBytes: number,
  sampleBytes?: Buffer | null,
  options?: { allowAmbiguousBinaryHeaders?: boolean }
) {
  const contentType = getLowerCaseHeaderValue(headers, 'content-type');
  const contentLength = parseContentLength(headers);
  const isOctetStream = contentType.includes('application/octet-stream');
  const isVideoMp4 = contentType.includes('video/mp4');
  const isApplicationMp4 = contentType.includes('application/mp4');
  const isQuicktime = contentType.includes('video/quicktime');
  const isPathMp4 = looksLikeDirectMp4Url(remoteUrl);
  const sampleLooksLikeMp4 = looksLikeMp4FileSignature(sampleBytes);
  const clearlyUnsupportedContentType =
    contentType.includes('text/') ||
    contentType.includes('application/json') ||
    contentType.includes('application/xml') ||
    contentType.includes('text/html') ||
    contentType.includes('image/');

  if (clearlyUnsupportedContentType) {
    throw new Error('Only direct MP4 source links are supported.');
  }

  if (!isVideoMp4 && !isApplicationMp4 && !isQuicktime && !isPathMp4 && !sampleLooksLikeMp4) {
    if ((!contentType || isOctetStream) && options?.allowAmbiguousBinaryHeaders) {
      return {
        contentType,
        contentLength,
      };
    }

    if (!contentType || isOctetStream) {
      throw new Error('Only direct MP4 source links are supported.');
    }

    throw new Error('Only direct MP4 source links are supported.');
  }

  if (contentLength !== null && contentLength > maxFileSizeBytes) {
    throw new Error(
      `The source file is too large. Maximum supported size is ${Math.round(
        maxFileSizeBytes / (1024 * 1024 * 1024)
      )} GB.`
    );
  }

  return {
    contentType,
    contentLength,
  };
}

async function withSafeRemoteResponse<T>(
  remoteUrl: string,
  options: SafeRemoteRequestOptions,
  handler: (input: { response: IncomingMessage; finalUrl: string }) => Promise<T> | T,
  redirectCount = 0
): Promise<T> {
  if (redirectCount > (options.maxRedirects ?? REMOTE_DOWNLOAD_MAX_REDIRECTS)) {
    throw new Error(`Too many redirects while validating or downloading ${remoteUrl}.`);
  }

  const parsedUrl = new URL(remoteUrl);
  await assertSafeRemoteUrlTarget(parsedUrl);
  const httpModule = getHttpModule(parsedUrl);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const request = httpModule.request(
      parsedUrl,
      {
        method: options.method,
        headers: options.headers,
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;

        if (isRedirect(statusCode) && location) {
          response.resume();

          const redirectUrl = new URL(location, parsedUrl).toString();
          withSafeRemoteResponse(redirectUrl, options, handler, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(
            new Error(
              `The source server responded with ${statusCode}${response.statusMessage ? ` ${response.statusMessage}` : ''}.`
            )
          );
          return;
        }

        Promise.resolve(handler({ response, finalUrl: parsedUrl.toString() }))
          .then((value) => {
            settled = true;
            resolve(value);
          })
          .catch((error) => {
            response.resume();
            settled = true;
            reject(error);
          });
      }
    );
    const overallTimeout = setTimeout(() => {
      request.destroy(
        new Error(`The source request exceeded ${options.timeoutMs} ms before completing.`)
      );
    }, options.timeoutMs);

    request.setTimeout(REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS, () => {
      request.destroy(
        new Error(
          `The source request stalled for more than ${REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS} ms.`
        )
      );
    });

    request.on('error', (error) => {
      clearTimeout(overallTimeout);
      if (!settled) {
        reject(error);
      }
    });

    request.on('close', () => {
      clearTimeout(overallTimeout);
    });

    request.end();
  });
}

async function readResponseSample(response: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of response) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(bufferChunk);
    totalBytes += bufferChunk.length;

    if (totalBytes >= maxBytes) {
      break;
    }
  }

  return Buffer.concat(chunks).subarray(0, maxBytes);
}

function buildDirectMp4ValidationResult(
  finalUrl: string,
  headers: IncomingHttpHeaders,
  maxFileSizeBytes: number,
  sampleBytes?: Buffer | null
): DirectMp4ImportValidation {
  const parsedUrl = new URL(finalUrl);
  const { contentType, contentLength } = validateDirectMp4Headers(
    parsedUrl,
    headers,
    maxFileSizeBytes,
    sampleBytes
  );

  return {
    finalUrl,
    sourceFileName: decodePathnameFileName(parsedUrl),
    contentType,
    contentLength,
    warningMessage:
      parsedUrl.protocol === 'http:'
        ? 'HTTPS is strongly recommended for direct movie imports because the source travels over plain HTTP.'
        : undefined,
  };
}

export async function validateDirectMp4ImportSource(
  remoteUrl: string,
  options?: { maxFileSizeBytes?: number }
): Promise<DirectMp4ImportValidation> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(remoteUrl);
  } catch {
    throw new Error('Enter a valid direct MP4 URL.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http and https source links are supported.');
  }

  const maxFileSizeBytes = options?.maxFileSizeBytes || DIRECT_URL_IMPORT_MAX_FILE_SIZE_BYTES;

  try {
    return await withSafeRemoteResponse(
      parsedUrl.toString(),
      {
        method: 'HEAD',
        timeoutMs: DIRECT_URL_IMPORT_PROBE_TIMEOUT_MS,
      },
      async ({ response, finalUrl }) => {
        response.resume();
        return buildDirectMp4ValidationResult(finalUrl, response.headers, maxFileSizeBytes);
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown source validation error.';

    if (
      !/localhost and internal|private or internal|could not be resolved|only http and https|valid direct mp4 url|maximum supported size/i.test(
        message.toLowerCase()
      )
    ) {
      return withSafeRemoteResponse(
        parsedUrl.toString(),
        {
        method: 'GET',
        headers: {
            Range: 'bytes=0-4095',
        },
        timeoutMs: DIRECT_URL_IMPORT_PROBE_TIMEOUT_MS,
      },
        async ({ response, finalUrl }) => {
          const sampleBytes = await readResponseSample(response, 4096);
          return buildDirectMp4ValidationResult(
            finalUrl,
            response.headers,
            maxFileSizeBytes,
            sampleBytes
          );
        }
      );
    }

    throw error;
  }
}

async function downloadToFile(
  remoteUrl: string,
  targetPath: string,
  options?: {
    maxFileSizeBytes?: number;
    onProgress?: (progress: RemoteDownloadProgress) => void | Promise<void>;
  }
): Promise<void> {
  const maxFileSizeBytes = options?.maxFileSizeBytes || DIRECT_URL_IMPORT_MAX_FILE_SIZE_BYTES;

  await withSafeRemoteResponse(
    remoteUrl,
    {
      method: 'GET',
      timeoutMs: REMOTE_DOWNLOAD_TIMEOUT_MS,
    },
    async ({ response, finalUrl }) => {
      const parsedUrl = new URL(finalUrl);
      validateDirectMp4Headers(parsedUrl, response.headers, maxFileSizeBytes, null, {
        allowAmbiguousBinaryHeaders: true,
      });

      const writeStream = createWriteStream(targetPath);
      let downloadedBytes = 0;
      const totalBytes = parseContentLength(response.headers);
      let lastReportedPercent = -1;
      let lastReportedBytes = 0;
      let lastReportedAt = 0;
      const overallTimeout = setTimeout(() => {
        response.destroy(
          new Error(`Remote source download exceeded ${REMOTE_DOWNLOAD_TIMEOUT_MS} ms.`)
        );
      }, REMOTE_DOWNLOAD_TIMEOUT_MS);

      const reportProgress = (force = false) => {
        if (!options?.onProgress) {
          return;
        }

        const now = Date.now();
        const progressPercent =
          totalBytes && totalBytes > 0
            ? Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)))
            : null;

        const hasMeaningfulByteAdvance = downloadedBytes - lastReportedBytes >= 5 * 1024 * 1024;
        const hasMeaningfulPercentAdvance =
          progressPercent !== null && progressPercent >= lastReportedPercent + 1;
        const hasWaitedLongEnough = now - lastReportedAt >= 5000;

        if (!force && !hasMeaningfulByteAdvance && !hasMeaningfulPercentAdvance && !hasWaitedLongEnough) {
          return;
        }

        lastReportedPercent = progressPercent ?? lastReportedPercent;
        lastReportedBytes = downloadedBytes;
        lastReportedAt = now;

        void Promise.resolve(
          options.onProgress({
            downloadedBytes,
            totalBytes,
            progressPercent,
          })
        ).catch(() => undefined);
      };

      response.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;

        if (downloadedBytes > maxFileSizeBytes) {
          response.destroy(
            new Error(
              `The source file exceeded the maximum supported size of ${Math.round(
                maxFileSizeBytes / (1024 * 1024 * 1024)
              )} GB while downloading.`
            )
          );
        }

        reportProgress(false);
      });

      response.setTimeout(REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS, () => {
        response.destroy(
          new Error(
            `Remote source download stalled for more than ${REMOTE_DOWNLOAD_INACTIVITY_TIMEOUT_MS} ms.`
          )
        );
      });

      try {
        await pipeline(response, writeStream);
        reportProgress(true);
      } finally {
        clearTimeout(overallTimeout);
      }
    }
  );
}

export async function downloadRemoteSource(
  remoteUrl: string,
  targetPath: string,
  options?: {
    maxFileSizeBytes?: number;
    onProgress?: (progress: RemoteDownloadProgress) => void | Promise<void>;
  }
) {
  await ensureParentDir(targetPath);
  const r2ObjectKey = getR2ObjectKeyFromPublicUrl(remoteUrl);

  if (r2ObjectKey) {
    await downloadR2ObjectToFile({
      key: r2ObjectKey,
      targetPath,
    });
  } else {
    await downloadToFile(remoteUrl, targetPath, options);
  }

  const stats = await fs.stat(targetPath);

  return {
    path: targetPath,
    fileSizeBytes: stats.size,
    sourceFileName: path.basename(targetPath),
  };
}

export function isSupportedInputMp4Format(formatName: string) {
  const normalizedFormats = normalizeFormatName(formatName);
  return normalizedFormats.includes('mp4') || normalizedFormats.includes('mov');
}
