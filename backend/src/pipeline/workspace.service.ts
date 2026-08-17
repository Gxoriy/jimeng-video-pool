import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.service';
import { Executor, NetworkScope, TaskStatus, TaskType } from '../common/roles.enum';
import { AssetResolverService } from './asset-resolver.service';
import { TaskRecorderService } from './task-recorder.service';
import { VideoGenService } from './video-gen.service';
import { HedraClient } from './clients/hedra.client';
import { InspirationService } from './inspiration.service';
import { WorkspaceDto, WorkspaceRetryDto } from './dto/workspace.dto';
import { resolveUserHedraCookie } from './hedra-cookie.util';

/**
 * 视频工作区统一流水线：提示词扩写（Hedra / 灵感） -> 视频生成（RunningHub）。
 *
 * 把原本分散在两处的「P2 获取灵感 + P3 视频生成」合并为一条工作区任务，
 * 支持断点续跑：任务 params.stage 记录当前阶段，失败后可在对应阶段重试。
 */
@Injectable()
export class WorkspaceService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private assets: AssetResolverService,
    private recorder: TaskRecorderService,
    private hedra: HedraClient,
    private inspiration: InspirationService,
    private videoGen: VideoGenService,
  ) {}

  /** 新建工作区任务：先创建任务记录，再执行两阶段流水线 */
  async createTask(user: AuthUser, dto: WorkspaceDto) {
    const image = await this.resolveImage(user, dto);
    const audio = await this.resolveAudio(user, dto);
    const workflowId = this.config.get<string>('app.runninghubWorkflowId') || '2031016553440878594';

    const task = await this.recorder.start({
      userId: user.id,
      type: TaskType.video,
      prompt: '', // 阶段 1 结束后写入 actionPrompt
      provider: Executor.WORKSPACE,
      model: `workspace:${workflowId}`,
      params: {
        stage: 'prompt_expansion',
        workspace: true,
        workflowId,
        imageUrl: image.url,
        imageSource: image.source,
        audioUrl: audio?.url,
        audioSource: audio?.source,
        characterImageId: dto.characterImageId,
        imageUploadId: dto.imageUploadId,
        songId: dto.songId,
        audioUploadId: dto.audioUploadId,
        durationSeconds: dto.durationSeconds,
        audioStartSeconds: dto.audioStartSeconds,
        audioEndSeconds: dto.audioEndSeconds,
        maxResolution: dto.maxResolution,
        fps: dto.fps,
        retryCount: 0,
      },
    });

    await this.recorder.log(task.id, 'info', '工作区任务已创建，开始提示词扩写阶段');

    // 异步执行，不阻塞 HTTP 响应
    this.run(task.id, user, dto).catch((e) => this.recorder.fail(task.id, e));

    return { taskId: task.id, status: 'running' };
  }

  /** 断点续跑：根据任务记录的 stage 决定从哪一步继续 */
  async retryTask(user: AuthUser, taskId: string, _dto?: WorkspaceRetryDto) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');
    if (user.role !== 'super_admin' && task.userId !== user.id) {
      throw new ForbiddenException('无权操作该任务');
    }
    if (task.status !== TaskStatus.failed && task.status !== TaskStatus.pending) {
      throw new BadRequestException('只能重试失败或待处理的任务');
    }

    // 从 params 恢复输入（merge 用户可能传入的新参数）
    const params = (task.params || {}) as any;
    const dto: WorkspaceDto = {
      characterImageId: params.characterImageId,
      imageUploadId: params.imageUploadId,
      songId: params.songId,
      audioUploadId: params.audioUploadId,
      durationSeconds: params.durationSeconds,
      audioStartSeconds: params.audioStartSeconds,
      audioEndSeconds: params.audioEndSeconds,
      maxResolution: params.maxResolution,
      fps: params.fps,
      ...(_dto || {}),
    };

    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.running,
        errorMessage: null,
        params: { ...params, retryCount: (params.retryCount || 0) + 1 },
      },
    });
    await this.recorder.log(taskId, 'info', `开始断点续跑（阶段=${params.stage || 'prompt_expansion'}，重试次数=${(params.retryCount || 0) + 1}）`);

    this.run(taskId, user, dto, params.stage === 'video_generation').catch((e) =>
      this.recorder.fail(taskId, e),
    );

    return { taskId, status: 'running' };
  }

  /** 统一执行流水线 */
  private async run(
    taskId: string,
    user: AuthUser,
    dto: WorkspaceDto,
    skipPromptExpansion = false,
  ) {
    const image = await this.resolveImage(user, dto);
    const audio = await this.resolveAudio(user, dto);

    let actionPrompt = '';
    let promptSource = 'hedra';

    // ---- 阶段 1：提示词扩写 ----
    if (!skipPromptExpansion) {
      try {
        const hedraCookie = await resolveUserHedraCookie(this.prisma, user.id);
        const hedraResult = await this.expandWithHedra(image, audio, dto, hedraCookie);
        actionPrompt = hedraResult.prompt;
        promptSource = hedraResult.usedFallback ? 'hedra-fallback' : 'hedra';
        await this.recorder.log(taskId, 'info', `Hedra 提示词扩写完成（model=${hedraResult.model}）`);
      } catch (e: any) {
        const fallbackEnabled = this.config.get<boolean>('app.inspirationFallbackEnabled') ?? true;
        if (!fallbackEnabled) {
          await this.recorder.log(
            taskId,
            'warn',
            `Hedra 扩写失败且 AI 渠道降级已关闭：${e?.message || e}`,
          );
          throw new BadRequestException(
            `Hedra 提示词扩写失败：${e?.message || e}。` +
              '当前已关闭 AI 渠道降级，请检查 Hedra cookie 或个人设置中的 cookie 是否有效。',
          );
        }
        await this.recorder.log(taskId, 'warn', `Hedra 扩写失败，降级到 AI 灵感：${e?.message || e}`);
        const inspiration = await this.inspiration.generate(user, {
          referenceCharacterImageId: dto.characterImageId,
          imageUploadId: dto.imageUploadId,
          songId: dto.songId,
          audioUploadId: dto.audioUploadId,
        });
        // inspiration.generate 会自己创建并运行一个 inspiration 任务；我们取结果里的 actionPrompt
        const inspTask = await this.pollInspiration(inspiration.taskId);
        const inspRd = (inspTask.resultData as Record<string, any> | null) || {};
        actionPrompt = inspRd.actionPrompt || inspTask.resultText || '';
        promptSource = 'inspiration';
      }

      actionPrompt = actionPrompt.trim();
      if (!actionPrompt) {
        throw new BadRequestException('提示词扩写未返回有效动作提示词');
      }

      const prev = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { resultData: true, params: true },
      });
      const prevResult = (prev?.resultData as Record<string, any> | null) || {};
      const prevParams = (prev?.params as Record<string, any> | null) || {};
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          prompt: actionPrompt,
          resultData: { ...prevResult, actionPrompt, promptSource },
          params: { ...prevParams, stage: 'video_generation' },
        },
      });
      await this.recorder.log(taskId, 'info', '提示词扩写阶段完成，进入视频生成阶段');
    } else {
      const task = await this.prisma.task.findUnique({ where: { id: taskId } });
      const rd = (task?.resultData as Record<string, any> | null) || {};
      actionPrompt = rd.actionPrompt || task?.prompt || '';
      if (!actionPrompt) {
        throw new BadRequestException('任务缺少已保存的动作提示词，无法续跑视频生成');
      }
      await this.recorder.log(taskId, 'info', '断点续跑：跳过提示词扩写，直接使用已保存动作提示词');
    }

    // ---- 阶段 2：视频生成 ----
    await this.videoGen.execute(user, taskId, {
      imageUrl: image.url,
      imageUploadId: dto.imageUploadId,
      characterId: undefined,
      characterImageId: dto.characterImageId,
      audioUrl: audio?.url,
      audioUploadId: dto.audioUploadId,
      songId: dto.songId,
      actionPrompt,
      durationSeconds: dto.durationSeconds,
      audioStartSeconds: dto.audioStartSeconds,
      audioEndSeconds: dto.audioEndSeconds,
      maxResolution: dto.maxResolution,
      fps: dto.fps,
    });
  }

  /** 用 Hedra 扩写提示词 */
  private async expandWithHedra(
    image: { url: string; localPath?: string | null },
    audio: { url?: string; localPath?: string | null } | null,
    dto: WorkspaceDto,
    cookieOverride?: string,
  ) {
    const imagePaths: string[] = [];
    if (image.localPath) {
      imagePaths.push(image.localPath);
    } else if (image.url && /^https?:\/\//i.test(image.url)) {
      // 仅 URL（无本地文件）时临时下载，Hedra 要求附件以 data URL 内联
      imagePaths.push(await this.hedra.downloadToTemp(image.url));
    }

    const audioPaths: string[] = [];
    if (audio?.localPath) {
      audioPaths.push(audio.localPath);
    } else if (audio?.url && /^https?:\/\//i.test(audio.url)) {
      audioPaths.push(await this.hedra.downloadToTemp(audio.url));
    }

    if (!imagePaths.length) {
      throw new BadRequestException('Hedra 扩写需要参考图（本地文件或 http(s) 链接）');
    }

    return this.hedra.generatePrompt(
      {
        text: dto.text || '根据参考图和参考音频生成一段数字人短视频的动作提示词。',
        imagePaths,
        audioPaths,
      },
      cookieOverride,
    );
  }

  private async resolveImage(user: AuthUser, dto: WorkspaceDto) {
    const images = await this.assets.resolveImages(user, {
      urls: dto.imageUrl ? [dto.imageUrl] : undefined,
      uploadId: dto.imageUploadId,
      characterId: dto.characterId,
      characterImageId: dto.characterImageId,
    });
    if (!images.length) {
      throw new BadRequestException('请上传图片，或选择一个数字人形象');
    }
    return images[0];
  }

  private async resolveAudio(user: AuthUser, dto: WorkspaceDto) {
    return this.assets.resolveAudio(user, {
      url: dto.audioUrl,
      uploadId: dto.audioUploadId,
      songId: dto.songId,
    });
  }

  private async pollInspiration(taskId: string) {
    for (let i = 0; i < 200; i++) {
      const t = await this.prisma.task.findUnique({ where: { id: taskId } });
      if (!t) throw new NotFoundException('灵感任务不存在');
      if (t.status === 'success') return t;
      if (t.status === 'failed') throw new BadRequestException(t.errorMessage || '灵感任务失败');
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new BadRequestException('等待灵感任务超时');
  }
}
