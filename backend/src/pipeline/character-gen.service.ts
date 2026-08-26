import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { AuthUser } from '../auth/auth.service';
import { Executor, NetworkScope, TaskType } from '../common/roles.enum';
import { AiChannelClient } from './clients/ai-channel.client';
import { AssetResolverService } from './asset-resolver.service';
import { TaskRecorderService } from './task-recorder.service';
import { CharacterGenDto } from './dto/pipeline.dto';
import { JimengCoreService } from '../jimeng/jimeng-core.service';
import { JimengAccountService } from '../jimeng/jimeng-account.service';
import { SettingsService } from '../settings/settings.service';
import { decrypt } from '../common/utils/encryption.util';

/**
 * ============ P1 · 生成形象 ============
 *
 * 输入：
 *   - 提示词（必填）：手动填写 或 从提示词库按标签挑选
 *   - 参考图（可选）：本地上传 或 从形象库挑选
 *   - 音乐信息（可选）：从歌曲库挑选，让形象契合歌曲气质
 * 执行：调用**超级管理员配置的 AI 渠道**（OpenAI 兼容）
 * 产出：形象图，可直接入形象库
 */
@Injectable()
export class CharacterGenService {
  constructor(
    private prisma: PrismaService,
    private ai: AiChannelClient,
    private assets: AssetResolverService,
    private media: MediaService,
    private recorder: TaskRecorderService,
    private jimengCore: JimengCoreService,
    private jimengAccounts: JimengAccountService,
    private settings: SettingsService,
  ) {}

  async generate(user: AuthUser, dto: CharacterGenDto) {
    // ---- 1. 提示词（必填）----
    const promptText = await this.resolvePrompt(dto);

    // ---- 2. 参考图（可选）+ 音乐信息（可选）----
    const refs = await this.assets.resolveImages(user, {
      urls: dto.referenceImageUrls,
      uploadId: dto.imageUploadId,
      characterId: dto.referenceCharacterId,
      characterImageId: dto.referenceCharacterImageId,
    });
    const songInfo = await this.assets.songInfo(dto.songId);
    const finalPrompt = this.composePrompt(promptText, songInfo, refs.length > 0);

    // ---- 3. 即梦原生生成分支 ----
    if (dto.source === 'jimeng') {
      // 管理员关闭即梦功能时，即便前端隐藏了入口也要在后端兜底拒绝
      if (!(await this.settings.isJimengEnabled())) {
        throw new BadRequestException(
          '即梦生成已被管理员关闭（请到「用户管理」重新开启「显示即梦功能」）',
        );
      }
      const model = dto.jimengModel || 'jimeng-5.0';
      const task = await this.recorder.start({
        userId: user.id,
        type: TaskType.character,
        prompt: finalPrompt,
        provider: Executor.JIMENG,
        model,
        params: {
          stage: 'P1',
          source: 'jimeng',
          jimengModel: model,
          promptId: dto.promptId,
          songId: dto.songId,
          referenceImages: refs.map((r) => (r.url.startsWith('data:') ? '[inline]' : r.url)),
          size: dto.size,
          n: dto.n,
        },
      });
      await this.recorder.log(
        task.id,
        'info',
        `P1 生成形象（即梦）｜模型=${model}｜参考图=${refs.length} 张｜音乐信息=${songInfo ? '有' : '无'}`,
      );
      this.runJimeng(task.id, user, finalPrompt, refs[0]?.url, model, dto).catch((e) =>
        this.recorder.fail(task.id, e),
      );
      return { taskId: task.id, status: 'running', prompt: finalPrompt };
    }

    // ---- 4. AI 渠道分支 ----
    const channel = await this.ai.resolve('character', dto.channelId, dto.model);

    // ---- 5. 建任务 ----
    const task = await this.recorder.start({
      userId: user.id,
      type: TaskType.character,
      prompt: finalPrompt,
      provider: Executor.AI_CHANNEL,
      model: channel.model,
      params: {
        stage: 'P1',
        channelId: channel.id,
        channelName: channel.name,
        promptId: dto.promptId,
        songId: dto.songId,
        referenceImages: refs.map((r) => r.localPath || (r.url.startsWith('data:') ? '[inline]' : r.url)),
        ratio: dto.ratio,
        resolution: dto.resolution,
        size: dto.size,
        n: dto.n,
      },
    });

    await this.recorder.log(
      task.id,
      'info',
      `P1 生成形象｜渠道=${channel.name}｜模型=${channel.model}｜参考图=${refs.length} 张｜音乐信息=${songInfo ? '有' : '无'}`,
    );

    // ---- 6. 异步执行 ----
    this.run(task.id, user, channel, finalPrompt, refs.map((r) => r.url), dto).catch((e) =>
      this.recorder.fail(task.id, e),
    );

    return { taskId: task.id, status: 'running', prompt: finalPrompt };
  }

