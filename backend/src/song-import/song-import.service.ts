import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.service';
import { Role, NetworkScope } from '../common/roles.enum';
import { AiChannelClient, ChatPart } from '../pipeline/clients/ai-channel.client';
import { MusicSourceService, SongMeta } from './music-source.service';
import { probeDurationSec } from './audio-meta.util';
import { ImportFromTextDto, ImportFromUploadDto } from './dto';

export interface SongImportItemResult {
  id: string;
  title: string;
  artist?: string;
  status: string; // pending_review | active
  skipped: boolean;
  source: 'text' | 'upload';
  coverUrl?: string;
  duration?: number;
  category?: string;
  tags?: string[];
  language?: string;
  description?: string;
  lyrics?: string;
  /** 本条是否真正走了 AI 识别（false=降级为原始信息 + 待分类） */
  aiUsed?: boolean;
  error?: string;
}

export interface SongImportSummary {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  items: SongImportItemResult[];
}

/**
 * 歌曲库批量导入 + AI 识别分类归档。
 *
 * 两条入口：
 *   - fromText：   用户粘贴「歌名-作者」文本 → 调音乐聚合源下载 mp3 → AI 识别基本信息+打标签
 *   - fromUpload： 用户先上传本地音频(得到 uploadId) → ffprobe 读时长 + 文件名猜测 → AI 识别+打标签
 *
 * 所有导入的歌曲**先以 status=pending_review 入库**，由人工在「歌曲库 / 待审核」页
 * 对 AI 给出的标签与基本信息做增删改查后，再「归档」转为 active。
 */
@Injectable()
export class SongImportService {
  private readonly logger = new Logger(SongImportService.name);

  /** AI 识别提示词：要求严格 JSON 输出 */
  private static readonly SYSTEM_PROMPT = [
    '你是音乐素材库的分类编目员。',
    '用户会给你一首歌曲的基本信息（歌名、演唱、时长、歌词片段）。',
    '请据此补全并标准化这首歌曲的元数据，并给出适合素材检索的分类与标签。',
    '',
    '输出要求：',
    '- 只输出一个 JSON 对象，不要任何解释、标题或 markdown 标记。',
    '- 字段：',
    '  title: string 校正后的标准歌名（去多余后缀如 "(Live)" 等，保持原意）',
    '  artist: string 演唱者/歌手（无则空字符串）',
    '  category: string 一级分类，从 [华语流行, 欧美流行, 日韩, 古风, 说唱, 民谣, 电子, 轻音乐, 摇滚, 儿歌, 纯音乐, 其他] 中选最贴合的一个',
    '  tags: string[] 3~6 个细粒度标签（风格/情绪/场景/语言/乐器等，如 ["抒情","伤感","夜晚","钢琴"]）',
    '  language: string 语种，如 "中文"/"英文"/"日语"/"纯音乐"',
    '  description: string 一句话简介（≤40字，可结合歌词情绪）',
    '- 若信息不足，凭歌名与常见认知合理推断，但 tag 务必具体可检索。',
  ].join('\n');

  constructor(
    private prisma: PrismaService,
    private music: MusicSourceService,
    private ai: AiChannelClient,
    private config: ConfigService,
  ) {}

  async importFromText(user: AuthUser, dto: ImportFromTextDto): Promise<SongImportSummary> {
    const items = this.music.parseSongList(dto.text);
    const summary: SongImportSummary = {
      total: items.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      items: [],
    };

    for (const it of items) {
      try {
        const meta = await this.music.fetchSong(it.song, it.artist);
        const localPath = await this.music.download(meta.mp3Url);
        const enableAi = dto.enableAi !== false;
        const info = enableAi
          ? await this.classify(user, {
              title: meta.title,
              artist: meta.artist,
              duration: meta.durationSec,
              lyrics: meta.lyrics,
            })
          : {
              title: meta.title,
              artist: meta.artist || '',
              category: undefined,
              tags: ['待分类'],
              language: undefined,
              description: undefined,
              aiUsed: false,
            };
        const song = await this.upsertSong(
          {
            title: info.title,
            artist: info.artist,
            duration: meta.durationSec,
            category: info.category,
            tags: info.tags,
            description: info.description,
            language: info.language,
            lyrics: meta.lyrics,
            url: meta.mp3Url,
            localPath,
            coverUrl: meta.coverUrl,
            // 开启 AI：进入待审核；关闭 AI：直接入库(active)
            status: enableAi ? 'pending_review' : 'active',
          },
          dto.overwrite,
        );
        if (song.skipped) summary.skipped++;
        else summary.imported++;
        summary.items.push({
          id: song.id,
          title: song.title,
          artist: song.artist,
          status: song.status,
          skipped: song.skipped,
          source: 'text',
          coverUrl: meta.coverUrl,
          duration: meta.durationSec,
          category: info.category,
          tags: info.tags,
          language: info.language,
          description: info.description,
          lyrics: meta.lyrics,
          aiUsed: info.aiUsed,
        });
      } catch (e: any) {
        summary.failed++;
        summary.items.push({
          id: '',
          title: it.song,
          artist: it.artist,
          status: '',
          skipped: false,
          source: 'text',
          error: e?.message || '导入失败',
        });
      }
    }
    return summary;
  }

