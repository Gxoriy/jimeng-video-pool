import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.service';
import { PromptType, NetworkScope, Role } from '../common/roles.enum';
import { PaginationDto } from '../common/dto/pagination.dto';
import { AiChannelClient, ChatPart } from '../pipeline/clients/ai-channel.client';
import {
  CreateCharacterDto,
  UpdateCharacterDto,
  CreateSongDto,
  UpdateSongDto,
  CreatePromptDto,
  UpdatePromptDto,
  BatchImportCharactersDto,
  BatchImportSongsDto,
  BatchImportPromptsDto,
  AppendCharacterImagesDto,
  PatchCharacterImageDto,
} from './dto';

/**
 * 三大素材库：形象库 / 歌曲库 / 提示词库。
 *
 * 说明：原「形象换景重生图」已并入 P1 生成形象
 * （POST /pipeline/character，传 referenceCharacterId + songId + saveToCharacterId），
 * 因此本服务不再依赖任何生成能力，只做 CRUD 与批量导入。
 */
@Injectable()
export class LibrariesService {
  private readonly logger = new Logger(LibrariesService.name);

  constructor(
    private prisma: PrismaService,
    private ai: AiChannelClient,
  ) {}

  private whereLike(q?: string) {
    return q ? { contains: q } : undefined;
  }

  private order(sort?: string, order?: string) {
    if (sort) return { [sort]: order === 'asc' ? 'asc' : 'desc' };
    return { createdAt: 'desc' as const };
  }

  // ---------------- 形象库 ----------------
  async listCharacters(dto: PaginationDto, status?: string) {
    const where: any = {
      name: this.whereLike(dto.q),
      category: dto.category || undefined,
      ...(dto.tag ? { tags: { has: dto.tag } } : {}),
      // 必须按入库状态过滤：active=已归档可见，pending_review=待审核
      ...(status ? { status } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.character.findMany({
        where,
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
        orderBy: this.order(dto.sort, dto.order),
        include: { images: { orderBy: { createdAt: 'desc' }, take: 8 } },
      }),
      this.prisma.character.count({ where }),
    ]);
    return { data, total, page: dto.page, pageSize: dto.pageSize };
  }

  async getCharacter(id: string) {
    const c = await this.prisma.character.findUnique({
      where: { id },
      include: { images: { orderBy: { createdAt: 'desc' } } },
    });
    if (!c) throw new NotFoundException('形象不存在');
    return c;
  }

  async createCharacter(dto: CreateCharacterDto) {
    return this.prisma.character.create({ data: { ...dto, tags: dto.tags || [] } });
  }

  async updateCharacter(id: string, dto: UpdateCharacterDto) {
    return this.prisma.character.update({
      where: { id },
      data: { ...dto, tags: dto.tags ?? undefined },
    });
  }

  /** 风格改名已改为单图 PATCH（patchCharacterImage），不再做全库批量重命名。 */

  async deleteCharacter(id: string) {
    // 先删子表（形象图片），避免外键约束导致删除失败
    await this.prisma.characterImage.deleteMany({ where: { characterId: id } });
    await this.prisma.character.delete({ where: { id } });
    return { id };
  }

  /** 人工审核通过后归档：pending_review -> active（形象库批量导入的待审核项） */
  async archiveCharacter(id: string) {
    const c = await this.prisma.character.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('形象不存在');
    return this.prisma.character.update({
      where: { id },
      data: { status: 'active' },
    });
  }

