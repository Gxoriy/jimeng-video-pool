import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuthUser } from '../auth/auth.service';
import { Executor, TaskType } from '../common/roles.enum';
import {
  NodeMapEntry,
  RUNNINGHUB_FIELDS,
  RunningHubField,
} from '../config/configuration';
import { NodeInfo, RunningHubClient } from './clients/runninghub.client';
import { AssetResolverService } from './asset-resolver.service';
import { TaskRecorderService } from './task-recorder.service';
import { VideoGenDto } from './dto/pipeline.dto';

/** 各表单字段在 RunningHub 节点入参中的中文说明（仅用于调试图示，可选） */
const FIELD_DESCRIPTIONS: Partial<Record<RunningHubField, string>> = {
  image: '人物图（9:16 或 16:9 比例效果更佳）',
  audio: '上传歌曲或语音',
  durationSeconds: '生成秒数（35 秒内效果更佳、0=整段音频）',
  audioStartSeconds: '音频从第几秒开始对口型，例: 0 (秒)',
  actionPrompt: '动作提示词（角色面向镜头深情的说话，固定镜头）',
  maxResolution: '最大分辨率（小于 1600，越大越慢）',
  fps: '帧率',
};

/**
 * ============ P3 · 视频生成 ============
 *
 * 唯一使用 RunningHub 的环节，对应工作流：
 *   https://www.runninghub.cn/ai-detail/2031016553440878594
 *
 * 表单项（与工作流一致）：
 *   图片（上传 / 选数字人形象） + 音频（上传 / 选歌曲库）
 *   + 生成秒数（35s 内效果更佳，0 = 整段音频）
 *   + 音频从第几秒开始对口型（如 0-10 秒）
 *   + 动作提示词（可来自 P2 获取灵感）
 *   + 最大分辨率（< 1600，越大越慢）
 *   + 帧率（默认 25）
 *
 * 计费：使用**用户自己**的 RunningHub API Key，无共享 Key 池、无随机选号。
 */
