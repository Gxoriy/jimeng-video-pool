import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.service';
import { Executor, PromptType, TaskType } from '../common/roles.enum';
import { AiChannelClient, ChatPart } from './clients/ai-channel.client';
import { AssetResolverService, ResolvedAudio, ResolvedImage } from './asset-resolver.service';
import { TaskRecorderService } from './task-recorder.service';
import { InspirationDto } from './dto/pipeline.dto';

/**
 * ============ 获取灵感 ============
 *
 * 输入：
 *   - 参考图：本地上传 或 从形象库挑选
 *   - 参考音频：本地上传 或 从歌曲库挑选（取音乐信息/歌词）
 * 执行：调用**超级管理员配置的 AI 渠道**（带 vision 的 chat 模型最佳）
 * 产出：两类提示词
 *   - 形象提示词（characterPrompt）：以参考图人物为主体，按歌词换背景/服装，用于生成形象
 *   - 动作提示词（actionPrompt）：用于驱动数字人视频，可直接带入视频生成
 * 两类提示词均可一键存入提示词库（type=character / action）。
 */
@Injectable()
export class InspirationService {
  /**
   * 一次调用产出「两类提示词」：
   *   1) characterPrompt —— 以参考图人物为主体，根据歌词/歌曲情绪更换背景与服装，
   *      用于 P2 生成形象（图生图改写）。
   *   2) actionPrompt —— 用于驱动数字人视频的动作提示词（固定机位、表情手势）。
   * 模型以 JSON 返回 { characterPrompt, actionPrompt }。
   */
  private static readonly SYSTEM_PROMPT = [
    '你是数字人短视频的创意导演，同时负责「形象设计」与「表演设计」。',
    '用户会给你人物形象的参考信息（可能是参考图，也可能是形象的文字描述），以及一首歌曲的音乐信息。',
    '请一次性产出两类提示词，并以 JSON 对象返回（不要任何解释、标题或 markdown 标记）：',
    '',
    '{',
    '  "characterPrompt": "用于 AI 生图的形象提示词",',
    '  "actionPrompt": "用于驱动数字人视频的动作提示词"',
    '}',
    '',
    '【characterPrompt 要求】',
    '1. 以参考形象中的人物为绝对主体，保持其核心特征（脸型、发型、五官气质、年龄感）不变。',
    '2. 根据歌曲的歌词与情绪，更换形象的【背景场景】与【服装/配饰】，让形象契合歌曲氛围。',
    '3. 只输出可直接喂给生图模型的提示词正文，中文，100~220 字，一段话，不要含角色姓名以外的前缀。',
    '4. 禁止凭空更换人物本身（脸/发型/人种），只换场景与穿搭。',
    '5. 若参考形象是文字描述而非图片，请严格依据该描述还原人物特征，不要自行发挥。',
    '',
    '【actionPrompt 要求】',
    '1. 只描述这一个镜头内人物的表演：面部表情、眼神、口型情绪、头部与上半身细微动作、手部动作。',
    '2. 数字人视频为固定机位，禁止运镜、转场、切镜头、多机位、场景切换。',
    '3. 禁止描述第二个人物或大幅位移（走动、跑跳、坐下站起）。',
    '4. 动作幅度自然克制，贴合歌曲情绪与节奏，结合参考图人物气质。',
    '5. 输出中文，60~180 字，一段话。',
    '',
    '参考动作提示词风格：「角色面向镜头深情地演唱，眼神专注微微含笑，随旋律轻点头，双手自然垂放偶尔抬起贴近胸口，固定镜头」。',
  ].join('\n');

