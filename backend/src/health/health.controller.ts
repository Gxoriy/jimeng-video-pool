import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 健康检查 —— 供 Electron 启动器窗口轮询，判断：
 *  - 后端是否就绪（能响应）
 *  - 数据库是否连通（db 字段）
 * 无需鉴权。路由：GET /api/health
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    return {
      code: 0,
      message: 'ok',
      data: { db, time: new Date().toISOString() },
    };
  }
}
