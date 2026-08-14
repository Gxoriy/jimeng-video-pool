import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { decrypt } from '../common/utils/encryption.util';
import { PrismaService } from '../prisma/prisma.service';
import { JimengAccountService } from './jimeng-account.service';
import { JimengCoreService } from './jimeng-core.service';
import { FileService } from '../file/file.service';
import { NetworkScope } from '../common/roles.enum';
import { GenerateVideoDto, ReferenceItemDto, OmniReferenceMode, ReferenceType } from './dto/jimeng.dto';

@Injectable()
export class JimengVideoService {
  private readonly logger = new Logger(JimengVideoService.name);

  constructor(
    private prisma: PrismaService,
    private accountService: JimengAccountService,
    private core: JimengCoreService,
    private fileService: FileService,
    private config: ConfigService,
  ) {}

  /**
   * 启动视频生成任务。
   * 注：JimengTask 主键为 taskId（外部即梦任务 id），此处先以本地 uuid 作为占位主键，
   * 提交成功后将即梦 task_id 一并存入 resultJson.externalTaskId，轮询仍使用本地 id。
   */
  async generate(params: GenerateVideoDto): Promise<{ id: string; taskId: string }> {
    const model = params.model || 'seedance-2.0-mini';
    const ratio = params.ratio || '16:9';
    const resolution = params.resolution || '720p';
    const duration = params.duration || 10;
    const referenceMode = params.referenceMode || OmniReferenceMode.OFF;

    const { processedPrompt } = this.parseMentions(params.prompt, params.references);

    const account = await this.accountService.selectOne();
    if (!account) {
      throw new Error('没有可用的即梦账号，请先在「即梦账号池」中导入并激活账号');
    }

    const firstFrame = params.firstFrameUploadId
      ? (await this.fileService.getFileDataUrl(params.firstFrameUploadId).catch(() => '')) || ''
      : '';
    const endFrame = params.endFrameUploadId
      ? (await this.fileService.getFileDataUrl(params.endFrameUploadId).catch(() => '')) || ''
      : '';

    const referenceUrls = await this.resolveReferenceUrls(params.references || []);

    const localId = uuidv4();
    const initialJson = {
      prompt: processedPrompt,
      model, ratio, resolution, duration, referenceMode,
      externalTaskId: '',
      videoUrl: '', coverUrl: '', error: '',
    };
    await this.prisma.jimengTask.create({
      data: {
        taskId: localId,
        type: 'video',
        status: 'pending',
        progress: '0',
        resultJson: initialJson,
        accountId: account.id,
      },
    });

    void this.executeGenerate(localId, account.id, account.sessionid, {
      prompt: processedPrompt, model, ratio, resolution, duration,
      firstFrame, endFrame, referenceMode, referenceUrls,
    }).catch((err) => {
      this.logger.error(`[video] 任务 ${localId} 执行失败: ${err?.message}`);
      this.prisma.jimengTask.update({
        where: { taskId: localId },
        data: { status: 'failed', resultJson: { ...initialJson, error: err?.message?.slice(0, 500) } },
      }).catch(() => {});
    });

    return { id: localId, taskId: localId };
  }

  async pollAndUpdate(localId: string) {
    const task = await this.prisma.jimengTask.findUnique({ where: { taskId: localId } });
    if (!task) throw new Error('任务不存在');
    if (task.status !== 'pending' && task.status !== 'processing') return this.toFrontend(task);

    let json: any = {};
    try { json = task.resultJson || {}; } catch { json = {}; }

    if (!json.externalTaskId) {
      // 还没提交成功，保持 pending
      return this.toFrontend(task);
    }

    const account = await this.prisma.jimengAccount.findUnique({ where: { id: task.accountId } });
    if (!account) {
      return this.toFrontend(await this.prisma.jimengTask.update({
        where: { taskId: localId },
        data: { status: 'failed', resultJson: { ...json, error: '关联账号不存在' } },
      }));
    }
    let sid: string;
    try { sid = decrypt(account.sessionid); } catch { sid = ''; }
    if (!sid) {
      return this.toFrontend(await this.prisma.jimengTask.update({
        where: { taskId: localId },
        data: { status: 'failed', resultJson: { ...json, error: '账号sessionid无法解密，请重新导入' } },
      }));
    }

    try {
      const result = await this.core.queryVideoResult(json.externalTaskId, sid, NetworkScope.RESTRICTED);
      if (result.status_code === 1) {
        await this.prisma.jimengTask.update({
          where: { taskId: localId },
          data: { status: 'processing', progress: String(Math.max(Number(task.progress || 0), result.progress || 20)) },
        });
      } else if (result.status_code === 2) {
        await this.prisma.jimengTask.update({
          where: { taskId: localId },
          data: {
            status: 'completed',
            progress: '100',
            resultJson: { ...json, videoUrl: result.video_url, coverUrl: result.cover_url },
          },
        });
      } else {
        await this.prisma.jimengTask.update({
          where: { taskId: localId },
          data: { status: 'failed', resultJson: { ...json, error: `即梦返回错误: ${result.status_msg || '未知错误'}` } },
        });
      }
    } catch (err: any) {
      this.logger.warn(`[video] poll ${localId} error: ${err?.message}`);
    }

    return this.toFrontend(await this.prisma.jimengTask.findUnique({ where: { taskId: localId } }));
  }

