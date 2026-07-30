import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KeyPoolService } from '../key-pool/key-pool.service';
import { ProviderFactory } from './providers/provider.factory';
import { MediaService } from '../media/media.service';
import { AuthUser } from '../auth/auth.service';
import { TaskType, TaskStatus } from '../common/roles.enum';
import { GenerateDto } from './dto/generate.dto';
import { Provider } from '../common/roles.enum';

@Injectable()
export class GenerationService {
  constructor(
    private prisma: PrismaService,
    private keyPool: KeyPoolService,
    private factory: ProviderFactory,
    private media: MediaService,
  ) {}

  /**
   * 统一生成入口（设计 §5.1）。
   * 1) 建任务(pending) 2) 选 Key(用户∪系统) 3) provider 生成 4) 自动下载落地 5) 写 tasks+media+库关联
   */
  async generate(dto: GenerateDto, user: AuthUser, requestBearer?: string) {
    const type = dto.type as TaskType;
    const provider = this.factory.get(type);
    const keyProvider = this.factory.keyProviderOf(type);

    // 建任务
    const task = await this.prisma.task.create({
      data: {
        userId: user.id,
        type,
        status: TaskStatus.running,
        prompt: dto.prompt,
        params: (dto.params as any) || undefined,
        provider: keyProvider,
        model: dto.model,
      },
    });

    // 异步执行（不阻塞 HTTP 响应）
    this.runPipeline(task.id, dto, user, keyProvider, requestBearer).catch(async (err) => {
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.failed,
          errorMessage: err?.message?.slice(0, 1000) || '未知错误',
          finishedAt: new Date(),
        },
      });
    });

    return { taskId: task.id, status: TaskStatus.running };
  }

  private async runPipeline(
    taskId: string,
    dto: GenerateDto,
    user: AuthUser,
    keyProvider: Provider,
    requestBearer?: string,
  ) {
    const provider = this.factory.get(dto.type as TaskType);
    const key = await this.keyPool.selectKey(keyProvider, user, requestBearer);

    const result = await provider.generate({
      prompt: dto.prompt,
      model: dto.model,
      params: dto.params,
      key,
      scope: user.networkScope,
      requestBearer,
    });

    // 自动下载落地 + 登记 media
    const resultUrls: string[] = [];
    const resultLocalPaths: string[] = [];
    for (const url of result.urls) {
      resultUrls.push(url);
      try {
        const local = await this.media.download(url, user.networkScope);
        resultLocalPaths.push(local);
        await this.prisma.media.create({
          data: { taskId, type: dto.type, url, localPath: local },
        });
      } catch {
        // 下载失败不致命，仍保留结果 URL
      }
    }

    // 关联库（若引用了形象库，把生成图挂到形象）
    if (dto.libraryRef?.characterId && resultUrls.length) {
      for (const url of resultUrls) {
        await this.prisma.characterImage.create({
          data: {
            characterId: dto.libraryRef.characterId,
            url,
            localPath: resultLocalPaths[resultUrls.indexOf(url)] || null,
            prompt: dto.prompt,
            model: dto.model,
            createdBy: user.id,
          },
        });
      }
    }
    if (dto.libraryRef?.songId) {
      await this.prisma.song.update({
        where: { id: dto.libraryRef.songId },
        data: {} as any,
      }).catch(() => undefined);
    }

    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.success,
        resultUrls: resultUrls as any,
        resultLocalPaths: resultLocalPaths as any,
        finishedAt: new Date(),
      },
    });
  }

  listProviders() {
    return [
      { type: TaskType.image, label: '图片（ChatGPT / OpenAI 兼容生图）', keyProvider: Provider.OPENAI },
      { type: TaskType.digital_human, label: '数字人对口型（RunningHub）', keyProvider: Provider.RUNNINGHUB },
      { type: TaskType.video, label: '视频（可插拔，默认 RunningHub）', keyProvider: Provider.RUNNINGHUB },
    ];
  }
}
