import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles.enum';

/**
 * 素材库（media 表）查询接口。
 * 所有生成任务产出的图片/视频都会落 media 表，这里按类型分页读取，
 * 支撑前端「视频素材库」等页面。列表登录可见；删除仅超级管理员。
 */
@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
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

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  async remove(@Param('id') id: string) {
    const row = await this.prisma.media.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('素材不存在');
    await this.prisma.media.delete({ where: { id } });
    return { code: 0, message: 'ok', data: { id } };
  }
}