  /** 向已有形象追加多张不同风格/背景的图（内部版多图需求） */
  async appendCharacterImages(
    id: string,
    dto: AppendCharacterImagesDto,
    user: AuthUser,
  ): Promise<{ added: number }> {
    const c = await this.prisma.character.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('形象不存在');

    const urls: string[] = [];
    for (const u of dto.urls || []) {
      if (u?.trim()) urls.push(u.trim());
    }
    if (dto.uploadIds?.length) {
      for (const uid of dto.uploadIds) {
        const up = await this.prisma.upload.findUnique({ where: { id: uid } });
        if (!up) continue;
        // 上传文件按 user_id 隔离，非管理员只能用自己上传的
        if (user.role !== Role.SUPER_ADMIN && up.userId !== user.id) continue;
        if (up.url) urls.push(up.url);
      }
    }

    for (const url of urls) {
      await this.prisma.characterImage.create({
        data: {
          characterId: id,
          url,
          style: dto.style || null,
          prompt: dto.prompt || null,
          createdBy: user.id,
          status: 'active',
        },
      });
    }
    // 若形象还没有封面，用最新一张补上
    if (!c.coverUrl && urls.length) {
      await this.prisma.character.update({ where: { id }, data: { coverUrl: urls[urls.length - 1] } });
    }
    return { added: urls.length };
  }

  /** 删除形象下某张图（同步维护封面） */
  async deleteCharacterImage(id: string, imageId: string) {
    const img = await this.prisma.characterImage.findFirst({ where: { id: imageId, characterId: id } });
    if (!img) throw new NotFoundException('图片不存在');
    const c = await this.prisma.character.findUnique({ where: { id } });
    await this.prisma.characterImage.delete({ where: { id: imageId } });
    // 若删掉的是封面，且有其它图，则把封面换成剩下最新的一张
    if (c?.coverUrl === img.url) {
      const remain = await this.prisma.characterImage.findFirst({
        where: { characterId: id },
        orderBy: { createdAt: 'desc' },
      });
      await this.prisma.character.update({
        where: { id },
        data: { coverUrl: remain?.url || null },
      });
    }
    return { id: imageId };
  }

  /** 修改某张图的风格/提示词/URL */
  async patchCharacterImage(id: string, imageId: string, dto: PatchCharacterImageDto) {
    const img = await this.prisma.characterImage.findFirst({ where: { id: imageId, characterId: id } });
    if (!img) throw new NotFoundException('图片不存在');
    return this.prisma.characterImage.update({
      where: { id: imageId },
      data: {
        style: dto.style ?? undefined,
        prompt: dto.prompt ?? undefined,
        url: dto.url ?? undefined,
      },
    });
  }

  /** 批量导入形象（同名默认跳过，overwrite=true 则更新并追加图片） */
  async batchImportCharacters(dto: BatchImportCharactersDto, user: AuthUser) {
    const items = dto.items || [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ name: string; message: string }> = [];

    for (const item of items) {
      const name = (item?.name || '').trim();
      if (!name) {
        skipped++;
        continue;
      }
      try {
        const exist = await this.prisma.character.findFirst({ where: { name } });
        let characterId: string;

        if (exist) {
          if (!dto.overwrite) {
            skipped++;
            continue;
          }
          const row = await this.prisma.character.update({
            where: { id: exist.id },
            data: {
              coverUrl: item.coverUrl ?? exist.coverUrl,
              category: item.category ?? exist.category,
              tags: item.tags ?? undefined,
              description: item.description ?? exist.description,
            },
          });
          characterId = row.id;
          updated++;
        } else {
          const row = await this.prisma.character.create({
            data: {
              name,
              coverUrl: item.coverUrl || item.imageUrls?.[0] || null,
              category: item.category || null,
              tags: item.tags || [],
              description: item.description || null,
            },
          });
          characterId = row.id;
          created++;
        }

        for (const url of item.imageUrls || []) {
          if (!url?.trim()) continue;
          await this.prisma.characterImage.create({
            data: { characterId, url: url.trim(), createdBy: user.id },
          });
        }
      } catch (e: any) {
        errors.push({ name, message: e?.message || '导入失败' });
      }
    }
    return { total: items.length, created, updated, skipped, errors };
  }