  /**
   * 针对「本地上传音频」的 AI 分类提示词：提取曲风/情感等关键音乐信息，
   * 与歌曲库分类同源，输出结构化 JSON 供 buildMusicInfoText 转成文本。
   */
  private static readonly MUSIC_INFO_SYSTEM = [
    '你是音乐素材库的分类编目员。',
    '用户给出一段本地上传音频的基本信息（来自文件名猜测，无音频内容），请据此推断这首歌曲的音乐信息，用于后续创意（形象设计 / 表演设计）。',
    '只输出一个 JSON 对象，不要任何解释、标题或 markdown 标记。',
    '字段：',
    '  title: string 推断的标准歌名（无则空字符串）',
    '  category: string 曲风，从 [华语流行, 欧美流行, 日韩, 古风, 说唱, 民谣, 电子, 轻音乐, 摇滚, 儿歌, 纯音乐, 其他] 中选最贴合的一个',
    '  tags: string[] 3~5 个细粒度标签，侧重【情绪/风格/场景/乐器】，如 ["抒情","伤感","夜晚","钢琴"]',
    '  language: string 语种，如 "中文"/"英文"/"日语"/"纯音乐"（无则空字符串）',
    '  description: string 一句话简介（≤30字，结合曲风与情绪）',
    '若信息不足，凭文件名与常见认知合理推断，但 tag 务必具体可检索。',
  ].join('\n');

  constructor(
    private prisma: PrismaService,
    private ai: AiChannelClient,
    private assets: AssetResolverService,
    private recorder: TaskRecorderService,
  ) {}

  async generate(user: AuthUser, dto: InspirationDto) {
    // ---- 1. 参考图（必须有一张，vision 才有依据）----
    const refs = await this.assets.resolveImages(user, {
      urls: dto.referenceImageUrls,
      uploadId: dto.imageUploadId,
      characterId: dto.referenceCharacterId,
      characterImageId: dto.referenceCharacterImageId,
    });
    if (!refs.length) {
      throw new BadRequestException('请上传参考图片，或从形象库中选择一个形象');
    }

    // ---- 2. 参考音频 / 音乐信息 ----
    const audio = await this.assets.resolveAudio(user, {
      url: dto.audioUrl,
      uploadId: dto.audioUploadId,
      songId: dto.songId,
    });
    if (!audio) {
      throw new BadRequestException('请上传参考音频，或从歌曲库中选择一首歌曲');
    }

    // ---- 3. 渠道 ----
    const channel = await this.ai.resolve('inspiration', dto.channelId, dto.model);

    // ---- 4. 建任务 ----
    // 参考音频一律先转成「文本音乐信息」再喂给模型：
    //   - 歌曲库：直接复用其 AI 已分类的曲风/情感/标签/歌词
    //   - 本地上传：调用 AI 分类（与歌曲库同源）提取曲风/情感等，输出文本
    //   不把音频字节直接发给对话模型，避免网关报 invalid parameter (100007)
    const musicBlock = await this.buildMusicInfoText(user, audio, dto);
    const task = await this.recorder.start({
      userId: user.id,
      type: TaskType.inspiration,
      prompt: musicBlock,
      provider: Executor.AI_CHANNEL,
      model: channel.model,
      params: {
        stage: 'P2',
        channelId: channel.id,
        channelName: channel.name,
        referenceImages: refs.map((r) => r.localPath || (r.url.startsWith('data:') ? '[inline]' : r.url)),
        audioSource: audio.source,
        audioUrl: audio.url,
        songId: dto.songId,
        extraRequirement: dto.extraRequirement,
      },
    });

    await this.recorder.log(
      task.id,
      'info',
      `获取灵感｜渠道=${channel.name}｜模型=${channel.model}｜参考图=${refs.length} 张｜音频来源=${this.sourceLabel(audio.source)}`,
    );

    // 同步诊断：在异步 run() 之前检查内联体积，避免 413 发生时看不到原因
    const resolvedUrls = refs.map((r) => r.url);
    const inlineCount = resolvedUrls.filter((u) => u.startsWith('data:')).length;
    const totalInlineKB = Math.round(
      resolvedUrls.reduce((sum, u) => sum + (u.startsWith('data:') ? u.length : 0), 0) / 1024,
    );
    console.log(
      `[inspiration] 请求体内联图 ${inlineCount} 张，base64 合计 ≈ ${totalInlineKB}KB（单张目标可在 app.maxInlineImageKB 配置，默认 180KB）`,
    );
    if (totalInlineKB > 3000) {
      throw new BadRequestException(
        `参考图过大（内联后约 ${totalInlineKB}KB）且自动降采样未生效，上游网关会拒绝该请求。` +
          `请在 backend 目录执行 npm install 安装 ffmpeg-static（或在 .env 配置 FFMPEG_PATH 指向 ffmpeg），` +
          `也可临时改用较小的参考图。`,
      );
    }
    if (totalInlineKB > 1500) {
      console.warn(
        `[inspiration] 内联图总体积 ≈ ${totalInlineKB}KB 偏大，若网关仍报 413，请调小配置 MAX_INLINE_IMAGE_KB（默认 180）或减少参考图数量。`,
      );
    }

    // 参考形象的文字信息：所选渠道若是纯文本模型（看不到图），靠它还原人物特征
    const characterBlock = this.describeImages(refs);

    this.run(task.id, user, channel, resolvedUrls, characterBlock, musicBlock, dto).catch((e) =>
      this.recorder.fail(task.id, e),
    );

    return { taskId: task.id, status: 'running' };
  }

