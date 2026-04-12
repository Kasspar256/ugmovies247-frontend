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

function runProcess(command: string, args: string[], timeoutMs: number) {
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
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
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

export async function convertVideoToMp4(inputPath: string, outputPath: string, timeoutMs: number) {
  return runFfmpeg(
    [
      '-y',
      '-i',
      inputPath,
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
      '-b:a',
      '160k',
      outputPath,
    ],
    timeoutMs
  );
}

export async function rewriteMp4ForStreaming(
  inputPath: string,
  outputPath: string,
  timeoutMs: number
) {
  return runFfmpeg(
    [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      '-sn',
      outputPath,
    ],
    timeoutMs
  );
}