  private toFrontend(task: any) {
    let json: any = {};
    try { json = task.resultJson || {}; } catch { json = {}; }
    return {
      done: task.status === 'completed',
      taskId: task.taskId,
      status: task.status,
      progress: Number(task.progress || 0),
      videoUrl: json.videoUrl || '',
      coverUrl: json.coverUrl || '',
      error: json.error || '',
    };
  }

  /* ========== 内部方法 ========== */

  private parseMentions(prompt: string, references?: ReferenceItemDto[]) {
    if (!references || references.length === 0) return { processedPrompt: prompt };
    const refMap = new Map<string, ReferenceItemDto>();
    for (const ref of references) refMap.set(ref.mentionLabel, ref);
    for (const m of [...prompt.matchAll(/@(\S+)/g)]) {
      if (!refMap.has(m[1])) this.logger.warn(`[video] 未找到引用 "${m[1]}" 对应的素材`);
    }
    return { processedPrompt: prompt };
  }

  private async resolveReferenceUrls(references: ReferenceItemDto[]): Promise<string[]> {
    const urls: string[] = [];
    for (const ref of references) {
      if (ref.url && (ref.url.startsWith('http://') || ref.url.startsWith('https://') || ref.url.startsWith('data:'))) {
        urls.push(ref.url);
        continue;
      }
      if (ref.uploadId) {
        const dataUrl = await this.fileService.getFileDataUrl(ref.uploadId).catch(() => null);
        if (dataUrl) urls.push(dataUrl);
      }
    }
    return urls;
  }

  private async executeGenerate(
    localId: string,
    accountId: string,
    encryptedSessionid: string,
    opts: {
      prompt: string; model: string; ratio: string; resolution: string; duration: number;
      firstFrame: string; endFrame: string; referenceMode: OmniReferenceMode; referenceUrls: string[];
    },
  ) {
    try {
      let sessionid: string;
      try { sessionid = decrypt(encryptedSessionid); } catch { sessionid = ''; }
      if (!sessionid) {
        await this.prisma.jimengTask.update({ where: { taskId: localId }, data: { status: 'failed', resultJson: { error: '账号sessionid无法解密' } } }).catch(() => {});
        return;
      }

      await this.prisma.jimengTask.update({ where: { taskId: localId }, data: { status: 'processing', progress: '10' } });

      const result = await this.core.generateVideo(sessionid, {
        prompt: opts.prompt, model: opts.model, ratio: opts.ratio, resolution: opts.resolution, duration: opts.duration,
        firstFrameImage: opts.firstFrame || undefined, endFrameImage: opts.endFrame || undefined,
        referenceImages: opts.referenceUrls,
        referenceMode: opts.referenceMode !== OmniReferenceMode.OFF ? opts.referenceMode : undefined,
      }, NetworkScope.RESTRICTED);

      // 回填即梦外部 task_id
      await this.prisma.jimengTask.update({
        where: { taskId: localId },
        data: { progress: '30', resultJson: { externalTaskId: result.task_id } },
      });

      // 轮询
      let attempts = 0;
      while (attempts < 120) {
        await new Promise(r => setTimeout(r, 5000));
        attempts++;
        const updated = await this.pollAndUpdate(localId);
        if (updated.status === 'completed' || updated.status === 'failed') return;
      }
      await this.prisma.jimengTask.update({
        where: { taskId: localId },
        data: { status: 'failed', resultJson: { error: '生成超时（超过10分钟）' } },
      }).catch(() => {});
    } finally {
      this.accountService.release(accountId);
    }
  }
}