  private async run(
    taskId: string,
    user: AuthUser,
    channel: Awaited<ReturnType<AiChannelClient['resolve']>>,
    imageUrls: string[],
    characterBlock: string,
    musicBlock: string,
    dto: InspirationDto,
  ) {
    const userText = [
      '【参考形象信息】',
      characterBlock,
      '',
      '【音乐信息】',
      musicBlock,
      '',
      dto.extraRequirement?.trim() ? `【额外要求】\n${dto.extraRequirement.trim()}` : '',
      '',
      '请依据上述参考形象与这首歌的情绪，按系统指示产出 characterPrompt 与 actionPrompt 两段提示词。',
    ]
      .filter((s) => s !== '')
      .join('\n');

    const parts: ChatPart[] = [
      { type: 'text', text: userText },
      ...imageUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ];

    // allowDropImages：纯文本模型收到图片必定空返回，重试时自动去图（形象特征已文本化在 userText 里）
    const raw = await this.ai.chat(channel, user.networkScope, parts, {
      system: InspirationService.SYSTEM_PROMPT,
      temperature: 0.9,
      maxTokens: 1200,
      attempts: 6,
      allowDropImages: true,
    });

    const parsed = this.parseResult(raw);
    const characterPrompt = parsed.characterPrompt || '';
    const actionPrompt = parsed.actionPrompt || this.cleanup(raw);

    await this.recorder.log(
      taskId,
      'info',
      `产出形象提示词（${characterPrompt.length} 字）/ 动作提示词（${actionPrompt.length} 字）`,
    );

    // ---- 可选：存入提示词库（两类都存）----
    if (dto.saveToPromptLibrary) {
      const base = dto.savePromptTitle?.trim();
      const tags = dto.savePromptTags || [];
      if (characterPrompt) {
        const c = await this.prisma.prompt.create({
          data: {
            title: base ? `${base} · 形象` : `形象提示词 ${new Date().toLocaleString('zh-CN')}`,
            content: characterPrompt,
            type: PromptType.character,
            tags,
            createdBy: user.id,
          },
        });
        await this.recorder.log(taskId, 'info', `已存入提示词库（形象）：${c.title}`);
      }
      if (actionPrompt) {
        const a = await this.prisma.prompt.create({
          data: {
            title: base ? `${base} · 动作` : `动作提示词 ${new Date().toLocaleString('zh-CN')}`,
            content: actionPrompt,
            type: PromptType.action,
            tags,
            createdBy: user.id,
          },
        });
        await this.recorder.log(taskId, 'info', `已存入提示词库（动作）：${a.title}`);
      }
    }

    // resultText 保留动作提示词（P3 向后兼容）；resultData 存结构化两段结果
    await this.recorder.succeed(taskId, {
      text: actionPrompt,
      json: { characterPrompt, actionPrompt },
    });
  }

