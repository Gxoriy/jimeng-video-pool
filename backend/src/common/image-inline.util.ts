import { readFile, stat, unlink } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

// 自带静态 ffmpeg 二进制，避免依赖系统 PATH 上的 ffmpeg（生产机常缺失）。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegStatic: string | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('ffmpeg-static') as string;
  } catch {
    return null;
  }
})();

const execFileAsync = promisify(execFile);

/** 默认内联目标体积（KB，base64 后） */
export const DEFAULT_INLINE_TARGET_KB = 180;

const RASTER_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];

/** 解析实际使用的 ffmpeg 可执行文件路径（配置优先，其次内置二进制，最后 PATH） */
export function resolveFfmpegBin(configured?: string | null): string {
  return configured || ffmpegStatic || 'ffmpeg';
}

/** 内置 ffmpeg-static 是否可用（供启动自检打印） */
export function ffmpegStaticPath(): string | null {
  return ffmpegStatic;
}

/** 根据扩展名推断 mime（用于未压缩直读场景） */
export function mimeOf(localPath: string): string {
  const ext = (path.extname(localPath) || '.png').slice(1).toLowerCase();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp',
    }[ext] || 'image/png'
  );
}

/**
 * 用 ffmpeg 把图片等比缩小再转 JPEG，避免内联 base64 过大触发网关 413。
 * 逐级尝试 1024→864→720→576→448→360，返回首个 ≤ 目标体积的临时文件路径；
 * ffmpeg 不可用 / 非位图时返回 null（调用方回退原图）。
 * 返回的临时文件由调用方负责删除。
 */
export async function downscaleToJpeg(
  localPath: string,
  targetKB = DEFAULT_INLINE_TARGET_KB,
  ffmpegPath?: string | null,
): Promise<string | null> {
  const ext = path.extname(localPath).toLowerCase();
  if (!RASTER_EXT.includes(ext)) return null;
  const bin = resolveFfmpegBin(ffmpegPath);
  // base64 膨胀约 4/3，反推二进制上限
  const maxBytes = Math.round((targetKB * 1024 * 3) / 4);
  let prev: string | null = null;
  for (const w of [1024, 864, 720, 576, 448, 360]) {
    const tmp = path.join(
      os.tmpdir(),
      `aiimg-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    );
    try {
      await execFileAsync(
        bin,
        ['-y', '-loglevel', 'error', '-i', localPath, '-vf', `scale='min(${w},iw)':-2`, '-q:v', '6', tmp],
        { timeout: 20000, windowsHide: true },
      );
      const st = await stat(tmp);
      if (st.size === 0) {
        await unlink(tmp).catch(() => {});
        return prev;
      }
      if (st.size <= maxBytes) {
        if (prev) await unlink(prev).catch(() => {});
        return tmp;
      }
      if (prev) await unlink(prev).catch(() => {});
      prev = tmp;
    } catch {
      await unlink(tmp).catch(() => {});
      return prev;
    }
  }
  return prev; // 仍可能略超，但已是最小档
}

export interface InlineResult {
  /** data:<mime>;base64,... */
  dataUri: string;
  /** base64 字符串体积（KB） */
  kb: number;
  /** 是否经过降采样 */
  downscaled: boolean;
}

/**
 * 把本地图片转成 data URI 内联给 vision 网关。
 * 外部网关直接读取内联字节，无需回拉服务器地址，规避
 * 「相对地址 / PUBLIC_BASE_URL 未配 / 网关拉不到图」导致的 100007 / 502。
 * 同时做降采样，规避 413（request body too large）。
 */
export async function inlineImageDataUri(
  localPath: string,
  opts: { targetKB?: number; ffmpegPath?: string | null; mimeType?: string | null } = {},
): Promise<InlineResult> {
  const targetKB = opts.targetKB || DEFAULT_INLINE_TARGET_KB;
  const resized = await downscaleToJpeg(localPath, targetKB, opts.ffmpegPath);
  if (!resized) {
    // ffmpeg 未生效（缺失/不可用/非位图）：原图偏大时会触发网关 413，打印告警便于排查
    try {
      const orig = await stat(localPath);
      if (orig.size > 1_000_000) {
        console.warn(
          `[image-inline] ffmpeg 降采样未生效，将内联原图(${(orig.size / 1024 / 1024).toFixed(1)}MB)，可能触发 413。` +
            `请确认 ffmpeg-static 已安装（npm install）或配置 FFMPEG_PATH。`,
        );
      }
    } catch {
      /* ignore */
    }
  }
  const file = resized || localPath;
  try {
    const buf = await readFile(file);
    const mime = resized ? 'image/jpeg' : opts.mimeType || mimeOf(localPath);
    const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
    return {
      dataUri,
      kb: Math.round(dataUri.length / 1024),
      downscaled: !!resized,
    };
  } finally {
    if (resized && resized !== localPath) await unlink(resized).catch(() => {});
  }
}
