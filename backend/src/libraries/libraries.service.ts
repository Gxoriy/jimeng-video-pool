import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KeyPoolService } from '../key-pool/key-pool.service';
import { MediaService } from '../media/media.service';
import { ImageProvider } from '../generation/providers/image.provider';
import { AuthUser } from '../auth/auth.service';
import { Provider, TaskType, TaskStatus, PromptType } from '../common/roles.enum';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  CreateCharacterDto,
  UpdateCharacterDto,
  CreateSongDto,
  UpdateSongDto,
  CreatePromptDto,
  UpdatePromptDto,
  RegenCharacterDto,
} from './dto';

@Injectable()
export class LibrariesService {
  constructor(
    private prisma: PrismaService,
    private keyPool: KeyPoolService,
    private media: MediaService,
    private image: ImageProvider,
  ) {}

  private whereLike(q?: string) {
    return q ? { contains: q } : undefined;
  }

  private order(sort?: string, order?: string) {
    if (sort) return { [sort]: order === 'asc' ? 'asc' : 'desc' };
    return { createdAt: 'desc' as const };
  }

  // ---------------- 形象库 ----------------
  async listCharacters(dto: PaginationDto) {
    const where: any = {
      name: this.whereLike(dto.q),
      category: dto.category || undefined,
      ...(dto.tag ? { tags: { has: dto.tag } } : {}),
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

  async deleteCharacter(id: string) {
    await this.prisma.character.delete({ where: { id } });
    return { id };
  }

  /** 形象换景重生图（需求 #8）：选人物 + 歌曲 + 提示词 -> ChatGPT 生成换景图 */
  async regenCharacter(id: string, dto: RegenCharacterDto, user: AuthUser, requestBearer?: string) {
    const character = await this.getCharacter(id);
    const song = await this.prisma.song.findUnique({ where: { id: dto.songId } });
    if (!song) throw new BadRequestException('歌曲不存在');

    let promptText = dto.promptText;
    if (!promptText && dto.promptId) {
      const p = await this.prisma.prompt.findUnique({ where: { id: dto.promptId } });
      promptText = p?.content;
    }
    if (!promptText) {
      promptText = `为「${character.name}」生成一个与歌曲《${song.title}》情绪风格匹配的新场景形象图`;
    }

    // 选 Key -> 生成 -> 下载落地 -> 挂到形象 + 写任务
    const task = await this.prisma.task.create({
      data: {
        userId: user.id,
        type: TaskType.image,
        status: TaskStatus.running,
        prompt: promptText,
        provider: Provider.OPENAI,
        model: dto.model,
        params: { regenCharacterId: id, songId: dto.songId } as any,
      },
    });

    try {
      const key = await this.keyPool.selectKey(Provider.OPENAI, user, requestBearer);
      const result = await this.image.generate({
        prompt: promptText,
        model: dto.model,
        params: {},
        key,
        scope: user.networkScope,
        requestBearer,
      });
      const url = result.urls[0];
      let localPath: string | null = null;
      try {
        localPath = await this.media.download(url, user.networkScope);
      } catch { /* ignore */ }

      await this.prisma.characterImage.create({
        data: { characterId: id, url, localPath, prompt: promptText, model: dto.model, createdBy: user.id },
      });
      await this.prisma.media.create({
        data: { taskId: task.id, type: TaskType.image, url, localPath },
      }).catch(() => undefined);
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.success, resultUrls: [url] as any, resultLocalPaths: localPath ? [localPath] as any : undefined, finishedAt: new Date() },
      });
      return { taskId: task.id, url, localPath };
    } catch (err: any) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.failed, errorMessage: err?.message?.slice(0, 1000), finishedAt: new Date() },
      });
      throw err;
    }
  }

  // ---------------- 歌曲库 ----------------
  async listSongs(dto: PaginationDto) {
    const where: any = {
      title: this.whereLike(dto.q),
      category: dto.category || undefined,
      ...(dto.tag ? { tags: { has: dto.tag } } : {}),
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