  /**
   * 把参考音频整理为「文本音乐信息」喂给模型。全程不把音频字节发给对话模型，
   * 规避网关 invalid parameter (100007) 502。
   *  - 歌曲库：结构化信息（曲风/情感/标签/语种/简介）已在 resolveAudio 中直接带出，无需再查库或调 AI。
   *  - 本地上传：调用 AI 分类（与歌曲库同源，纯文本/文件名推断）提取曲风/情感等。
   *  - 外链/兜底：用已有的元数据。
   */
  private async buildMusicInfoText(
    user: AuthUser,
    audio: ResolvedAudio,
    _dto: InspirationDto,
  ): Promise<string> {
    // 1) 歌曲库：直接复用已存储的结构化信息，零额外调用
    if (audio.source === 'song') {
      return this.describeAudio(audio);
    }

    // 2) 本地上传音频：AI 提取音乐信息（曲风/情感/语种），与歌曲库分类同源
    if (audio.source === 'upload') {
      const info = await this.analyzeUploadMusicInfo(user, audio);
      if (info) {
        const enriched: ResolvedAudio = {
          ...audio,
          title: info.title || audio.title,
          category: info.category,
          tags: info.tags,
          description: info.description,
          language: info.language,
        };
        return this.describeAudio(enriched);
      }
    }

    // 3) 外链 / 兜底（无 AI 信息时，给出通用描述）
    return this.describeAudio(audio);
  }

  /**
   * 针对本地上传的音频，调用 AI 渠道（优先 song 阶段，回退 inspiration）提取
   * 曲风/情感等关键音乐信息，输出为结构化文本，复用歌曲库分类逻辑。
   * AI 不可用或解析失败时返回 null，交由 buildMusicInfoText 走兜底文案。
   */
  private async analyzeUploadMusicInfo(
    user: AuthUser,
    audio: ResolvedAudio,
  ): Promise<{
    title?: string;
    category?: string;
    tags: string[];
    language?: string;
    description?: string;
  } | null> {
    let channel;
    try {
      channel = await this.ai.resolve('song');
    } catch {
      try {
        channel = await this.ai.resolve('inspiration');
      } catch {
        return null;
      }
    }

    const guessed = this.guessFromFilename(audio.title || '');
    const userText = [
      '【本地上传音频基本信息】',
      `文件名推断歌名：${guessed.title || '未知'}`,
      `文件名推断演唱：${guessed.artist || '未知'}`,
      audio.duration ? `时长：${audio.duration} 秒` : '',
      '（无歌词，请凭曲名与常见认知推断曲风与情绪）',
      '请按系统指示输出 JSON。',
    ]
      .filter((s) => s !== '')
      .join('\n');

    const parts: ChatPart[] = [{ type: 'text', text: userText }];

    try {
      const raw = await this.ai.chat(channel, user.networkScope, parts, {
        system: InspirationService.MUSIC_INFO_SYSTEM,
        temperature: 0.3,
        maxTokens: 400,
      });
      const p = this.parseJson(raw);
      if (!p || typeof p !== 'object') return null;
      return {
        title: (p.title as string) || guessed.title,
        category: (p.category as string) || undefined,
        tags: Array.isArray(p.tags)
          ? p.tags.filter((t: any) => typeof t === 'string').map(String)
          : [],
        language: (p.language as string) || undefined,
        description: (p.description as string) || undefined,
      };
    } catch {
      return null;
    }
  }

  /** 从文件名猜测「歌名-作者」 */
  private guessFromFilename(filename: string): { title: string; artist: string } {
    const base = filename.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    const parts = base.split(/[-—–]/);
    if (parts.length >= 2) {
      return { title: parts[0].trim(), artist: parts.slice(1).join('-').trim() };
    }
    return { title: base, artist: '' };
  }

