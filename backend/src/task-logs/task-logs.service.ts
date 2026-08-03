import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../common/roles.enum';
import { AuthUser } from '../auth/auth.service';

@Injectable()
export class TaskLogsService {
  constructor(private prisma: PrismaService) {}

  async list(user: AuthUser, taskId?: string) {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('仅管理员可查看任务日志');
    }
    const where: any = {};
    if (taskId) where.taskId = taskId;
    return this.prisma.taskLog.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
  }

  async clear(user: AuthUser, taskId?: string) {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('仅管理员可清理任务日志');
    }
    const where: any = {};
    if (taskId) where.taskId = taskId;
    return this.prisma.taskLog.deleteMany({ where });
  }
}
