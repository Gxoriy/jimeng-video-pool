import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.service';
import { Role, NetworkScope } from '../common/roles.enum';
import { AiChannelClient, ChatPart } from '../pipeline/clients/ai-channel.client';
import { ImportCharactersFromUploadDto } from './dto';
import { inlineImageDataUri } from '../common/image-inline.util';

export interface CharacterImportItemResult {
  id: string;
  name: string;
  status: string; // pending_review | active
  skipped: boolean;
  coverUrl?: string;
  category?: string;
  tags?: string[];
  description?: string;
  error?: string;
}

export interface CharacterImportSummary {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  items: CharacterImportItemResult[];
}

/**
 * 形象库批量导入 + 视觉 AI 识别分类归档（参考歌曲库设计）。
 *
 * 入口：fromUpload —— 用户先上传本地图片(png/jpg) 得到 uploadId → 视觉 AI 识别主体
 *       并给出名称/分类/标签/描述 → 以 status=pending_review 入库，由人工审核归档。
 */
@Injectable()
export class CharacterImportService {
  private readonly logger = new Logger(CharacterImportService.name);

  private static readonly SYSTEM_PROMPT = [
    '你是形象素材库的视觉编目员。',
    '用户会给你一张人物/形象图片。请识别图片内容，给出适合素材检索的元数据。',
    '',
    '输出要求：',
    '- 只输出一个 JSON 对象，不要任何解释、标题或 markdown 标记。',
    '- 字段：',
    '  name: string 形象名称（基于视觉的简洁称呼，如「红裙少女」「西装男士」「古风女子」，2~8字）',
    '  category: string 一级分类，从 [写实人物, 二次元, 古风, 商务, 儿童, 虚拟主播, 其他] 中选最贴合的一个',
    '  tags: string[] 3~6 个细粒度标签（风格/性别/年龄/场景/服装等，如 ["女性","青年","红裙","夜景"]）',
    '  description: string 一句话描述（≤40字）',
    '- 若信息不足，凭视觉合理推断，但 tag 务必具体可检索。',
  ].join('\n');

  constructor(
    private prisma: PrismaService,
    private ai: AiChannelClient,
    private config: ConfigService,
  ) {}

