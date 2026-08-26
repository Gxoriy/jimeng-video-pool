import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles.enum';

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.bin': 'application/octet-stream',
};

/**
 * 素材库（media 表）查询接口。
 * 所有生成任务产出的图片/视频都会落 media 表，这里按类型分页读取，
 * 支撑前端「视频素材库」等页面。列表登录可见；删除仅超级管理员。
 *
 * 另提供 /media/serve/:id：把已落盘的本地副本按字节流式返回，供前端 / 视频生成引用，
 * 避免依赖外部图床 URL（过期/防盗链导致丢失）。该端点刻意不设鉴权（与 /files 静态目录同理），
 * 浏览器 <img> 直接加载。
 */
@Controller('media')
export class MediaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(
    @Query('type') type?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(1, parseInt(String(page), 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(String(pageSize), 10) || 20));
    const where = type ? { type } : {};
    const [total, rows] = await Promise.all([
      this.prisma.media.count({ where }),
      this.prisma.media.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
        include: { task: { select: { prompt: true, model: true, type: true } } },
      }),
    ]);
    return { code: 0, message: 'ok', data: { data: rows, total, page: p, pageSize: ps } };
  }

  @Get('serve/:id')
  async serve(@Param('id') id: string): Promise<StreamableFile> {
    const row = await this.prisma.media.findUnique({ where: { id } });
    if (!row || !row.localPath) throw new NotFoundException('素材不存在或没有本地副本');
    // 轻量存在性校验（避免把异常抛给流）
    const fs = await import('fs/promises');
    try {
      await fs.access(row.localPath);
    } catch {
      throw new NotFoundException('本地文件不存在');
    }
    const ext = path.extname(row.localPath).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    return new StreamableFile(createReadStream(row.localPath), {
      type: mime,
      disposition: 'inline',
    });
  }

  /**
   * 形象图的本地副本按字节流式返回。刻意不设鉴权（与 serve 同理），
   * 浏览器 <img> 直接加载，使形象库优先展示服务器本地副本、外部 url 仅作预览，
   * 避免图床 URL 过期/防盗链导致同事端丢图。仅当该图确有 localPath 时才返回。
   */
  @Get('character-image/:id/serve')
  async serveCharacterImage(@Param('id') id: string): Promise<StreamableFile> {
    const img = await this.prisma.characterImage.findUnique({ where: { id } });
    if (!img || !img.localPath) throw new NotFoundException('形象图不存在或没有本地副本');
    const fs = await import('fs/promises');
    try {
      await fs.access(img.localPath);
    } catch {
      throw new NotFoundException('本地文件不存在');
    }
    const ext = path.extname(img.localPath).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    return new StreamableFile(createReadStream(img.localPath), {
      type: mime,
      disposition: 'inline',
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  async remove(@Param('id') id: string) {
    const row = await this.prisma.media.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('素材不存在');
    await this.prisma.media.delete({ where: { id } });
    return { code: 0, message: 'ok', data: { id } };
  }
}