  async importFromUpload(user: AuthUser, dto: ImportFromUploadDto): Promise<SongImportSummary> {
    const summary: SongImportSummary = {
      total: dto.uploadIds.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      items: [],
    };

    for (const uploadId of dto.uploadIds) {
      try {
        const up = await this.prisma.upload.findUnique({ where: { id: uploadId } });
        if (!up) throw new BadRequestException('上传文件不存在');
        if (user.role !== Role.SUPER_ADMIN && up.userId !== user.id) {
          throw new BadRequestException('无权使用该上传文件');
        }
        const duration = await probeDurationSec(up.localPath, this.config);
        const guessed = this.guessFromFilename(up.filename);
        const enableAi = dto.enableAi !== false;
        const info = enableAi
          ? await this.classify(user, {
              title: guessed.title,
              artist: guessed.artist,
              duration,
              lyrics: undefined,
            })
          : {
              title: guessed.title,
              artist: guessed.artist,
              category: undefined,
              tags: ['待分类'],
              language: undefined,
              description: undefined,
              aiUsed: false,
            };
        const song = await this.upsertSong(
          {
            title: info.title,
            artist: info.artist,
            duration,
            category: info.category,
            tags: info.tags,
            description: info.description,
            language: info.language,
            lyrics: undefined,
            url: up.url, // 用户上传文件的可访问 URL（同用户/管理员可播放）
            localPath: up.localPath,
            coverUrl: undefined,
            // 开启 AI：进入待审核；关闭 AI：直接入库(active)
            status: enableAi ? 'pending_review' : 'active',
          },
          dto.overwrite,
        );
        if (song.skipped) summary.skipped++;
        else summary.imported++;
        summary.items.push({
          id: song.id,
          title: song.title,
          artist: song.artist,
          status: song.status,
          skipped: song.skipped,
          source: 'upload',
          duration,
          category: info.category,
          tags: info.tags,
          language: info.language,
          description: info.description,
          aiUsed: info.aiUsed,
        });
      } catch (e: any) {
        summary.failed++;
        summary.items.push({
          id: '',
          title: uploadId,
          artist: undefined,
          status: '',
          skipped: false,
          source: 'upload',
          error: e?.message || '导入失败',
        });
      }
    }
    return summary;
  }