  async importFromUpload(
    user: AuthUser,
    dto: ImportCharactersFromUploadDto,
  ): Promise<CharacterImportSummary> {
    const summary: CharacterImportSummary = {
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
        if (up.kind !== 'image') throw new BadRequestException('仅支持图片文件');
        if (user.role !== Role.SUPER_ADMIN && up.userId !== user.id) {
          throw new BadRequestException('无权使用该上传文件');
        }

        const info = await this.classify(up.localPath, up.mimeType, up.filename, up.size);

        const character = await this.upsertCharacter(
          {
            name: info.name,
            coverUrl: up.url, // 浏览器同源可直接 /api/files/xxx 预览
            category: info.category,
            tags: info.tags,
            description: info.description,
            status: 'pending_review',
          },
          dto.overwrite,
        );

        if (character.skipped) summary.skipped++;
        else summary.imported++;

        // 同时把上传图登记为形象下的一张图，便于审核预览与后续生成引用
        if (!character.skipped) {
          await this.prisma.characterImage.create({
            data: { characterId: character.id, url: up.url, localPath: up.localPath, createdBy: user.id },
          });
        }

        summary.items.push({
          id: character.id,
          name: character.name,
          status: character.status,
          skipped: character.skipped,
          coverUrl: up.url,
          category: info.category,
          tags: info.tags,
          description: info.description,
        });
      } catch (e: any) {
        summary.failed++;
        summary.items.push({
          id: '',
          name: uploadId,
          status: '',
          skipped: false,
          error: e?.message || '导入失败',
        });
      }
    }
    return summary;
  }

  /**
   * 视觉识别：读取本地图片转 data URI 发给支持 vision 的 AI 渠道。
   * 文件过大（>6MB）或识别失败时回退为「文件名猜测 + 待分类」，保证导入不中断。
   */
  private async classify(
    localPath: string,
    mimeType: string,
    filename: string,
    size: number,
  ): Promise<{ name: string; category?: string; tags: string[]; description?: string }> {
    const fallback = () => {
      const guess = this.guessFromFilename(filename);
      return {
        name: guess || filename.replace(/\.[^.]+$/, ''),
        category: undefined,
        tags: ['待分类'],
        description: undefined,
      };
    };

    // 大图会先经 ffmpeg 降采样再内联（见下方 inlineImageDataUri），故这里放宽到 40MB；
    // 超过则多为异常文件，直接用文件名猜测，避免无谓的解码开销。
    if (size > 40 * 1024 * 1024) {
      this.logger.warn(`图片过大(${size}B)，跳过视觉识别，使用文件名猜测`);
      return fallback();
    }

    let channel;
    try {
      channel = await this.ai.resolve('character', undefined, undefined);
    } catch {
      try {
        channel = await this.ai.resolve('inspiration', undefined, undefined);
      } catch {
        this.logger.warn('无可用 AI 渠道，跳过视觉识别');
        return fallback();
      }
    }

    // 降采样后再内联，避免大图 base64 撑爆网关请求体（413 request body too large）
    let dataUri: string;
    try {
      const r = await inlineImageDataUri(localPath, {
        targetKB: Number(this.config.get('app.maxInlineImageKB')) || undefined,
        ffmpegPath: this.config.get<string>('app.ffmpegPath'),
        mimeType,
      });
      this.logger.log(`视觉识别内联图片 base64=${r.kb}KB (降采样=${r.downscaled})`);
      dataUri = r.dataUri;
    } catch {
      return fallback();
    }

    const parts: ChatPart[] = [
      { type: 'text', text: '请按系统指示识别这张图片并输出 JSON。' },
      { type: 'image_url', image_url: { url: dataUri } },
    ];

    try {
      const raw = await this.ai.chat(channel, NetworkScope.BROAD, parts, {
        system: CharacterImportService.SYSTEM_PROMPT,
        temperature: 0.4,
        maxTokens: 500,
      });
      const parsed = this.parseJson(raw);
      if (!parsed || typeof parsed !== 'object') return fallback();
      return {
        name: (parsed.name as string) || fallback().name,
        category: (parsed.category as string) || undefined,
        tags: Array.isArray(parsed.tags)
          ? (parsed.tags as any[]).filter((t) => typeof t === 'string').map(String)
          : ['待分类'],
        description: (parsed.description as string) || undefined,
      };
    } catch (e: any) {
      this.logger.warn(`视觉识别失败，使用文件名猜测：${e?.message || e}`);
      return fallback();
    }
  }

  /** 从文件名猜测名称 */
  private guessFromFilename(filename: string): string {
    return filename.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
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
  private async upsertCharacter(
    data: {
      name: string;
      coverUrl?: string;
      category?: string;
      tags?: string[];
      description?: string;
      status: string;
    },
    overwrite?: boolean,
  ): Promise<{ id: string; name: string; status: string; skipped: boolean }> {
    const exist = await this.prisma.character.findFirst({ where: { name: data.name } });
    if (exist) {
      if (!overwrite) {
        return { id: exist.id, name: exist.name, status: exist.status, skipped: true };
      }
      const updated = await this.prisma.character.update({
        where: { id: exist.id },
        data: {
          coverUrl: data.coverUrl ?? exist.coverUrl,
          category: data.category ?? exist.category,
          tags: data.tags ?? undefined,
          description: data.description ?? exist.description,
          status: 'pending_review',
        },
      });
      return { id: updated.id, name: updated.name, status: updated.status, skipped: false };
    }
    const created = await this.prisma.character.create({
      data: {
        name: data.name,
        coverUrl: data.coverUrl || null,
        category: data.category || null,
        tags: data.tags || ['待分类'],
        description: data.description || null,
        status: data.status,
      },
    });
    return { id: created.id, name: created.name, status: created.status, skipped: false };
  }
}