  // ---------------- 歌曲库 ----------------
  async listSongs(dto: PaginationDto, status?: string) {
    const where: any = {
      title: this.whereLike(dto.q),
      category: dto.category || undefined,
      ...(dto.tag ? { tags: { has: dto.tag } } : {}),
      ...(status ? { status } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.song.findMany({
        where,
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
        orderBy: this.order(dto.sort, dto.order),
      }),
      this.prisma.song.count({ where }),
    ]);
    return { data, total, page: dto.page, pageSize: dto.pageSize };
  }

  async getSong(id: string) {
    const s = await this.prisma.song.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('歌曲不存在');
    return s;
  }
  async createSong(dto: CreateSongDto) {
    return this.prisma.song.create({ data: { ...dto, tags: dto.tags || [] } });
  }
  async updateSong(id: string, dto: UpdateSongDto) {
    return this.prisma.song.update({ where: { id }, data: { ...dto, tags: dto.tags ?? undefined } });
  }
  async deleteSong(id: string) {
    await this.prisma.song.delete({ where: { id } });
    return { id };
  }

  /** 人工审核通过后归档：pending_review -> active */
  async archiveSong(id: string) {
    const s = await this.prisma.song.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('歌曲不存在');
    return this.prisma.song.update({
      where: { id },
      data: { status: 'active' },
    });
  }

  /** 批量导入歌曲（按 title + artist 判重） */
  async batchImportSongs(dto: BatchImportSongsDto) {
    const items = dto.items || [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ title: string; message: string }> = [];

    for (const item of items) {
      const title = (item?.title || '').trim();
      if (!title) {
        skipped++;
        continue;
      }
      try {
        const exist = await this.prisma.song.findFirst({
          where: { title, artist: item.artist || undefined },
        });
        if (exist) {
          if (!dto.overwrite) {
            skipped++;
            continue;
          }
          await this.prisma.song.update({
            where: { id: exist.id },
            data: { ...item, title, tags: item.tags ?? undefined },
          });
          updated++;
        } else {
          await this.prisma.song.create({
            data: { ...item, title, tags: item.tags || [] },
          });
          created++;
        }
      } catch (e: any) {
        errors.push({ title, message: e?.message || '导入失败' });
      }
    }
    return { total: items.length, created, updated, skipped, errors };
  }

