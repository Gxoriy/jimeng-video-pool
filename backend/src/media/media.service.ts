import { Injectable } from '@nestjs/common';
import { mkdir, writeFile, stat, unlink, copyFile } from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { EgressService } from '../egress/egress.service';
import { NetworkScope } from '../common/roles.enum';
import { API_PREFIX } from '../common/constants';
import axios from 'axios';
import { v4 as uuid } from 'uuid';

const MIN_IMAGE_BYTES = 200; // 低于此值视为防盗链占位图/空图

/** 常见图片/视频格式的 Magic Number */
const MAGIC_SIGNATURES = [
  { sig: [0x89, 0x50, 0x4e, 0x47], ext: '.png' }, // PNG
  { sig: [0xff, 0xd8, 0xff], ext: '.jpg' }, // JPEG
  { sig: [0x52, 0x49, 0x46, 0x46], ext: '.webp' }, // RIFF -> webp
  { sig: [0x47, 0x49, 0x46, 0x38], ext: '.gif' }, // GIF
  { sig: [0x42, 0x4d], ext: '.bmp' }, // BMP
  { sig: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], ext: '.mp4' }, // ftyp
  { sig: [0x1a, 0x45, 0xdf, 0xa3], ext: '.webm' }, // EBML
];

function matchMagic(buf: Buffer): string | null {
  for (const m of MAGIC_SIGNATURES) {
    if (buf.length < m.sig.length) continue;
    let ok = true;
    for (let i = 0; i < m.sig.length; i++) {
      if (buf[i] !== m.sig[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return m.ext;
  }
  return null;
}

async function readFirstBytes(filePath: string, n: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const stream = createReadStream(filePath, { start: 0, end: n - 1 });
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * 媒体落地服务：把生成结果（URL 或 base64）自动下载/保存到本地并返回路径。
 */
@Injectable()
export class MediaService {
  constructor(
    private config: ConfigService,
    private egress: EgressService,
  ) {}

  private storageRoot(): string {
    return this.config.get<string>('app.storagePath') || './data/media';
  }

  /** 内部版：是否仍本地下载原文件。默认 true（形象图入库必须保留本地副本，避免外链过期丢图）。 */
  storeLocally(): boolean {
    return this.config.get<boolean>('app.storeMediaLocally') !== false;
  }

  private async ensureDir(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(this.storageRoot(), day);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /** 下载远程 URL 落地；若关闭本地存储则直接返回 null（仅保留 URL）
   *  @param opts.trusted 为 true 时跳过白名单 host 检查（仍拦截内网），用于后端下载已知的外部生成结果图
   *  @param opts.headers 自定义请求头，下载即梦/字节 CDN 图片时会自动补 Referer 防盗链
   */
  async download(
    url: string,
    scope: NetworkScope,
    opts?: { trusted?: boolean; headers?: Record<string, string> },
  ): Promise<string | null> {
    if (!this.storeLocally()) return null;
    if (opts?.trusted) await this.egress.assertPublic(url);
    else await this.egress.assertAllowed(url, scope);

    let localPath: string | null = null;
    try {
      const parsed = new URL(url);
      const dir = await this.ensureDir();
      const ext = this.guessExt(url);
      localPath = path.join(dir, `${uuid()}${ext}`);

      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        ...(opts?.headers || {}),
      };
      // 即梦/字节 CDN 图片需要 Referer 才能拿到真实图，否则会返回 1x1 占位图
      if (/byteimg\.com|bytedance|jimeng|iesdouyin|douyin/i.test(parsed.hostname)) {
        headers['Referer'] = headers['Referer'] || 'https://jimeng.jianying.com/ai-tool/image/generate';
      }

      const resp = await axios.get(url, {
        responseType: 'stream',
        timeout: 300000,
        headers,
        maxRedirects: 5,
      });
      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`下载失败：HTTP ${resp.status}`);
      }

      const writer = createWriteStream(localPath);
      resp.data.pipe(writer);
      await new Promise<void>((resolve, reject) => {
        writer.on('finish', () => resolve());
        writer.on('error', (e) => reject(e));
      });

      // 校验文件：过小或是占位图则视为失败
      const fileStat = await stat(localPath);
      if (fileStat.size < MIN_IMAGE_BYTES) {
        throw new Error(`下载到的文件过小(${fileStat.size}B)，疑似防盗链占位图`);
      }
      const magic = await readFirstBytes(localPath, 16);
      const detected = matchMagic(magic);
      if (!detected) {
        throw new Error('下载到的文件不是已知图片格式，可能是错误页面');
      }
      // 如果扩展名和真实 Magic 不符（如 URL 以 .png 结尾但实际是 webp），按真实格式重命名
      const realExt = detected;
      if (realExt !== ext.toLowerCase()) {
        const renamed = localPath.replace(/\.[^.]+$/, realExt);
        await copyFile(localPath, renamed);
        await unlink(localPath);
        localPath = renamed;
      }
      return localPath;
    } catch (e: any) {
      if (localPath) {
        try {
          await unlink(localPath);
        } catch {
          /* ignore cleanup error */
        }
      }
      throw e;
    }
  }

  /** 保存 base64 图片（部分网关只回 b64_json）；若关闭本地存储则返回 null */
  async saveBase64(b64: string, ext = '.png'): Promise<string | null> {
    if (!this.storeLocally()) return null;
    const dir = await this.ensureDir();
    const localPath = path.join(dir, `${uuid()}${ext}`);
    await writeFile(localPath, Buffer.from(b64, 'base64'));
    return localPath;
  }

  /** 生成某条 media 记录的可公开访问本地副本 URL（图片入库后把 url 改写为它，避免依赖外部 URL 过期） */
  serveUrl(id: string): string {
    const prefix = (this.config.get<string>('app.apiPrefix') || API_PREFIX).replace(/^\/+|\/+$/g, '');
    return `/${prefix}/media/serve/${id}`;
  }

  /** 生成某张「形象图」的可公开访问本地副本 URL（优先展示本地副本，外部 url 仅作预览） */
  characterImageServeUrl(id: string): string {
    const prefix = (this.config.get<string>('app.apiPrefix') || API_PREFIX).replace(/^\/+|\/+$/g, '');
    return `/${prefix}/media/character-image/${id}/serve`;
  }

  private guessExt(url: string): string {
    try {
      const u = new URL(url);
      const p = path.extname(u.pathname);
      if (p && p.length <= 5) return p;
    } catch {
      /* ignore */
    }
    return '.bin';
  }
}
