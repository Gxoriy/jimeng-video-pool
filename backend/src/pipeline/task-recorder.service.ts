import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaskStatus, TaskType } from '../common/roles.enum';

/**
 * 任务生命周期与日志的统一记录器（三个阶段共用）。
 * 所有任务都带 userId，实现用户间信息隔离。
 */
@Injectable()
export class TaskRecorderService {
  constructor(private prisma: PrismaService) {}

  async start(input: {
    userId: string;
    type: TaskType;
    prompt?: string;
    params?: any;
    provider: string;
    model?: string;
  }) {
    return this.prisma.task.create({
      data: {
        userId: input.userId,
        type: input.type,
        status: TaskStatus.running,
        prompt: input.prompt,
        params: input.params ?? undefined,
        provider: input.provider,
        model: input.model,
      },
    });
  }

  async log(taskId: string, level: 'info' | 'warn' | 'error', message: string) {
    await this.prisma.taskLog
      .create({ data: { taskId, level, message: String(message).slice(0, 2000) } })
      .catch(() => undefined);
  }

  logger(taskId: string) {
    return (level: 'info' | 'warn' | 'error', msg: string) => this.log(taskId, level, msg);
  }

  async succeed(
    taskId: string,
    data: { urls?: string[]; localPaths?: string[]; text?: string; json?: any },
  ) {
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.success,
        resultUrls: (data.urls ?? []) as any,
        resultLocalPaths: (data.localPaths ?? []) as any,
        resultText: data.text,
        resultData: data.json as any,
        finishedAt: new Date(),
      },
    });
    await this.log(taskId, 'info', '任务执行完成');
  }

  async fail(taskId: string, err: any) {
    const message = err?.message || String(err) || '未知错误';
    await this.log(taskId, 'error', `任务失败：${message}`);
    await this.prisma.task
      .update({
        where: { id: taskId },
        data: {
          status: TaskStatus.failed,
          errorMessage: message.slice(0, 1000),
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }
}
