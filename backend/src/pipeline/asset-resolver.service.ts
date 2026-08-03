import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.service';
import { Role } from '../common/roles.enum';
import {
  DEFAULT_INLINE_TARGET_KB,
  ffmpegStaticPath,
  inlineImageDataUri,
  resolveFfmpegBin,
} from '../common/image-inline.util';

export interface ResolvedImage {
  url: string;
  localPath?: string | null;
  source: 'upload' | 'character' | 'url';
  /**
   * 参考图的「文字信息」。当所选 AI 渠道是纯文本模型（看不到图）时，
   * 用这些文字来描述人物特征，避免模型凭空捏造形象。
   *  - 形象库：形象名称/标签/描述 + 该图当初的生成提示词
   *  - 本地上传：文件名
   */
  name?: string;
  description?: string | null;
  tags?: string[];
  /** 形象库图片当初的生成提示词，对还原人物特征最有价值 */
  genPrompt?: string | null;
  filename?: string;
}

export interface ResolvedAudio {
  url?: string;
  localPath?: string | null;
  title?: string;
  artist?: string;
  lyrics?: string;
  duration?: number | null;
  /** 结构化音乐信息（歌曲库直接带出 / 本地音频由 AI 识别带出） */
  category?: string;
  tags?: string[];
  description?: string;
  language?: string;
  source: 'upload' | 'song' | 'url';
}

/**
 * 统一解析「上传的文件」与「库里的素材」两种来源。
 * 上传文件严格按 user_id 隔离；形象库/歌曲库为全站共享素材。
 */
