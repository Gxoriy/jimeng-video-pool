import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { AuthUser } from '../auth/auth.service';
import { Executor, TaskType } from '../common/roles.enum';
import { AiChannelClient } from './clients/ai-channel.client';
import { AssetResolverService } from './asset-resolver.service';
import { TaskRecorderService } from './task-recorder.service';
import { CharacterGenDto } from './dto/pipeline.dto';

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
  ) {}

  async generate(user: AuthUser, dto: CharacterGenDto) {
    // ---- 1. 提示词（必填）----
    const promptText = await this.resolvePrompt(dto);

    // ---- 2. 渠道 ----
    const channel = await this.ai.resolve('character', dto.channelId, dto.model);

    // ---- 3. 参考图（可选）+ 音乐信息（可选）----
    const refs = await this.assets.resolveImages(user, {
      urls: dto.referenceImageUrls,
      uploadId: dto.imageUploadId,
      characterId: dto.referenceCharacterId,
      characterImageId: dto.referenceCharacterImageId,
    });
    const songInfo = await this.assets.songInfo(dto.songId);

    const finalPrompt = this.composePrompt(promptText, songInfo, refs.length > 0);

    // ---- 4. 建任务 ----
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
        size: dto.size,
        n: dto.n,
      },
    });

    await this.recorder.log(
      task.id,
      'info',
      `P1 生成形象｜渠道=${channel.name}｜模型=${channel.model}｜参考图=${refs.length} 张｜音乐信息=${songInfo ? '有' : '无'}`,
    );

    // ---- 5. 异步执行 ----
    this.run(task.id, user, channel, finalPrompt, refs.map((r) => r.url), dto).catch((e) =>
      this.recorder.fail(task.id, e),
    );

    return { taskId: task.id, status: 'running', prompt: finalPrompt };
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
      referenceImageUrls,
    });
    await this.recorder.log(taskId, 'info', `渠道返回 ${urls.length} 个 URL / ${b64.length} 个 base64`);

    const resultUrls: string[] = [];
    const localPaths: string[] = [];

    for (const url of urls) {
      resultUrls.push(url);
      try {
        const lp = await this.media.download(url, user.networkScope);
        localPaths.push(lp);
        await this.prisma.media.create({
          data: { taskId, type: 'image', url, localPath: lp },
        });
      } catch (e: any) {
        await this.recorder.log(taskId, 'warn', `图片下载失败：${e?.message}`);
      }
    }
    for (const raw of b64) {
      const lp = await this.media.saveBase64(raw);
      localPaths.push(lp);
      resultUrls.push(`file://${lp}`);
      await this.prisma.media.create({
        data: { taskId, type: 'image', url: `file://${lp}`, localPath: lp },
      });
    }

    if (!resultUrls.length) throw new BadRequestException('未产出任何图片');

    // ---- 入形象库 ----
    await this.saveToLibrary(taskId, user, dto, prompt, channel.model, resultUrls, localPaths);

    await this.recorder.succeed(taskId, { urls: resultUrls, localPaths });
  }

  private async saveToLibrary(
    taskId: string,
    user: AuthUser,
    dto: CharacterGenDto,
    prompt: string,
    model: string,
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
          description: prompt.slice(0, 500),
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
          localPath: localPaths[i] ?? null,
          prompt,
          model,
          createdBy: user.id,
        },
      });
    }
    await this.recorder.log(taskId, 'info', `已挂载 ${urls.length} 张图到形象库`);
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
