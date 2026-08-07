import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    try {
      await this.$connect();
      console.log('[Prisma] 数据库连接成功');
    } catch (e) {
      // 不阻塞启动：让应用起来后通过 /api/health 暴露 db:false，
      // 前端/启动器可明确提示用户检查 .env 的 DATABASE_URL。
      console.error(
        '[Prisma] 数据库连接失败，请检查 .env 的 DATABASE_URL 是否指向可达的 PostgreSQL：',
        (e as Error)?.message,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
