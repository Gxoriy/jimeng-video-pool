import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.service';
import { Executor, TaskStatus, TaskType } from '../common/roles.enum';
import { AssetResolverService } from './asset-resolver.service';
import { TaskRecorderService } from './task-recorder.service';
import { VideoGenService } from './video-gen.service';
import { WorkspaceDto, WorkspaceRetryDto } from './dto/workspace.dto';

/**
 * 视频工作区流水线：仅做「视频生成（RunningHub）」。
 *
 * 提示词完全由用户掌控：
 *  - 用户手写动作提示词，或手动点「提示词扩写」按钮获得扩写结果后回填输入框；
 *  - 工作区任务创建后**不再自动跑提示词扩写阶段**，也不会降级到 AI 灵感覆盖用户文本；
 *  - 直接进入视频生成，使用用户填写/扩写后的动作提示词（actionPrompt）。
 */
@Injectable()
export class WorkspaceService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private assets: AssetResolverService,
    private recorder: TaskRecorderService,
    private videoGen: VideoGenService,
  ) {}

  /** 新建工作区任务：校验提示词 -> 落任务记录 -> 直接进入视频生成 */
  async createTask(user: AuthUser, dto: WorkspaceDto) {
    if (!dto.text || !dto.text.trim()) {
      throw new BadRequestException('请先填写动作提示词，或点「提示词扩写」生成后再开始执行');
    }
    const image = await this.resolveImage(user, dto);
    const audio = await this.resolveAudio(user, dto);
    const workflowId = this.config.get<string>('app.runninghubWorkflowId') || '2031016553440878594';

    const actionPrompt = dto.text.trim();

    const task = await this.recorder.start({
      userId: user.id,
      type: TaskType.video,
      prompt: actionPrompt,
      provider: Executor.WORKSPACE,
      model: `workspace:${workflowId}`,
      params: {
        stage: 'video_generation',
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

    await this.prisma.task.update({
      where: { id: task.id },
      data: { resultData: { actionPrompt, promptSource: 'user' } as any },
    });

    await this.recorder.log(
      task.id,
      'info',
      '工作区任务已创建，使用用户填写/扩写的动作提示词，直接进入视频生成',
    );

    // 异步执行，不阻塞 HTTP 响应
    this.run(task.id, user, dto).catch((e) => this.recorder.fail(task.id, e));

    return { taskId: task.id, status: 'running' };
  }

  /** 断点续跑：从视频生成阶段继续（提示词已保存在任务记录中，无需重跑扩写） */
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
      text: (_dto as any)?.text ?? params.text,
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
    await this.recorder.log(
      taskId,
      'info',
      `开始断点续跑（阶段=${params.stage || 'video_generation'}，重试次数=${(params.retryCount || 0) + 1}）`,
    );

    this.run(taskId, user, dto).catch((e) => this.recorder.fail(taskId, e));

    return { taskId, status: 'running' };
  }

  /** 执行视频生成（提示词来自用户填写/扩写，不在此做任何扩写或降级） */
  private async run(taskId: string, user: AuthUser, dto: WorkspaceDto) {
    const image = await this.resolveImage(user, dto);
    const audio = await this.resolveAudio(user, dto);

    // 优先使用本次传入的文本；续跑时 dto.text 为空，则从已保存的任务记录恢复
    let actionPrompt = (dto.text || '').trim();
    if (!actionPrompt) {
      const t = await this.prisma.task.findUnique({ where: { id: taskId } });
      actionPrompt = ((t?.resultData as any)?.actionPrompt || t?.prompt || '').trim();
    }
    if (!actionPrompt) {
      throw new BadRequestException('任务缺少动作提示词，无法生成视频');
    }

    await this.recorder.log(taskId, 'info', '使用已填写/扩写的动作提示词，开始视频生成');

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
}