  /** 对已入库歌曲重新执行 AI 识别（用于识别失败或需重新分类的场景） */
  async reclassifySong(user: AuthUser, songId: string): Promise<{
    id: string;
    title: string;
    artist?: string;
    category?: string;
    tags: string[];
    language?: string;
    description?: string;
  }> {
    const song = await this.prisma.song.findUnique({ where: { id: songId } });
    if (!song) throw new BadRequestException('歌曲不存在');

    const info = await this.classify(user, {
      title: song.title,
      artist: song.artist || undefined,
      duration: song.duration,
      lyrics: song.lyrics || undefined,
    });

    await this.prisma.song.update({
      where: { id: songId },
      data: {
        title: info.title,
        artist: info.artist || null,
        category: info.category || null,
        tags: info.tags,
        language: info.language || null,
        description: info.description || null,
      },
    });

    return {
      id: songId,
      title: info.title,
      artist: info.artist,
      category: info.category,
      tags: info.tags,
      language: info.language,
      description: info.description,
    };
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

  /**
   * 调用 AI 渠道识别歌曲元数据 + 分类标签。
   * 优先用声明支持 song 阶段的渠道；没有则回退到 inspiration 阶段渠道。
   * AI 不可用（无渠道/调用失败/解析失败）时，退化为「原名 + 待分类」标签，保证导入不中断。
   */
  private async classify(
    user: AuthUser,
    meta: { title: string; artist?: string; duration?: number | null; lyrics?: string },
  ): Promise<{
    title: string;
    artist?: string;
    category?: string;
    tags: string[];
    language?: string;
    description?: string;
    aiUsed: boolean;
  }> {
    const fallback = () => ({
      title: meta.title,
      artist: meta.artist || '',
      category: undefined,
      tags: ['待分类'],
      language: undefined,
      description: undefined,
      aiUsed: false,
    });

    let channel;
    try {
      channel = await this.ai.resolve('song', undefined, undefined);
    } catch {
      try {
        channel = await this.ai.resolve('inspiration', undefined, undefined);
      } catch {
        this.logger.warn('无可用 AI 渠道，跳过 AI 识别，使用原始信息 + 待分类标签');
        return fallback();
      }
    }

    const userText = [
      '【歌曲基本信息】',
      `歌名：${meta.title || '未知'}`,
      `演唱：${meta.artist || '未知'}`,
      meta.duration ? `时长：${meta.duration} 秒` : '',
      meta.lyrics ? `歌词片段：\n${meta.lyrics.slice(0, 1500)}` : '（无歌词）',
      '',
      '请按系统指示输出 JSON。',
    ]
      .filter((s) => s !== '')
      .join('\n');

    const parts: ChatPart[] = [{ type: 'text', text: userText }];

    try {
      const raw = await this.ai.chat(channel, user.networkScope, parts, {
        system: SongImportService.SYSTEM_PROMPT,
        temperature: 0.3,
        maxTokens: 600,
      });
      const parsed = this.parseJson(raw);
      if (!parsed || typeof parsed !== 'object') return fallback();
      return {
        title: (parsed.title as string) || meta.title,
        artist: (parsed.artist as string) || meta.artist || '',
        category: (parsed.category as string) || undefined,
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.filter((t: any) => typeof t === 'string').map(String)
          : ['待分类'],
        language: (parsed.language as string) || undefined,
        description: (parsed.description as string) || undefined,
        aiUsed: true,
      };
    } catch (e: any) {
      this.logger.warn(`AI 识别失败，使用原始信息：${e?.message || e}`);
      return fallback();
    }
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

  /** 去重 + 创建/更新；返回是否跳过 */
  private async upsertSong(
    data: {
      title: string;
      artist?: string;
      duration?: number | null;
      category?: string;
      tags?: string[];
      description?: string;
      language?: string;
      lyrics?: string;
      url?: string;
      localPath?: string;
      coverUrl?: string;
      status: string;
    },
    overwrite?: boolean,
  ): Promise<{ id: string; title: string; artist?: string; status: string; skipped: boolean }> {
    const exist = await this.prisma.song.findFirst({
      where: { title: data.title, artist: data.artist || null },
    });
    if (exist) {
      if (!overwrite) {
        return {
          id: exist.id,
          title: exist.title,
          artist: exist.artist || undefined,
          status: exist.status,
          skipped: true,
        };
      }
      const updated = await this.prisma.song.update({
        where: { id: exist.id },
        data: {
          url: data.url ?? exist.url,
          localPath: data.localPath ?? exist.localPath,
          coverUrl: data.coverUrl ?? exist.coverUrl,
          duration: data.duration ?? exist.duration,
          category: data.category ?? exist.category,
          tags: data.tags ?? undefined,
          description: data.description ?? exist.description,
          lyrics: data.lyrics ?? exist.lyrics,
          status: 'pending_review',
        },
      });
      return {
        id: updated.id,
        title: updated.title,
        artist: updated.artist || undefined,
        status: updated.status,
        skipped: false,
      };
    }
    const created = await this.prisma.song.create({
      data: {
        title: data.title,
        artist: data.artist || null,
        url: data.url || null,
        localPath: data.localPath || null,
        coverUrl: data.coverUrl || null,
        duration: data.duration ?? null,
        category: data.category || null,
        tags: data.tags || ['待分类'],
        description: data.description || null,
        lyrics: data.lyrics || null,
        status: data.status,
      },
    });
    return {
      id: created.id,
      title: created.title,
      artist: created.artist || undefined,
      status: created.status,
      skipped: false,
    };
  }
}