  /** 即梦分支：直连原生 aigc_draft，阻塞轮询到完成，复用 proven 的 core 方法 */
  private async runJimeng(
    taskId: string,
    user: AuthUser,
    prompt: string,
    referenceImageUrl: string | undefined,
    model: string,
    dto: CharacterGenDto,
  ) {
    const account = await this.jimengAccounts.selectOne();
    if (!account) {
      throw new BadRequestException('没有可用的即梦账号，请先在「即梦账号池」中导入并激活账号');
    }
    try {
      const sessionid = decrypt(account.sessionid);
      if (!sessionid) {
        throw new BadRequestException('即梦账号 sessionid 无法解密，请重新导入账号');
      }

      const ratio = dto.ratio || this.mapSizeToRatio(dto.size);
      const resolution = dto.resolution || '2k';
      const { task_id } = await this.jimengCore.generateImage(
        sessionid,
        { prompt, ratio, resolution, model, imageUrl: referenceImageUrl || undefined },
        NetworkScope.RESTRICTED,
      );
      await this.recorder.log(taskId, 'info', `即梦已提交，外部任务=${task_id}`);

      let images: string[] = [];
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const r = await this.jimengCore.queryImageResult(task_id, sessionid, NetworkScope.RESTRICTED);
        if (r.status_code === 2) {
          images = r.images || [];
          break;
        }
        if (r.status_code === 3) {
          throw new BadRequestException(`即梦生成失败：${r.status_msg || '未知错误'}`);
        }
      }
      if (!images.length) {
        throw new BadRequestException('即梦生成超时或未产出图片');
      }

      const items: Array<{ url: string; localPath: string | null }> = [];
      for (const url of images) {
        let localPath: string | null = null;
        try {
          // 即梦图片 CDN 需要 Referer 防盗链，否则只能下到 1x1 占位图
          const lp = await this.media.download(url, NetworkScope.RESTRICTED, {
            trusted: true,
            headers: { Referer: 'https://jimeng.jianying.com/ai-tool/image/generate' },
          });
          localPath = lp;
        } catch (e: any) {
          await this.recorder.log(taskId, 'warn', `图片下载失败：${e?.message}`);
        }
        // url 保留为外部预览地址，本地副本优先展示
        items.push({ url, localPath });
      }
      if (!items.length) throw new BadRequestException('未产出任何图片');

      await this.saveToLibrary(taskId, user, dto, prompt, model, items);
      await this.recorder.succeed(taskId, {
        urls: items.map((i) => i.url),
        localPaths: items.map((i) => i.localPath),
      });
    } finally {
      this.jimengAccounts.release(account.id);
    }
  }

  /** 把 AI 渠道的 size（如 1024x1024 / 1:1）粗略映射到即梦 ratio */
  private mapSizeToRatio(size?: string): string {
    if (!size) return '1:1';
    if (size.includes(':')) return size;
    const m = /(\d+)\s*[xX]\s*(\d+)/.exec(size);
    if (!m) return '1:1';
    const w = Number(m[1]);
    const h = Number(m[2]);
    const r = w / h;
    if (r > 1.3) return '16:9';
    if (r >= 0.75) return '1:1';
    return '3:4';
  }

  private async run(
    taskId: string,
    user: AuthUser,
    channel: Awaited<ReturnType<AiChannelClient['resolve']>>,
    prompt: string,
    referenceImageUrls: string[],
    dto: CharacterGenDto,
  ) {
    const { urls, b64 } = await this.ai.generateImage(channel, user.networkScope, prompt, {
      size: dto.size,
      n: dto.n,
      ratio: dto.ratio,
      quality: dto.resolution,
      referenceImageUrls,
    });
    await this.recorder.log(taskId, 'info', `渠道返回 ${urls.length} 个 URL / ${b64.length} 个 base64`);

    // 每张图：下载落盘（本地副本优先展示），url 保留为外部预览地址（仅预览，过期不影响本地副本）
    const items: Array<{ url: string; localPath: string | null; fromBase64?: boolean }> = [];

    for (const url of urls) {
      let localPath: string | null = null;
      try {
        const lp = await this.media.download(url, user.networkScope, { trusted: true });
        localPath = lp;
      } catch (e: any) {
        await this.recorder.log(taskId, 'warn', `图片下载失败：${e?.message}`);
      }
      items.push({ url, localPath });
    }
    for (const raw of b64) {
      const lp = await this.media.saveBase64(raw);
      // base64 图没有外部 url：留空，待入库后改写为本地 serve 地址
      items.push({ url: '', localPath: lp, fromBase64: true });
    }

    if (!items.length) throw new BadRequestException('未产出任何图片');

    // ---- 入形象库 ----
    await this.saveToLibrary(taskId, user, dto, prompt, channel.model, items);

    await this.recorder.succeed(taskId, {
      urls: items.map((i) => i.url),
      localPaths: items.map((i) => i.localPath),
    });
  }

  private async saveToLibrary(
    taskId: string,
    user: AuthUser,
    dto: CharacterGenDto,
    prompt: string,
    model: string,
    items: Array<{ url: string; localPath: string | null; fromBase64?: boolean }>,
  ) {
    let characterId = dto.saveToCharacterId;

    if (!characterId && dto.newCharacterName?.trim()) {
      const created = await this.prisma.character.create({
        data: {
          name: dto.newCharacterName.trim(),
          coverUrl: undefined,
          tags: dto.newCharacterTags || [],
          description: prompt.slice(0, 500),
        },
      });
      characterId = created.id;
      await this.recorder.log(taskId, 'info', `新建形象库条目「${created.name}」`);
    }

    if (!characterId) return;

    let firstImageId: string | null = null;
    let firstCoverUrl: string | null = null;
    for (const it of items) {
      const row = await this.prisma.characterImage.create({
        data: {
          characterId,
          url: it.url || 'local',
          localPath: it.localPath ?? null,
          prompt,
          model,
          createdBy: user.id,
        },
      });
      // base64 图没有外部 url：入库后把 url 改写为本地 serve 地址
      if (it.fromBase64 && it.localPath) {
        const serve = this.media.characterImageServeUrl(row.id);
        await this.prisma.characterImage.update({ where: { id: row.id }, data: { url: serve } });
      }
      if (!firstImageId) {
        firstImageId = row.id;
        // 封面优先展示本地副本：有 localPath 用本地 serve 地址，否则退回外部预览 url
        firstCoverUrl = it.localPath ? this.media.characterImageServeUrl(row.id) : row.url;
      }
    }

    // 封面：仅在该形象尚无封面时补一张（优先本地副本）
    if (firstImageId && firstCoverUrl) {
      const c = await this.prisma.character.findUnique({
        where: { id: characterId },
        select: { coverUrl: true },
      });
      if (!c?.coverUrl) {
        await this.prisma.character.update({ where: { id: characterId }, data: { coverUrl: firstCoverUrl } });
      }
    }
    await this.recorder.log(taskId, 'info', `已挂载 ${items.length} 张图到形象库`);
  }

  /** 提示词：优先库里挑的，其次手填；两者都无则报错（需求：必填） */
  private async resolvePrompt(dto: CharacterGenDto): Promise<string> {
    if (dto.promptId) {
      const p = await this.prisma.prompt.findUnique({ where: { id: dto.promptId } });
      if (!p) throw new BadRequestException('所选提示词不存在');
      const extra = dto.promptText?.trim();
      return extra ? `${p.content}\n\n补充要求：${extra}` : p.content;
    }
    const text = dto.promptText?.trim();
    if (!text) {
      throw new BadRequestException('提示词为必填项：请手动填写，或从提示词库中选择');
    }
    return text;
  }

  private composePrompt(prompt: string, songInfo: string | null, hasRef: boolean): string {
    const blocks = [prompt];
    if (songInfo) {
      blocks.push(
        `\n【音乐信息】请让形象的气质、服装、场景与下列歌曲相契合：\n${songInfo}`,
      );
    }
    if (hasRef) {
      blocks.push('\n【参考图】请保持参考图中人物的核心特征（脸型、发型、气质）一致。');
    }
    return blocks.join('\n');
  }
}
