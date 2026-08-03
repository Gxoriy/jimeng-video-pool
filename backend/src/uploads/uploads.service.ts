import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.service';
import { Role } from '../common/roles.enum';

const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif|bmp)$/i;
const AUDIO_MIME = /^audio\/(mpeg|mp3|wav|x-wav|ogg|aac|flac|mp4|x-m4a)$/i;

/**
 * 用户上传的参考图 / 参考音频。
 * 严格按 user_id 隔离：用户只能列出与使用自己上传的文件。
 */
@Injectable()
export class UploadsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private root(): string {
    return this.config.get<string>('app.uploadPath') || './data/uploads';
  }

  private publicUrl(id: string): string {
    const base = (this.config.get<string>('app.publicBaseUrl') || '').replace(/\/$/, '');
    return `${base}/api/files/${id}`;
  }

  async save(user: AuthUser, kind: 'image' | 'audio', file: Express.Multer.File) {
    if (!file) throw new BadRequestException('未收到文件');
    if (kind === 'image' && !IMAGE_MIME.test(file.mimetype)) {
      throw new BadRequestException(`不支持的图片类型：${file.mimetype}`);
    }
    if (kind === 'audio' && !AUDIO_MIME.test(file.mimetype)) {
      throw new BadRequestException(`不支持的音频类型：${file.mimetype}`);
    }

    const id = uuid();
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(this.root(), day);
    await mkdir(dir, { recursive: true });

    const ext = path.extname(file.originalname) || (kind === 'image' ? '.png' : '.mp3');
    const localPath = path.join(dir, `${id}${ext}`);
    await writeFile(localPath, file.buffer);

    return this.prisma.upload.create({
      data: {
        id,
        userId: user.id,
        kind,
        filename: file.originalname,
        localPath,
        url: this.publicUrl(id),
        size: file.size,
        mimeType: file.mimetype,
      },
    });
  }

  /** 列出自己上传的文件（管理员可看全部） */
  async list(user: AuthUser, kind?: string) {
    return this.prisma.upload.findMany({
      where: {
        ...(user.role === Role.SUPER_ADMIN ? {} : { userId: user.id }),
        ...(kind ? { kind } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** 读取文件元信息（用于静态下发，含隔离校验） */
  async getForServe(user: AuthUser, id: string) {
    const up = await this.prisma.upload.findUnique({ where: { id } });
    if (!up) throw new NotFoundException('文件不存在');
    if (user.role !== Role.SUPER_ADMIN && up.userId !== user.id) {
      throw new NotFoundException('文件不存在');
    }
    return up;
  }

  async remove(user: AuthUser, id: string) {
    const up = await this.getForServe(user, id);
    await this.prisma.upload.delete({ where: { id: up.id } });
    return { id: up.id };
  }
}
