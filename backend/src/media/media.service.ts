import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { createWriteStream } from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { EgressService } from '../egress/egress.service';
import { NetworkScope } from '../common/roles.enum';
import axios from 'axios';
import { v4 as uuid } from 'uuid';

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

  private async ensureDir(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(this.storageRoot(), day);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /** 下载远程 URL 落地 */
  async download(url: string, scope: NetworkScope): Promise<string> {
    await this.egress.assertAllowed(url, scope);
    const dir = await this.ensureDir();
    const localPath = path.join(dir, `${uuid()}${this.guessExt(url)}`);

    const resp = await axios.get(url, { responseType: 'stream', timeout: 300000 });
    const writer = createWriteStream(localPath);
    resp.data.pipe(writer);
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => resolve());
      writer.on('error', (e) => reject(e));
    });
    return localPath;
  }

  /** 保存 base64 图片（部分网关只回 b64_json） */
  async saveBase64(b64: string, ext = '.png'): Promise<string> {
    const dir = await this.ensureDir();
    const localPath = path.join(dir, `${uuid()}${ext}`);
    await writeFile(localPath, Buffer.from(b64, 'base64'));
    return localPath;
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
