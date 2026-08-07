import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JimengAccountService } from './jimeng-account.service';
import { JimengImageService } from './jimeng-image.service';
import { JimengVideoService } from './jimeng-video.service';
import { JimengCoreService } from './jimeng-core.service';
import { ImageGenDto, VideoGenDto } from './dto/jimeng.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { NetworkScope, TaskType } from '../common/roles.enum';
import { BadRequestException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { TaskRecorderService } from '../pipeline/task-recorder.service';
import { AssetResolverService } from '../pipeline/asset-resolver.service';
import { MediaService } from '../media/media.service';

/**
 * 即梦生成接口（登录可见）。
 * 走本地号池（概念 A）/ 外部号池（概念 B）共用选号；调用即梦时只用 sessionid 重建 Cookie。
 *
 * 与三阶段流水线同一套任务体系：
 *  - 提交即建 tasks 记录（类型 jimeng_image / jimeng_video），后台异步执行
 *  - 任务日志写 task_logs（任务日志页可见）
 *  - 结果落 media 表并下载到本地（视频素材库可读）
 *  - 每次任务记录实际使用账号与消耗积分（jimeng_tasks），供选号权重调整
 */
@Controller('jimeng')
@UseGuards(JwtAuthGuard)
export class JimengController {
  private readonly logger = new Logger(JimengController.name);

  constructor(
    private readonly accounts: JimengAccountService,
    private readonly image: JimengImageService,
    private readonly video: JimengVideoService,
    private readonly core: JimengCoreService,
    private readonly prisma: PrismaService,
    private readonly recorder: TaskRecorderService,
    private readonly assets: AssetResolverService,
    private readonly media: MediaService,
  ) {}

  @Get('models')
  async models() {
    return {
      code: 0,
      message: 'ok',
      data: {
        image: this.image.getModels(),
        video: this.video.getModels(),
      },
    };
  }

  @Post('image/generations')
  async imageGen(@Body() dto: ImageGenDto, @CurrentUser() user: AuthUser) {
    const scope = user.networkScope as NetworkScope;

    // 参考图：本地上传 / 形象库 / 直接 URL（三选一）
    let refImageUrl: string | undefined;
    if (dto.imageUploadId || dto.characterId || dto.characterImageId) {
      const images = await this.assets.resolveImages(user, {
        uploadId: dto.imageUploadId,
        characterId: dto.characterId,
        characterImageId: dto.characterImageId,
      });
      refImageUrl = images[0]?.url;
    } else if (dto.filePath?.trim()) {
      refImageUrl = dto.filePath.trim();
    }

    const task = await this.recorder.start({
      userId: user.id,
      type: TaskType.jimeng_image,
      prompt: dto.prompt,
      provider: 'jimeng',
      model: dto.model || 'jimeng-image-5.0-lite',
      params: {
        ratio: dto.ratio,
        resolution: dto.resolution,
        sampleStrength: dto.sampleStrength,
        negativePrompt: dto.negativePrompt,
        hasRefImage: !!refImageUrl,
        saveToCharacterId: dto.saveToCharacterId,
        newCharacterName: dto.newCharacterName,
      },
    });
    await this.recorder.log(
      task.id,
      'info',
      `即梦图像生成｜模型=${dto.model || '默认'}｜比例=${dto.ratio || '1:1'}｜分辨率=${dto.resolution || '2k'}${refImageUrl ? '｜含参考图' : ''}`,
    );

    this.runImageTask(task.id, user.id, scope, dto, refImageUrl).catch((e) =>
      this.recorder.fail(task.id, e),
    );
    return { code: 0, message: 'ok', data: { taskId: task.id, status: 'running' } };
  }

  @Post('video/generations')
  async videoGen(@Body() dto: VideoGenDto, @CurrentUser() user: AuthUser) {
    const scope = user.networkScope as NetworkScope;

    // 首/尾帧：本地上传 / 形象库 / 直接 URL
    const frameUrls: string[] = [];
    const first = await this.resolveFrame(user, dto.firstFrameUploadId, dto.firstFrameCharacterId);
    const end = await this.resolveFrame(user, dto.endFrameUploadId, dto.endFrameCharacterId);
    if (first) frameUrls.push(first);
    if (end) frameUrls.push(end);
    for (const u of dto.filePaths || []) {
      if (u?.trim() && frameUrls.length < 2) frameUrls.push(u.trim());
    }

    const task = await this.recorder.start({
      userId: user.id,
      type: TaskType.jimeng_video,
      prompt: dto.prompt,
      provider: 'jimeng',
      model: dto.model || 'jimeng-video-seedance-2.0-mini',
      params: {
        ratio: dto.ratio,
        resolution: dto.resolution,
        duration: dto.duration,
        frames: frameUrls.length,
      },
    });
    await this.recorder.log(
      task.id,
      'info',
      `即梦视频生成｜模型=${dto.model || '默认'}｜比例=${dto.ratio || '自动'}｜分辨率=${dto.resolution || '默认'}｜时长=${dto.duration || 10}s${frameUrls.length ? `｜首/尾帧=${frameUrls.length}张` : ''}`,
    );

    this.runVideoTask(task.id, user.id, scope, dto, frameUrls).catch((e) =>
      this.recorder.fail(task.id, e),
    );
    return { code: 0, message: 'ok', data: { taskId: task.id, status: 'running' } };
  }

  /* ---------------- 内部：异步执行 ---------------- */

  private async resolveFrame(
    user: AuthUser,
    uploadId?: string,
    characterId?: string,
  ): Promise<string | undefined> {
    if (!uploadId && !characterId) return undefined;
    const images = await this.assets.resolveImages(user, { uploadId, characterId });
    return images[0]?.url;
  }

  private async runImageTask(
    taskId: string,
    userId: string,
    scope: NetworkScope,
    dto: ImageGenDto,
    refImageUrl?: string,
  ) {
    const log = this.recorder.logger(taskId);
    const { urls, accountId, creditsUsed } = await this.runWithAccount(
      scope,
      taskId,
      (sessionid) =>
        this.image.generateWithRetry(
          dto.model!,
          dto.prompt,
          { ...dto, filePath: refImageUrl },
          sessionid,
          scope,
        ),
    );
    await log('info', `即梦返回 ${urls.length} 张图片，开始落地…`);

    const localPaths: string[] = [];
    for (const url of urls) {
      try {
        const lp = await this.media.download(url, scope);
        localPaths.push(lp);
        await this.prisma.media.create({ data: { taskId, type: 'image', url, localPath: lp } });
      } catch (e: any) {
        await log('warn', `图片下载失败（仍可用远端链接）：${e?.message}`);
        await this.prisma.media.create({ data: { taskId, type: 'image', url } });
        localPaths.push('');
      }
    }

    // 可选：挂载到形象库
    await this.saveImagesToCharacter(taskId, userId, dto, urls, localPaths);

    await this.recordJimengTask(taskId, userId, 'image', accountId, creditsUsed, urls);
    await this.recorder.succeed(taskId, { urls, localPaths: localPaths.filter(Boolean) });
  }

  private async runVideoTask(
    taskId: string,
    userId: string,
    scope: NetworkScope,
    dto: VideoGenDto,
    frameUrls: string[],
  ) {
    const log = this.recorder.logger(taskId);
    const { urls, accountId, creditsUsed } = await this.runWithAccount(
      scope,
      taskId,
      (sessionid) =>
        this.video.generateWithRetry(
          dto.model!,
          dto.prompt,
          { ...dto, filePaths: frameUrls.length ? frameUrls : undefined },
          sessionid,
          scope,
        ).then((u) => [u]),
    );
    const url = urls[0];
    if (!url) throw new BadRequestException('即梦未返回视频地址');
    await log('info', '即梦返回视频，开始下载落地…');

    let localPath = '';
    try {
      localPath = await this.media.download(url, scope);
      await this.prisma.media.create({ data: { taskId, type: 'video', url, localPath } });
    } catch (e: any) {
      await log('warn', `视频下载失败（仍可用远端链接）：${e?.message}`);
      await this.prisma.media.create({ data: { taskId, type: 'video', url } });
    }

    await this.recordJimengTask(taskId, userId, 'video', accountId, creditsUsed, [url]);
    await this.recorder.succeed(taskId, { urls: [url], localPaths: localPath ? [localPath] : [] });
  }

  /** 生成图挂载到形象库（与 P1 生成形象一致） */
  private async saveImagesToCharacter(
    taskId: string,
    userId: string,
    dto: ImageGenDto,
    urls: string[],
    localPaths: string[],
  ) {
    let characterId = dto.saveToCharacterId;
    if (!characterId && dto.newCharacterName?.trim()) {
      const created = await this.prisma.character.create({
        data: {
          name: dto.newCharacterName.trim(),
          coverUrl: urls[0],
          tags: dto.newCharacterTags || [],
          description: dto.prompt.slice(0, 500),
        },
      });
      characterId = created.id;
      await this.recorder.log(taskId, 'info', `新建形象库条目「${created.name}」`);
    }
    if (!characterId) return;
    for (let i = 0; i < urls.length; i++) {
      await this.prisma.characterImage.create({
        data: {
          characterId,
          url: urls[i],
          localPath: localPaths[i] || null,
          prompt: dto.prompt,
          model: dto.model || 'jimeng',
          createdBy: userId,
        },
      });
    }
    await this.recorder.log(taskId, 'info', `已挂载 ${urls.length} 张图到形象库`);
  }

  /** 记录即梦任务明细（账号 + 积分消耗），供选号权重分析 */
  private async recordJimengTask(
    taskId: string,
    userId: string,
    type: string,
    accountId?: string,
    creditsUsed?: number,
    urls?: string[],
  ) {
    await this.prisma.jimengTask
      .create({
        data: {
          taskId,
          type,
          status: 'completed',
          userId,
          accountId,
          creditsUsed: creditsUsed ?? null,
          resultJson: urls ? ({ urls } as any) : undefined,
        },
      })
      .catch((e) => this.logger.warn(`记录 jimengTask 失败：${e?.message}`));
  }

  /**
   * 选号 → 执行生成 → 登录失败自愈重试一次 → 释放锁。
   * 生成前后各查一次积分，差值即本次消耗（回写账号 credits + jimeng_tasks.creditsUsed）。
   */
  private async runWithAccount(
    scope: NetworkScope,
    taskId: string,
    fn: (sessionid: string) => Promise<string[]>,
  ): Promise<{ urls: string[]; accountId: string; creditsUsed?: number }> {
    const { id, sessionid } = await this.accounts.selectOne();
    const label = id.slice(0, 8);
    await this.recorder.log(taskId, 'info', `号池选号：账号 ${label}…`);

    let creditBefore: number | undefined;
    try {
      creditBefore = (await this.core.getCredit(sessionid, scope)).totalCredit;
    } catch {
      /* 查不到不阻断生成 */
    }

    const settle = async (): Promise<number | undefined> => {
      try {
        const after = (await this.core.getCredit(sessionid, scope)).totalCredit;
        await this.prisma.jimengAccount
          .update({ where: { id }, data: { credits: after } })
          .catch(() => {});
        if (creditBefore !== undefined && after <= creditBefore) {
          const used = creditBefore - after;
          await this.recorder.log(taskId, 'info', `本次消耗积分：${used}（${creditBefore} → ${after}）`);
          // 回写 creditsUsed（累加），供 selectOne 加权选号使用
          await this.prisma.jimengAccount
            .update({ where: { id }, data: { creditsUsed: { increment: used } } })
            .catch(() => {});
          return used;
        }
      } catch {
        /* ignore */
      }
      return undefined;
    };

    try {
      const urls = await fn(sessionid);
      const creditsUsed = await settle();
      return { urls, accountId: id, creditsUsed };
    } catch (err: any) {
      const msg = err?.message || '';
      const loginFailed = /登录|未登录|session|token|鉴权|unauthorized|401/i.test(msg);
      if (loginFailed) {
        this.logger.warn(`账号 ${id} 登录失败，尝试长效 cookie 兑换短效 cookie 自愈: ${msg}`);
        await this.recorder.log(taskId, 'warn', `账号 ${label}… 登录失效，尝试长效 cookie 兑换短效 cookie 自愈`);
        const real = await this.accounts.selfHeal(id, scope);
        if (real) {
          try {
            const urls = await fn(real);
            const creditsUsed = await settle();
            return { urls, accountId: id, creditsUsed };
          } catch (e2: any) {
            await this.markExpired(id);
            throw new BadRequestException(`即梦账号已失效，请重新导出导入 cookie：${e2?.message || ''}`);
          }
        }
        await this.markExpired(id);
        throw new BadRequestException(`即梦账号登录失败，请重新导出导入 cookie：${msg}`);
      }
      throw err;
    } finally {
      this.accounts.release(id);
    }
  }

  private async markExpired(id: string) {
    await this.prisma.jimengAccount.update({ where: { id }, data: { status: 'expired' } }).catch(() => {});
  }
}
