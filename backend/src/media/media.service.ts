import { Injectable, BadRequestException } from '@nestjs/common';
import { mkdir } from 'fs/promises';
import { createWriteStream } from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { EgressService } from '../egress/egress.service';
import { NetworkScope } from '../common/roles.enum';
import axios from 'axios';
import { v4 as uuid } from 'uuid';

/**
 * 媒体落地服务：把生成结果 URL 自动下载到本地/对象存储并登记（设计 §1 自动下载保存）。
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

  async download(url: string, scope: NetworkScope): Promise<string> {
    await this.egress.assertAllowed(url, scope);
    const root = this.storageRoot();
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(root, day);
    await mkdir(dir, { recursive: true });

    const ext = this.guessExt(url);
    const filename = `${uuid()}${ext}`;
    const localPath = path.join(dir, filename);

    const resp = await axios.get(url, { responseType: 'stream' });
    const writer = createWriteStream(localPath);
    resp.data.pipe(writer);
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => resolve());
      writer.on('error', (e) => reject(e));
    });
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
