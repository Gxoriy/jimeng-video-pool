import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EgressHttpService } from '../egress/egress-http.service';
import { NetworkScope } from '../common/roles.enum';
import { AuthUser } from '../auth/auth.service';
import {
  CHANNEL_STAGES,
  CreateChannelDto,
  TestChannelDto,
  UpdateChannelDto,
} from './dto/channel.dto';
import { encrypt, decrypt } from '../common/utils/encryption.util';

/**
 * AI 渠道配置（OpenAI / Anthropic 兼容）。
 *
 * 权限：**仅超级管理员**可增删改；普通用户只能在生成页看到「启用中的渠道名 + 模型」并选用。
 * 用途：P1 生成形象、P2 获取灵感。P3 视频生成走 RunningHub，与本模块无关。
 */
@Injectable()
export class AiChannelsService {
  constructor(
    private prisma: PrismaService,
    private http: EgressHttpService,
  ) {}

  /** 管理端列表（含掩码 Key） */
  async list() {
    const rows = await this.prisma.aiChannel.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.sanitize(r));
  }

  async get(id: string) {
    const ch = await this.prisma.aiChannel.findUnique({ where: { id } });
    if (!ch) throw new NotFoundException('渠道不存在');
    return this.sanitize(ch);
  }

  async create(dto: CreateChannelDto) {
    const ch = await this.prisma.aiChannel.create({
      data: {
        name: dto.name,
        protocol: dto.protocol || 'openai',
        baseUrl: dto.baseUrl.replace(/\/+$/, ''),
        apiKeyEnc: encrypt(dto.apiKey),
        model: dto.model || null,
        enabled: dto.enabled !== false,
        usableFor: this.joinStages(dto.usableFor),
        supportsImage: dto.supportsImage !== false,
        supportsVision: dto.supportsVision !== false,
        streaming: !!dto.streaming,
        proxyUrl: dto.proxyUrl || null,
        remark: dto.remark || null,
      },
    });
    return this.sanitize(ch);
  }

  async update(id: string, dto: UpdateChannelDto) {
    const existing = await this.prisma.aiChannel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('渠道不存在');

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.protocol !== undefined) data.protocol = dto.protocol;
    if (dto.baseUrl !== undefined) data.baseUrl = dto.baseUrl.replace(/\/+$/, '');
    if (dto.apiKey) data.apiKeyEnc = encrypt(dto.apiKey); // 留空 = 不改 Key
    if (dto.model !== undefined) data.model = dto.model || null;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.usableFor !== undefined) data.usableFor = this.joinStages(dto.usableFor);
    if (dto.supportsImage !== undefined) data.supportsImage = dto.supportsImage;
    if (dto.supportsVision !== undefined) data.supportsVision = dto.supportsVision;
    if (dto.streaming !== undefined) data.streaming = dto.streaming;
    if (dto.proxyUrl !== undefined) data.proxyUrl = dto.proxyUrl || null;
    if (dto.remark !== undefined) data.remark = dto.remark || null;

    const updated = await this.prisma.aiChannel.update({ where: { id }, data });
    return this.sanitize(updated);
  }

  async remove(id: string) {
    const ch = await this.prisma.aiChannel.findUnique({ where: { id } });
    if (!ch) throw new NotFoundException('渠道不存在');
    await this.prisma.aiChannel.delete({ where: { id } });
    return { id };
  }

  /** 获取模型列表：GET {baseUrl}/models */
  async fetchModels(user: AuthUser, dto: TestChannelDto): Promise<string[]> {
    const { baseUrl, apiKey } = await this.resolveCreds(dto);
    try {
      const resp = await this.http.get(`${baseUrl}/models`, user.networkScope, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 360000,
      });
      const models: any[] = resp.data?.data || resp.data?.models || [];
      return models
        .map((m: any) => (typeof m === 'string' ? m : m.id || m.name))
        .filter(Boolean)
        .sort();
    } catch (err: any) {
      throw new BadRequestException(err?.message || '获取模型列表失败');
    }
  }

  /** 连通性测试：发一次极短的 chat 请求 */
  async test(user: AuthUser, dto: TestChannelDto) {
    const { baseUrl, apiKey, model } = await this.resolveCreds(dto);
    if (!model) throw new BadRequestException('请先选择模型再测试');
    const started = Date.now();
    try {
      const resp = await this.http.post(
        `${baseUrl}/chat/completions`,
        user.networkScope,
        {
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 360000,
        },
      );
      return {
        ok: true,
        latencyMs: Date.now() - started,
        reply: resp.data?.choices?.[0]?.message?.content ?? null,
      };
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - started, message: err?.message };
    }
  }

  /** 表单未保存时用表单值；只传 id 时取库里的值（Key 从库里解密） */
  private async resolveCreds(dto: TestChannelDto) {
    if (dto.id) {
      const ch = await this.prisma.aiChannel.findUnique({ where: { id: dto.id } });
      if (!ch) throw new NotFoundException('渠道不存在');
      return {
        baseUrl: (dto.baseUrl || ch.baseUrl).replace(/\/+$/, ''),
        apiKey: dto.apiKey || decrypt(ch.apiKeyEnc),
        model: dto.model || ch.model || '',
      };
    }
    if (!dto.baseUrl || !dto.apiKey) {
      throw new BadRequestException('请填写 Base URL 与 API Key');
    }
    return {
      baseUrl: dto.baseUrl.replace(/\/+$/, ''),
      apiKey: dto.apiKey,
      model: dto.model || '',
    };
  }

  private joinStages(stages?: string[]): string {
    const list = (stages && stages.length ? stages : [...CHANNEL_STAGES]).filter((s) =>
      (CHANNEL_STAGES as readonly string[]).includes(s),
    );
    return (list.length ? list : [...CHANNEL_STAGES]).join(',');
  }

  /** 脱敏：只返回掩码，绝不回明文 Key */
  private sanitize(ch: any) {
    const { apiKeyEnc, ...rest } = ch;
    let keyMask = '****';
    try {
      const raw = decrypt(apiKeyEnc);
      keyMask = raw.length <= 8 ? '****' : `${raw.slice(0, 4)}****${raw.slice(-4)}`;
    } catch {
      /* 解密失败也只回掩码 */
    }
    return {
      ...rest,
      keyMask,
      usableForList: String(ch.usableFor || '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean),
    };
  }
}

/** 供其它模块判断 scope 类型时复用 */
export type { NetworkScope };