  // ---------------- 提示词库 ----------------
  async listPrompts(dto: PaginationDto) {
    const where: any = {
      title: this.whereLike(dto.q),
      category: dto.category || undefined,
      type: (dto.type as PromptType) || undefined,
      ...(dto.tag ? { tags: { has: dto.tag } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.prompt.findMany({
        where,
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
        orderBy: this.order(dto.sort, dto.order),
      }),
      this.prisma.prompt.count({ where }),
    ]);
    return { data, total, page: dto.page, pageSize: dto.pageSize };
  }
  async getPrompt(id: string) {
    const p = await this.prisma.prompt.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('提示词不存在');
    return p;
  }
  async createPrompt(dto: CreatePromptDto) {
    return this.prisma.prompt.create({ data: { ...dto, tags: dto.tags || [] } });
  }
  async updatePrompt(id: string, dto: UpdatePromptDto) {
    return this.prisma.prompt.update({ where: { id }, data: { ...dto, tags: dto.tags ?? undefined } });
  }
  async deletePrompt(id: string) {
    await this.prisma.prompt.delete({ where: { id } });
    return { id };
  }

  /**
   * 调用 AI 对提示词做智能分类：依据标题 + 正文，产出 category 与 tags[]。
   * 优先 song 阶段渠道，回退 inspiration；无可用渠道/失败则退化为「待分类」，保证不中断。
   */
  async classifyPrompt(id: string): Promise<{ category?: string; tags: string[] }> {
    const p = await this.prisma.prompt.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('提示词不存在');

    const fallback = { category: p.category ?? undefined, tags: p.tags?.length ? p.tags : ['待分类'] };

    let channel;
    try {
      channel = await this.ai.resolve('song', undefined, undefined);
    } catch {
      try {
        channel = await this.ai.resolve('inspiration', undefined, undefined);
      } catch {
        this.logger.warn('无可用 AI 渠道，跳过提示词智能分类');
        return fallback;
      }
    }

    const userText = [
      `【标题】${p.title}`,
      `【类型】${p.type === 'character' ? '形象提示词' : '动作提示词'}`,
      `【正文】\n${p.content.slice(0, 1500)}`,
      '',
      '请按系统指示输出 JSON。',
    ].join('\n');

    const parts: ChatPart[] = [{ type: 'text', text: userText }];

    try {
      const raw = await this.ai.chat(channel, NetworkScope.BROAD, parts, {
        system: LibrariesService.PROMPT_CLASSIFY_SYSTEM,
        temperature: 0.3,
        maxTokens: 500,
      });
      const info = this.parseJson(raw);
      const category = (info?.category as string) || p.category || undefined;
      const tags = Array.isArray(info?.tags)
        ? (info.tags as any[]).filter((t) => typeof t === 'string').map(String)
        : p.tags?.length
          ? p.tags
          : ['待分类'];
      const data = { category, tags };
      await this.prisma.prompt.update({ where: { id }, data });
      return data;
    } catch (e: any) {
      this.logger.warn(`提示词智能分类失败，保留原值：${e?.message || e}`);
      return fallback;
    }
  }

  private static readonly PROMPT_CLASSIFY_SYSTEM = [
    '你是提示词素材库的分类编目员。',
    '用户给你一条提示词（含标题、类型、正文）。',
    '请据此给出适合素材检索的一级分类与细粒度标签。',
    '',
    '输出要求：',
    '- 只输出一个 JSON 对象，不要解释、标题或 markdown 标记。',
    '- 字段：',
    '  category: string 一级分类，从 [人物写真, 二次元, 古风, 写实风, 商业广告, 演唱表演, 舞蹈表演, 口播讲解, 情感叙事, 其他] 中选最贴合的一个',
    '  tags: string[] 3~6 个标签（风格/情绪/场景/动作/镜头等，如 ["深情","固定镜头","近景","夜景"]）',
  ].join('\n');

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

  /** 批量导入提示词（按 title 判重；type: character=形象提示词, action=动作提示词） */
  async batchImportPrompts(dto: BatchImportPromptsDto, user: AuthUser) {
    const items = dto.items || [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ title: string; message: string }> = [];

    const enableAi = dto.enableAi !== false;
    for (const item of items) {
      const title = (item?.title || '').trim();
      if (!title || !item.content?.trim()) {
        skipped++;
        continue;
      }
      try {
        const exist = await this.prisma.prompt.findFirst({ where: { title } });
        let promptId: string | undefined;
        if (exist) {
          if (!dto.overwrite) {
            skipped++;
            continue;
          }
          await this.prisma.prompt.update({
            where: { id: exist.id },
            data: { ...item, title, tags: item.tags ?? undefined },
          });
          updated++;
          promptId = exist.id;
        } else {
          const row = await this.prisma.prompt.create({
            data: {
              ...item,
              title,
              type: item.type || PromptType.character,
              tags: item.tags || [],
              createdBy: user.id,
            },
          });
          created++;
          promptId = row.id;
        }
        // 开启 AI 时，对新入库/覆盖的提示词自动跑一次智能分类（失败保留原值）
        if (enableAi && promptId) {
          try {
            await this.classifyPrompt(promptId);
          } catch {
            /* AI 分类失败不阻断导入 */
          }
        }
      } catch (e: any) {
        errors.push({ title, message: e?.message || '导入失败' });
      }
    }
    return { total: items.length, created, updated, skipped, errors };
  }

  // ---------------- 标签 ----------------
  async listTags(type: string) {
    return this.prisma.tag.findMany({ where: { type }, orderBy: { name: 'asc' } });
  }
  async ensureTag(type: string, name: string) {
    return this.prisma.tag.upsert({
      where: { name_type: { name, type } },
      create: { name, type },
      update: {},
    });
  }
}
