import { execFile } from 'child_process';
import { promisify } from 'util';
import { ConfigService } from '@nestjs/config';

const exec = promisify(execFile);

/**
 * 用 ffprobe 读取音频时长（秒）。
 * 失败（ffprobe 未安装 / 文件损坏）返回 null，由调用方决定兜底策略。
 */
export async function probeDurationSec(
  localPath: string,
  config?: ConfigService,
): Promise<number | null> {
  const bin = config?.get<string>('app.ffprobePath') || 'ffprobe';
  try {
    const { stdout } = await exec(
      bin,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=nw=1:nk=1',
        localPath,
      ],
      { timeout: 15000, windowsHide: true },
    );
    const n = parseFloat(stdout.trim());
    return isNaN(n) ? null : Math.round(n);
  } catch {
    return null;
  }
}