@Injectable()
export class VideoGenService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private rh: RunningHubClient,
    private assets: AssetResolverService,
    private settings: SettingsService,
    private recorder: TaskRecorderService,
  ) {}

  async generate(user: AuthUser, dto: VideoGenDto) {
    const prepared = await this.prepare(user, dto);
    const { apiKey, image, audio, workflowId } = prepared;

    // ---- 3. 建任务 ----
    const task = await this.recorder.start({
      userId: user.id,
      type: TaskType.video,
      prompt: dto.actionPrompt?.trim() || '',
      provider: Executor.RUNNINGHUB,
      model: `runninghub:${workflowId}`,
      params: {
        stage: 'P3',
        workflowId,
        imageUrl: image.url,
        imageSource: image.source,
        audioUrl: audio.url,
        audioSource: audio.source,
        songId: dto.songId,
        durationSeconds: dto.durationSeconds,
        audioStartSeconds: dto.audioStartSeconds,
        audioEndSeconds: dto.audioEndSeconds,
        maxResolution: dto.maxResolution,
        fps: dto.fps,
      },
    });

    await this.logStart(task.id, dto, workflowId);

    this.run(task.id, user, apiKey, workflowId, image, audio, dto).catch((e) =>
      this.recorder.fail(task.id, e),
    );

    return { taskId: task.id, status: 'running' };
  }

  /**
   * 供 WorkspaceService 复用：使用已存在的任务（断点续跑时不重复建任务）。
   * 会先 resolve 素材并上传 RunningHub，最后把结果写回 taskId。
   */
  async execute(user: AuthUser, taskId: string, dto: VideoGenDto) {
    const prepared = await this.prepare(user, dto);
    const { apiKey, image, audio, workflowId } = prepared;
    await this.logStart(taskId, dto, workflowId);
    await this.run(taskId, user, apiKey, workflowId, image, audio, dto);
  }

  private async prepare(user: AuthUser, dto: VideoGenDto) {
    // ---- 1. 必须先有个人 Key（未配置直接报错，不回退）----
    const apiKey = await this.settings.requireRunninghubKey(user.id);

    // ---- 2. 素材 ----
    const images = await this.assets.resolveImages(user, {
      urls: dto.imageUrl ? [dto.imageUrl] : undefined,
      uploadId: dto.imageUploadId,
      characterId: dto.characterId,
      characterImageId: dto.characterImageId,
    });
    if (!images.length) {
      throw new BadRequestException('请上传图片，或选择一个数字人形象');
    }
    const image = images[0];

    const audio = await this.assets.resolveAudio(user, {
      url: dto.audioUrl,
      uploadId: dto.audioUploadId,
      songId: dto.songId,
    });
    if (!audio) {
      throw new BadRequestException('请上传音频，或从歌曲库中选择一首歌曲');
    }

    const actionPrompt = (dto.actionPrompt || '').trim();
    if (!actionPrompt) {
      throw new BadRequestException('动作提示词不能为空，可先用「获取灵感」生成');
    }
    if (dto.audioEndSeconds != null && dto.audioEndSeconds <= dto.audioStartSeconds) {
      throw new BadRequestException('对口型结束秒数必须大于起始秒数');
    }

    const workflowId =
      this.config.get<string>('app.runninghubWorkflowId') || '2031016553440878594';

    return { apiKey, image, audio, workflowId };
  }

  private async logStart(taskId: string, dto: VideoGenDto, workflowId: string) {
    await this.recorder.log(
      taskId,
      'info',
      [
        `P3 视频生成｜工作流=${workflowId}`,
        `生成秒数=${dto.durationSeconds === 0 ? '整段音频' : dto.durationSeconds + 's'}`,
        `对口型=${dto.audioStartSeconds}s${dto.audioEndSeconds != null ? '-' + dto.audioEndSeconds + 's' : ''}`,
        `分辨率=${dto.maxResolution}`,
        `帧率=${dto.fps}`,
      ].join('｜'),
    );
    if (dto.durationSeconds > 35) {
      await this.recorder.log(
        taskId,
        'warn',
        '生成秒数超过 35 秒，耗时与 R 币消耗会显著上升，且效果可能下降',
      );
    }
  }

  private async run(
    taskId: string,
    user: AuthUser,
    apiKey: string,
    workflowId: string,
    image: { url: string; localPath?: string | null },
    audio: { url?: string; localPath?: string | null },
    dto: VideoGenDto,
  ) {
    const log = this.recorder.logger(taskId);
    const scope = user.networkScope;

    // ---- 上传素材到 RunningHub ----
    await log('info', '上传图片到 RunningHub…');
    let imageFile: string;
    if (image.localPath) {
      imageFile = await this.rh.uploadLocalFile(apiKey, scope, image.localPath, 'image');
    } else {
      // 库内形象图没有本地副本，只能回抓远程签名图（即梦等），极易因签名过期而 403。
      // 与其抛晦涩的「外部调用失败 (403)」，不如明确告诉用户是参考图链接已失效。
      try {
        imageFile = await this.rh.uploadRemoteUrl(apiKey, scope, image.url, 'image');
      } catch (e: any) {
        throw new BadRequestException(
          '参考图即梦链接已失效（签名过期），请重新上传或重新生成该形象图片',
        );
      }
    }
    await log('info', `图片就绪：${imageFile}`);

    await log('info', '上传音频到 RunningHub…');
    const audioFile = audio.localPath
      ? await this.rh.uploadLocalFile(apiKey, scope, audio.localPath, 'audio')
      : await this.rh.uploadRemoteUrl(apiKey, scope, audio.url!, 'audio');
    await log('info', `音频就绪：${audioFile}`);

    // ---- 组装节点入参 ----
    const values: Partial<Record<RunningHubField, string | number>> = {
      image: imageFile,
      audio: audioFile,
      durationSeconds: dto.durationSeconds,
      audioStartSeconds: dto.audioStartSeconds,
      actionPrompt: dto.actionPrompt.trim(),
      maxResolution: dto.maxResolution,
      fps: dto.fps,
    };
    const nodeInfoList = await this.buildNodeInfoList(values, dto, log);

    // ---- 执行 ----
    const urls = await this.rh.run({
      apiKey,
      scope,
      workflowId,
      nodeInfoList,
      onLog: log,
    });

    // ---- 落地 ----
    // 视频结果链接仅 24h 有效，按需求「视频不下载到服务器，只提供 url 供用户及时下载」：
    // 这里仅登记 url（不落盘本地文件），前端直接用该 url 预览 / 下载。
    const localPaths: Array<string | null> = [];
    for (const url of urls) {
      localPaths.push(null);
      await this.prisma.media.create({
        data: { taskId, type: 'video', url },
      });
    }

    await this.recorder.succeed(taskId, { urls, localPaths });
  }

  /**
   * 表单值 -> nodeInfoList。
   * 映射来自 .env 的 RUNNINGHUB_NODE_MAP（默认见 configuration.ts 的 DEFAULT_NODE_MAP）；
   * 缺失映射的字段会跳过并告警，dto.nodeOverrides 优先级最高（同 nodeId+fieldName 覆盖）。
   */
  private async buildNodeInfoList(
    values: Partial<Record<RunningHubField, string | number>>,
    dto: VideoGenDto,
    log: (level: 'info' | 'warn' | 'error', msg: string) => Promise<void>,
  ): Promise<NodeInfo[]> {
    const map =
      this.config.get<Partial<Record<RunningHubField, NodeMapEntry>>>(
        'app.runninghubNodeMap',
      ) || {};

    const list: NodeInfo[] = [];
    const missing: string[] = [];

    for (const field of RUNNINGHUB_FIELDS) {
      const value = values[field];
      if (value === undefined || value === null || value === '') continue;
      const entry = map[field];
      if (!entry?.nodeId) {
        missing.push(field);
        continue;
      }
      list.push({
        nodeId: entry.nodeId,
        fieldName: entry.fieldName,
        fieldValue: value,
        description: FIELD_DESCRIPTIONS[field],
      });
    }

    for (const ov of dto.nodeOverrides || []) {
      if (!ov?.nodeId || !ov?.fieldName) continue;
      const idx = list.findIndex(
        (n) => n.nodeId === String(ov.nodeId) && n.fieldName === ov.fieldName,
      );
      const item: NodeInfo = {
        nodeId: String(ov.nodeId),
        fieldName: ov.fieldName,
        fieldValue: ov.fieldValue,
      };
      if (idx >= 0) list[idx] = item;
      else list.push(item);
    }

    if (missing.length) {
      await log(
        'warn',
        `以下字段未配置节点映射，将使用工作流默认值：${missing.join('、')}。` +
          '请管理员在 .env 的 RUNNINGHUB_NODE_MAP 中补全 nodeId。',
      );
    }
    if (!list.length) {
      throw new BadRequestException(
        'RUNNINGHUB_NODE_MAP 尚未配置，无法把图片/音频/提示词传入工作流。' +
          '请在工作流详情页查看各输入控件的节点编号后写入 .env。',
      );
    }
    return list;
  }

  /** 供前端「个人设置」展示余额 */
  async accountStatus(user: AuthUser) {
    const apiKey = await this.settings.requireRunninghubKey(user.id);
    return this.rh.accountStatus(apiKey, user.networkScope);
  }

  /** 供前端提示：节点映射配置情况 */
  nodeMapStatus() {
    const map =
      this.config.get<Partial<Record<RunningHubField, NodeMapEntry>>>(
        'app.runninghubNodeMap',
      ) || {};
    return {
      workflowId: this.config.get<string>('app.runninghubWorkflowId'),
      configured: RUNNINGHUB_FIELDS.filter((f) => !!map[f]?.nodeId),
      missing: RUNNINGHUB_FIELDS.filter((f) => !map[f]?.nodeId),
    };
  }
}
