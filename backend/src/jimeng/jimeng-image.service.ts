import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { decrypt } from '../common/utils/encryption.util';
import { PrismaService } from '../prisma/prisma.service';
import { JimengAccountService } from './jimeng-account.service';
import { JimengCoreService } from './jimeng-core.service';
import { FileService } from '../file/file.service';
import { NetworkScope } from '../common/roles.enum';
import { GenerateImageDto, ReferenceItemDto, ReferenceType } from './dto/jimeng.dto';

@Injectable()
export class JimengImageService {
  private readonly logger = new Logger(JimengImageService.name);

  constructor(
    private prisma: PrismaService,
    private accountService: JimengAccountService,
    private core: JimengCoreService,
    private fileService: FileService,
    private config: ConfigService,
  ) {}

  async generate(params: GenerateImageDto): Promise<{ id: string; taskId: string }> {
    const model = params.model || 'jimeng-2.1';
    const ratio = params.ratio || '1:1';

    const { processedPrompt } = this.parseMentions(params.prompt, params.references);

    const account = await this.accountService.selectOne();
    if (!account) throw new Error('没有可用的即梦账号，请先在「即梦账号池」中导入并激活账号');

    let refImageUrl = '';
    if (params.imageUploadId) {
      refImageUrl = (await this.fileService.getFile(params.imageUploadId).then(f => f?.url).catch(() => '')) || '';
    }
    if (!refImageUrl && params.references?.length) {
      const imgRef = params.references.find(r => r.type === ReferenceType.IMAGE);
      if (imgRef?.uploadId) {
        refImageUrl = (await this.fileService.getFile(imgRef.uploadId).then(f => f?.url).catch(() => '')) || '';
      } else if (imgRef?.url) {
        refImageUrl = imgRef.url;
      }
    }

    const localId = uuidv4();
    const initialJson = { prompt: processedPrompt, model, ratio, externalTaskId: '', images: [], error: '' };
    await this.prisma.jimengTask.create({
      data: {
        taskId: localId,
        type: 'image',
        status: 'pending',
        progress: '0',
        resultJson: initialJson,
        accountId: account.id,
      },
    });

    void this.executeGenerate(localId, account.sessionid, {
      prompt: processedPrompt, model, ratio, refImageUrl,
    }).catch((err) => {
      this.logger.error(`[image] 任务 ${localId} 执行失败: ${err?.message}`);
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
    if (!json.externalTaskId) return this.toFrontend(task);

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
      const result = await this.core.queryImageResult(json.externalTaskId, sid, NetworkScope.RESTRICTED);
      if (result.status_code === 1) {
        await this.prisma.jimengTask.update({
          where: { taskId: localId },
          data: { status: 'processing', progress: String(Math.max(Number(task.progress || 0), result.progress || 20)) },
        });
      } else if (result.status_code === 2) {
        await this.prisma.jimengTask.update({
          where: { taskId: localId },
          data: { status: 'completed', progress: '100', resultJson: { ...json, images: result.images || [] } },
        });
      } else {
        await this.prisma.jimengTask.update({
          where: { taskId: localId },
          data: { status: 'failed', resultJson: { ...json, error: `即梦返回错误: ${result.status_msg || '未知错误'}` } },
        });
      }
    } catch (err: any) {
      this.logger.warn(`[image] poll ${localId} error: ${err?.message}`);
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
      images: json.images || [],
      error: json.error || '',
    };
  }

  private parseMentions(prompt: string, references?: ReferenceItemDto[]) {
    if (!references || references.length === 0) return { processedPrompt: prompt };
    const refMap = new Map<string, ReferenceItemDto>();
    for (const ref of references) refMap.set(ref.mentionLabel, ref);
    for (const m of [...prompt.matchAll(/@(\S+)/g)]) {
      if (!refMap.has(m[1])) this.logger.warn(`[image] 未找到引用 "${m[1]}" 对应的素材`);
    }
    return { processedPrompt: prompt };
  }

  private async executeGenerate(
    localId: string, encryptedSessionid: string,
    opts: { prompt: string; model: string; ratio: string; refImageUrl: string },
  ) {
    let sessionid: string;
    try { sessionid = decrypt(encryptedSessionid); } catch { sessionid = ''; }
    if (!sessionid) {
      await this.prisma.jimengTask.update({ where: { taskId: localId }, data: { status: 'failed', resultJson: { error: '账号sessionid无法解密' } } }).catch(() => {});
      return;
    }

    await this.prisma.jimengTask.update({ where: { taskId: localId }, data: { status: 'processing', progress: '10' } });

    const result = await this.core.generateImage(sessionid, {
      prompt: opts.prompt, ratio: opts.ratio, imageUrl: opts.refImageUrl || undefined,
    }, NetworkScope.RESTRICTED);

    await this.prisma.jimengTask.update({
      where: { taskId: localId },
      data: { progress: '30', resultJson: { externalTaskId: result.task_id } },
    });

    let attempts = 0;
    while (attempts < 60) {
      await new Promise(r => setTimeout(r, 5000));
      attempts++;
      const updated = await this.pollAndUpdate(localId);
      if (updated.status === 'completed' || updated.status === 'failed') return;
    }
    await this.prisma.jimengTask.update({
      where: { taskId: localId },
      data: { status: 'failed', resultJson: { error: '生成超时（超过5分钟）' } },
    }).catch(() => {});
  }
}
