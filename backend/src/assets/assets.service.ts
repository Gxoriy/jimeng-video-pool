import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SyncAssetItem {
  url: string;
  kind?: string;
  title?: string;
  description?: string;
  tags?: string[];
  workInfo?: any;
  source?: string;
}

/**
 * 素材索引服务：仅维护 URL + 文本工作信息（不再本地存原文件）。
 * 数据由后端通过 /api/assets/sync 全量同步写入，不向前端暴露写接口。
 */
@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 全量同步：按 url upsert。
   * 传入的 items 即“当前应存在的全部素材”，调用方可自行决定全量覆盖或增量。
   */
  async sync(items: SyncAssetItem[]) {
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const it of items || []) {
      const url = (it?.url || '').trim();
      if (!url) {
        skipped++;
        continue;
      }
      try {
        const existing = await this.prisma.asset.findUnique({ where: { url } });
        if (existing) {
          await this.prisma.asset.update({
            where: { url },
            data: {
              kind: it.kind ?? existing.kind,
              title: it.title ?? existing.title,
              description: it.description ?? existing.description,
              tags: it.tags ?? existing.tags,
              workInfo: it.workInfo ?? existing.workInfo,
              source: it.source ?? existing.source,
            },
          });
          updated++;
        } else {
          await this.prisma.asset.create({
            data: {
              url,
              kind: it.kind || 'image',
              title: it.title || null,
              description: it.description || null,
              tags: it.tags || [],
              workInfo: it.workInfo || null,
              source: it.source || null,
            },
          });
          created++;
        }
      } catch (e: any) {
        this.logger.warn(`同步素材失败 ${url}: ${e?.message}`);
        skipped++;
      }
    }

    return { total: items?.length || 0, created, updated, skipped };
  }

  /** 供 super_admin 在运维面板查看当前素材索引（可选） */
  async list(kind?: string) {
    return this.prisma.asset.findMany({
      where: kind ? { kind } : {},
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}
