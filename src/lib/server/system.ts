import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export async function getFreeDiskSpace(targetPath: string) {
  if (process.platform === 'win32') {
    const root = path.parse(targetPath).root.replace(/\\$/, '');
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      `(Get-PSDrive -Name '${root.replace(':', '')}').Free`,
    ]);

    return Number(stdout.trim());
  }

  const { stdout } = await execFileAsync('df', ['-k', targetPath]);
  const lines = stdout.trim().split(/\r?\n/);
  const lastLine = lines[lines.length - 1]?.trim().split(/\s+/);

  return Number(lastLine?.[3] || 0) * 1024;
}