  /** 从模型文本中稳健抽取 JSON 对象 */
  private parseJson(text: string): any {
    if (!text) return null;
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        /* ignore */
      }
    }
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }

  /**
   * 把音频/歌曲整理为文字信息（统一格式化）。
   * 优先使用「结构化信息」（曲风/情感标签/简介/语种），这些来自歌曲库已分类结果
   * 或本地音频的 AI 识别结果；只在完全没有结构化简介时，才附一段歌词片段（≤300 字，
   * 缩短以减小请求体，规避网关 413）。
   */
  private describeAudio(audio: ResolvedAudio): string {
    const bits: string[] = [];

    if (audio.title) bits.push(`歌名：《${audio.title}》`);
    if (audio.artist) bits.push(`演唱：${audio.artist}`);
    if (audio.duration) bits.push(`时长：${audio.duration} 秒`);

    // ✅ 优先使用结构化信息（来自歌曲库 / 本地音频 AI 识别）
    if (audio.category) bits.push(`曲风：${audio.category}`);
    if (audio.tags?.length) bits.push(`情感/风格：${audio.tags.join('、')}`);
    if (audio.description) bits.push(`简介：${audio.description}`);
    if (audio.language) bits.push(`语种：${audio.language}`);

    // ⚠️ 只在没有结构化简介时才附歌词，并缩短到 300 字符，避免请求体过大触发 413
    if (audio.lyrics && !audio.description) {
      bits.push(`歌词片段：\n${audio.lyrics.slice(0, 300)}`);
    }

    if (!bits.length) {
      bits.push(
        `用户上传了一段参考音频（${audio.url || audio.localPath || '本地文件'}），未提供歌词信息，请按通用抒情演唱场景设计动作。`,
      );
    }

    return bits.join('\n');
  }

  /**
   * 把参考图整理为「文字形象信息」。与音频文本化同一思路：
   * 当所选 AI 渠道是纯文本模型（看不到图）时，模型仍能据此还原人物特征，
   * 而不是凭空捏造一个人。若渠道支持读图，这段文字也只是额外补强。
   */
  private describeImages(refs: ResolvedImage[]): string {
    const bits: string[] = [];

    for (const r of refs) {
      if (r.source === 'character') {
        if (r.name) bits.push(`形象名称：${r.name}`);
        if (r.tags?.length) bits.push(`形象标签：${r.tags.join('、')}`);
        if (r.description) bits.push(`形象描述：${r.description}`);
        // 该图当初的生成提示词，对还原人物外观最精确
        if (r.genPrompt) bits.push(`该形象图的原始生成提示词：${r.genPrompt.slice(0, 400)}`);
      } else if (r.source === 'upload' && r.filename) {
        bits.push(`用户上传的参考图文件名：${r.filename}`);
      }
    }

    if (!bits.length) {
      bits.push(
        '用户提供了参考图，但没有可用的文字描述。若你无法读取图片，请设计一位气质契合歌曲情绪的通用人物形象，' +
          '并在描述中保持人物特征前后一致。',
      );
    }

    return bits.join('\n');
  }

  private sourceLabel(source: ResolvedAudio['source']) {
    return { upload: '本地上传', song: '歌曲库', url: '外链' }[source] || source;
  }

  /** 去掉模型爱加的引号/标题/markdown */
  private cleanup(text: string): string {
    return text
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/```\s*$/, '')
      .replace(/^\s*(动作提示词|提示词|prompt)\s*[:：]\s*/i, '')
      .replace(/^[「"'“]|[」"'”]$/g, '')
      .trim();
  }

  /** 从模型文本中稳健抽取 { characterPrompt, actionPrompt } JSON */
  private parseResult(text: string): { characterPrompt: string; actionPrompt: string } {
    const fallback = { characterPrompt: '', actionPrompt: '' };
    if (!text) return fallback;
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end <= start) return fallback;
    try {
      const obj = JSON.parse(t.slice(start, end + 1));
      return {
        characterPrompt: this.cleanup(String(obj.characterPrompt || '')),
        actionPrompt: this.cleanup(String(obj.actionPrompt || '')),
      };
    } catch {
      return fallback;
    }
  }
}
