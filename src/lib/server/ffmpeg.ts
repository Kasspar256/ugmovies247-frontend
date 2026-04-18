import { spawn } from 'child_process';

export type FfprobeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  codec_name?: string;
  pix_fmt?: string;
  channels?: number;
  profile?: string;
};

export type FfprobeFormat = {
  duration?: string;
  size?: string;
  format_name?: string;
};

export type FfprobeResult = {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
};

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  options?: {
    onStdoutChunk?: (chunk: string) => void;
    onStderrChunk?: (chunk: string) => void;
  }
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }

      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      options?.onStdoutChunk?.(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      options?.onStderrChunk?.(text);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      finished = true;

      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs}ms and was terminated.`));
        return;
      }

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      if (signal) {
        reject(
          new Error(
            `${command} was terminated by signal ${signal}: ${stderr || stdout || 'No process output was captured.'}`
          )
        );
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

export async function ffprobeMedia(inputPath: string) {
  const result = await runProcess(
    process.env.FFPROBE_PATH || 'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', inputPath],
    1000 * 60
  );

  return JSON.parse(result.stdout) as FfprobeResult;
}

export async function runFfmpeg(args: string[], timeoutMs: number) {
  return runProcess(process.env.FFMPEG_PATH || 'ffmpeg', args, timeoutMs);
}

function createFfmpegProgressReader(options?: {
  durationSeconds?: number;
  onProgress?: (progressPercent: number) => void | Promise<void>;
}) {
  if (!options?.onProgress || !options.durationSeconds || options.durationSeconds <= 0) {
    return undefined;
  }

  let buffered = '';
  let lastReportedPercent = -1;
  const totalDurationMs = options.durationSeconds * 1000;

  return (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed.startsWith('out_time_ms=')) {
        continue;
      }

      const rawValue = Number(trimmed.split('=')[1] || 0);

      if (!Number.isFinite(rawValue) || rawValue <= 0) {
        continue;
      }

      const progressPercent = Math.max(
        0,
        Math.min(100, Math.round((rawValue / 1000 / totalDurationMs) * 100))
      );

      if (progressPercent <= lastReportedPercent) {
        continue;
      }

      lastReportedPercent = progressPercent;
      void Promise.resolve(options.onProgress(progressPercent)).catch(() => undefined);
    }
  };
}

export async function runFfmpegWithProgress(options: {
  args: string[];
  timeoutMs: number;
  durationSeconds?: number;
  onProgress?: (progressPercent: number) => void | Promise<void>;
}) {
  const progressReader = createFfmpegProgressReader({
    durationSeconds: options.durationSeconds,
    onProgress: options.onProgress,
  });

  return runProcess(
    process.env.FFMPEG_PATH || 'ffmpeg',
    progressReader
      ? ['-progress', 'pipe:1', '-nostats', ...options.args]
      : options.args,
    options.timeoutMs,
    progressReader
      ? {
          onStdoutChunk: progressReader,
        }
      : undefined
  );
}

export async function convertVideoToMp4(
  inputPath: string,
  outputPath: string,
  timeoutMs: number,
  options?: {
    durationSeconds?: number;
    onProgress?: (progressPercent: number) => void | Promise<void>;
  }
) {
  return runFfmpegWithProgress({
    timeoutMs,
    durationSeconds: options?.durationSeconds,
    onProgress: options?.onProgress,
    args: [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-sn',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '21',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-b:a',
      '160k',
      outputPath,
    ],
  });
}

export async function rewriteMp4ForStreaming(
  inputPath: string,
  outputPath: string,
  timeoutMs: number,
  options?: {
    durationSeconds?: number;
    onProgress?: (progressPercent: number) => void | Promise<void>;
  }
) {
  return runFfmpegWithProgress({
    timeoutMs,
    durationSeconds: options?.durationSeconds,
    onProgress: options?.onProgress,
    args: [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      '-sn',
      outputPath,
    ],
  });
}
