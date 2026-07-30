import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../common/roles.enum';
import { AuthUser } from '../auth/auth.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { TaskType, TaskStatus } from '../common/roles.enum';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  /**
   * 任务列表：按用户隔离（设计 §5.3 / §7）。
   * super_admin 可见全部（含状态/结果 URL 日志），普通用户只能看自己的。
   */
  async list(user: AuthUser, dto: PaginationDto) {
    const isAdmin = user.role === Role.SUPER_ADMIN;
    const where: any = {
      ...(isAdmin ? {} : { userId: user.id }),
      ...(dto.q ? { prompt: { contains: dto.q } } : {}),
      ...(dto.type ? { type: dto.type as TaskType } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
        orderBy: this.order(dto.sort, dto.order),
        include: { media: true, user: isAdmin ? { select: { id: true, username: true } } : false },
      }),
      this.prisma.task.count({ where }),
    ]);
    return { data, total, page: dto.page, pageSize: dto.pageSize };
  }

  async get(user: AuthUser, id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: { media: true },
    });
    if (!task) throw new NotFoundException('任务不存在');
    // 隔离：普通用户只能看自己的（结果 URL 等日志信息）
    if (user.role !== Role.SUPER_ADMIN && task.userId !== user.id) {
      throw new ForbiddenException('无权查看该任务');
    }
    return task;
  }

  async remove(user: AuthUser, id: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在');
    if (user.role !== Role.SUPER_ADMIN && task.userId !== user.id) {
      throw new ForbiddenException('无权删除该任务');
    }
    await this.prisma.task.delete({ where: { id } });
    return { id };
  }

  private order(sort?: string, order?: string) {
    if (sort) return { [sort]: order === 'asc' ? 'asc' : 'desc' };
    return { createdAt: 'desc' as const };
  }
}