@Injectable()
export class AssetResolverService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * 启动自检：打印参考图内联/降采样的实际生效配置。
   * 重启后若日志里看不到这行，说明跑的仍是旧构建（这是排查 413 是否已修复的唯一可靠依据）。
   */
  onModuleInit() {
    const bin = resolveFfmpegBin(this.config.get<string>('app.ffmpegPath'));
    const builtin = ffmpegStaticPath();
    console.log(
      `[asset-resolver] 参考图内联已启用 | 目标≤${this.inlineTargetKB()}KB | ffmpeg=${bin}` +
        `${builtin && bin === builtin ? '（内置 ffmpeg-static）' : ''}`,
    );
  }

  /** 参考图内联 base64 的目标体积上限（KB） */
  private inlineTargetKB(): number {
    return (
      Number(this.config.get('app.maxInlineImageKB')) || DEFAULT_INLINE_TARGET_KB
    );
  }

  /**
   * 把可能相对的 upload url（/api/files/xxx，当 PUBLIC_BASE_URL 未配置时存入）修正为绝对地址，
   * 否则外部 vision 网关无法拉取图片会报 invalid parameter (100007) / 502。
   */
  private toAbsolute(url?: string): string | undefined {
    if (!url) return url;
    if (!url.startsWith('/')) return url;
    const base = (this.config.get<string>('app.publicBaseUrl') || '').replace(/\/$/, '');
    return base ? `${base}${url}` : url;
  }

  /**
   * 生成本地图片的 data URI（base64 内联）。外部 vision 网关直接读取内联字节，
   * 无需再去拉取服务器地址，彻底规避「相对地址 / PUBLIC_BASE_URL 未配 / 网关拉不到图」
   * 导致的 invalid parameter (100007) / 502 / 返回空内容等问题。
   * 同时做降采样，规避 413（request body too large）。
   */
  private async toImageUrl(url?: string, localPath?: string | null): Promise<string> {
    if (localPath) {
      try {
        const r = await inlineImageDataUri(localPath, {
          targetKB: this.inlineTargetKB(),
          ffmpegPath: this.config.get<string>('app.ffmpegPath'),
        });
        console.log(
          `[asset-resolver] 内联图片 base64=${r.kb}KB (降采样=${r.downscaled})`,
        );
        return r.dataUri;
      } catch {
        /* 读不到本地文件时回退到 url */
      }
    }
    return this.toAbsolute(url) || url || '';
  }


  /** 解析参考图：上传 ID / 形象库 / 直接 URL，可多个 */
  async resolveImages(
    user: AuthUser,
    opts: {
      urls?: string[];
      uploadId?: string;
      characterId?: string;
      characterImageId?: string;
    },
  ): Promise<ResolvedImage[]> {
    const out: ResolvedImage[] = [];

    if (opts.uploadId) {
      const up = await this.requireUpload(user, opts.uploadId, 'image');
      out.push({
        url: await this.toImageUrl(up.url, up.localPath),
        localPath: up.localPath,
        source: 'upload',
        filename: up.filename || undefined,
      });
    }

    if (opts.characterImageId) {
      const img = await this.prisma.characterImage.findUnique({
        where: { id: opts.characterImageId },
        include: { character: true },
      });
      if (!img) throw new BadRequestException('所选形象图片不存在');
      out.push({
        url: await this.toImageUrl(img.url, img.localPath),
        localPath: img.localPath,
        source: 'character',
        name: img.character?.name,
        description: img.character?.description,
        tags: img.character?.tags,
        genPrompt: img.prompt,
      });
    } else if (opts.characterId) {
      const c = await this.prisma.character.findUnique({
        where: { id: opts.characterId },
        include: { images: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      if (!c) throw new BadRequestException('所选形象不存在');
      const pick = c.images[0];
      const url = pick?.url || c.coverUrl;
      if (!url) throw new BadRequestException(`形象「${c.name}」还没有任何图片`);
      out.push({
        url: await this.toImageUrl(url, pick?.localPath ?? null),
        localPath: pick?.localPath ?? null,
        source: 'character',
        name: c.name,
        description: c.description,
        tags: c.tags,
        genPrompt: pick?.prompt ?? null,
      });
    }

    for (const u of opts.urls || []) {
      if (u && u.trim()) out.push({ url: u.trim(), source: 'url' });
    }

    return out;
  }

  /** 解析音频：上传 ID / 歌曲库 / 直接 URL */
  async resolveAudio(
    user: AuthUser,
    opts: { url?: string; uploadId?: string; songId?: string },
  ): Promise<ResolvedAudio | null> {
    if (opts.uploadId) {
      const up = await this.requireUpload(user, opts.uploadId, 'audio');
      return { url: up.url, localPath: up.localPath, title: up.filename, source: 'upload' };
    }
    if (opts.songId) {
      const s = await this.prisma.song.findUnique({ where: { id: opts.songId } });
      if (!s) throw new BadRequestException('所选歌曲不存在');
      if (!s.url && !s.localPath) {
        throw new BadRequestException(`歌曲《${s.title}》没有音频文件，请先在歌曲库补充`);
      }
      return {
        url: s.url || undefined,
        localPath: s.localPath,
        title: s.title,
        artist: s.artist || undefined,
        lyrics: s.lyrics || undefined,
        duration: s.duration,
        category: s.category || undefined,
        tags: s.tags || undefined,
        description: s.description || undefined,
        language: s.language || undefined,
        source: 'song',
      };
    }
    if (opts.url && opts.url.trim()) {
      return { url: opts.url.trim(), source: 'url' };
    }
    return null;
  }

  /** 取歌曲的文字信息（P1 用来让形象契合歌曲气质） */
  async songInfo(songId?: string): Promise<string | null> {
    if (!songId) return null;
    const s = await this.prisma.song.findUnique({ where: { id: songId } });
    if (!s) return null;
    const bits = [
      `歌名：《${s.title}》`,
      s.artist ? `演唱：${s.artist}` : '',
      s.category ? `曲风：${s.category}` : '',
      s.tags?.length ? `标签：${s.tags.join('、')}` : '',
      s.duration ? `时长：${s.duration}秒` : '',
      s.description ? `简介：${s.description}` : '',
      s.lyrics ? `歌词片段：${s.lyrics.slice(0, 600)}` : '',
    ].filter(Boolean);
    return bits.join('\n');
  }

  private async requireUpload(user: AuthUser, id: string, kind: 'image' | 'audio') {
    const up = await this.prisma.upload.findUnique({ where: { id } });
    if (!up) throw new BadRequestException('上传文件不存在');
    if (user.role !== Role.SUPER_ADMIN && up.userId !== user.id) {
      throw new BadRequestException('无权使用该上传文件');
    }
    if (up.kind !== kind) {
      throw new BadRequestException(`文件类型不符，期望 ${kind}，实际 ${up.kind}`);
    }
    return up;
  }
}
