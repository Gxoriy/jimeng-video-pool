import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EgressHttpService } from '../../egress/egress-http.service';
import { NetworkScope } from '../../common/roles.enum';
import { decrypt } from '../../common/utils/encryption.util';

export interface ResolvedChannel {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 多模态消息片段 */
export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * AI 渠道客户端 —— P1 生成形象 / P2 获取灵感 统一走这里。
 *
 * 渠道由**超级管理员**在后台配置（ai_channels 表），普通用户只能选用、不能新增修改。
 * 完全兼容 OpenAI 协议：/chat/completions（含 vision）与 /images/generations。
 */
@Injectable()
export class AiChannelClient {
  constructor(
    private prisma: PrismaService,
    private http: EgressHttpService,
  ) {}

  /**
   * 解析本次调用要用的渠道。
   * @param stage character | inspiration | song —— 只挑选声明支持该阶段的渠道
   */
  async resolve(
    stage: 'character' | 'inspiration' | 'song',
    channelId?: string,
    modelOverride?: string,
  ): Promise<ResolvedChannel> {
    const ch = channelId
      ? await this.prisma.aiChannel.findUnique({ where: { id: channelId } })
      : await this.prisma.aiChannel.findFirst({
          where: { enabled: true, usableFor: { contains: stage } },
          orderBy: { createdAt: 'asc' },
        });

    if (!ch) {
      throw new BadRequestException(
        '没有可用的 AI 渠道，请联系超级管理员在「AI 渠道配置」中添加',
      );
    }
    if (!ch.enabled) throw new BadRequestException(`渠道「${ch.name}」已停用`);
    if (!ch.usableFor.includes(stage)) {
      throw new BadRequestException(`渠道「${ch.name}」未开放用于该阶段`);
    }

    const model = modelOverride || ch.model;
    if (!model) {
      throw new BadRequestException(`渠道「${ch.name}」未指定模型，请选择模型后再试`);
    }

    return {
      id: ch.id,
      name: ch.name,
      protocol: ch.protocol,
      baseUrl: ch.baseUrl.replace(/\/$/, ''),
      apiKey: decrypt(ch.apiKeyEnc),
      model,
    };
  }

  /**
   * 已判定「不支持读图」的渠道（带图必空返回、去图后正常）。
   * 命中后续请求直接走纯文本，省去无谓的等待与请求体开销。进程重启后自动清空。
   */
  private static readonly noVisionChannels = new Set<string>();

  /**
   * 已判定「不支持多模态图生图」的渠道（走 /chat/completions 图生图必 502）。
   * 命中后 generateImage 直接走 /images/generations，避免之后每次生成形象都白等一轮。
   * 进程重启后自动清空。
   */
  private static readonly noChatImageChannels = new Set<string>();

  private static channelKey(ch: ResolvedChannel) {
    return `${ch.id}:${ch.model}`;
  }

  /** 该渠道是否已被判定为不支持读图 */
  static isVisionDisabled(ch: ResolvedChannel) {
    return AiChannelClient.noVisionChannels.has(AiChannelClient.channelKey(ch));
  }

  /** 从响应里稳健取出文本（content 可能是字符串或分段数组） */
  private extractText(msg: any): string {
    const content = msg?.content;
    const text = Array.isArray(content)
      ? content.map((c: any) => c?.text || '').join('')
      : content;
    return typeof text === 'string' ? text.trim() : '';
  }

  /** 退避时长（带 ±800ms 抖动，避免多轮重试同步打爆被限流的中转站） */
  private backoffMs(attempt: number): number {
    const base = attempt * 1500;
    const jitter = Math.floor(Math.random() * 800);
    return base + jitter;
  }

  /**
   * 对话补全（支持 vision：parts 里带 image_url 即可读图）。
   * 「获取灵感」用它把「参考形象 + 音乐信息」变成两类提示词。
   *
   * 中转网关常见两类坑，这里统一兜住：
   *  1) **随机空返回**：HTTP 200 + finish_reason=stop 但 content="" —— 实测同一请求成功率仅约 50%，
   *     故对空返回做重试（EgressHttpService 只重试网络层瞬态错误，覆盖不到这种情况）。
   *  2) **模型不支持读图**：纯文本模型收到 image_url 后必定空返回。开启 allowDropImages 后，
   *     重试时自动去掉图片；一旦"去图即成功"，将该渠道记入 noVisionChannels，后续直接走纯文本。
   */
  async chat(
    ch: ResolvedChannel,
    scope: NetworkScope,
    parts: ChatPart[],
    opts: {
      system?: string;
      temperature?: number;
      maxTokens?: number;
      /** 空返回时的最大尝试轮数（含首次），默认 3 */
      attempts?: number;
      /** 允许在重试时丢弃图片（渠道不支持 vision 时的降级手段），默认 false */
      allowDropImages?: boolean;
    } = {},
  ): Promise<string> {
    const maxAttempts = Math.max(1, opts.attempts ?? 3);
    const hasImages = parts.some((p) => p.type === 'image_url');
    const key = AiChannelClient.channelKey(ch);
    // 已知不支持读图的渠道：一开始就别带图
    const knownNoVision = AiChannelClient.noVisionChannels.has(key);

    let lastRaw = '';
    let emptyWithImages = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // 第 2 轮起（或渠道已知不支持读图时）丢弃图片
      const dropImages =
        hasImages && (knownNoVision || (opts.allowDropImages === true && attempt >= 2));
      const sendParts = dropImages ? parts.filter((p) => p.type !== 'image_url') : parts;

      if (dropImages && attempt === 1) {
        console.log(`[ai-channel] 渠道「${ch.name}」已知不支持读图，本次直接走纯文本`);
      }

      const messages: any[] = [];
      if (opts.system) messages.push({ role: 'system', content: opts.system });
      messages.push({ role: 'user', content: sendParts });

      let resp: any;
      try {
        resp = await this.http.post(
          `${ch.baseUrl}/chat/completions`,
          scope,
          {
            model: ch.model,
            messages,
            temperature: opts.temperature ?? 0.8,
            max_tokens: opts.maxTokens ?? 1200,
            stream: false,
          },
          {
            headers: {
              Authorization: `Bearer ${ch.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 600000,
          },
        );
      } catch (err: any) {
        // 上游 5xx / 限流 / 网络问题：中转站随机故障，值得再试；4xx 是请求本身有问题，直接抛。
        const status = err?.upstreamStatus;
        const worthRetry = !status || status >= 500 || status === 429;
        if (attempt < maxAttempts && worthRetry) {
          console.warn(
            `[ai-channel] 渠道「${ch.name}」第 ${attempt}/${maxAttempts} 次调用失败` +
              `（${status || err?.message}），准备重试…`,
          );
          await new Promise((r) => setTimeout(r, this.backoffMs(attempt)));
          continue;
        }
        throw err;
      }

      const msg = resp.data?.choices?.[0]?.message;
      const text = this.extractText(msg);
      if (text) {
        // 「带图空返回 → 去图成功」= 该渠道不支持读图，记下来避免后续重复试错
        if (hasImages && dropImages && emptyWithImages > 0 && !knownNoVision) {
          AiChannelClient.noVisionChannels.add(key);
          console.warn(
            `[ai-channel] 渠道「${ch.name}」(${ch.model}) 带图必定空返回、去图后正常，` +
              `判定为不支持读图，后续请求将只发文本。`,
          );
        }
        return text;
      }

      if (!dropImages && hasImages) emptyWithImages++;
      lastRaw = JSON.stringify(resp.data).slice(0, 300);
      console.warn(
        `[ai-channel] 渠道「${ch.name}」第 ${attempt}/${maxAttempts} 次返回空内容` +
          `${dropImages ? '（已去图）' : hasImages ? '（带图）' : ''}，${
            attempt < maxAttempts ? '准备重试…' : '放弃'
          }`,
      );
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, this.backoffMs(attempt)));
    }

    throw new BadRequestException(
      `AI 渠道「${ch.name}」连续 ${maxAttempts} 次返回空内容（HTTP 200 但 content 为空），` +
        `通常是上游中转站不稳定或该模型不可用，请稍后重试或在「AI 渠道配置」中更换模型。` +
        `最后一次响应：${lastRaw}`,
    );
  }

  /**
   * 生图。
   *  - 无参考图 → POST /images/generations
   *  - 有参考图 → 优先走 /chat/completions 多模态（网关对图生图兼容性最好），
   *               失败再退回 /images/generations（把参考图描述并入提示词）。
   */
  async generateImage(
    ch: ResolvedChannel,
    scope: NetworkScope,
    prompt: string,
    opts: { size?: string; n?: number; referenceImageUrls?: string[] } = {},
  ): Promise<{ urls: string[]; b64: string[] }> {
    const refs = (opts.referenceImageUrls || []).filter(Boolean);
    const key = AiChannelClient.channelKey(ch);

    // 纯生图网关（模型列表里只有生图/视频模型）走 /chat/completions 会直接 502，
    // 失败一次后记下来，避免之后每次生成形象都白白等待一轮超时+重试。
    if (refs.length > 0 && !AiChannelClient.noChatImageChannels.has(key)) {
      try {
        return await this.imageViaChat(ch, scope, prompt, refs);
      } catch {
        AiChannelClient.noChatImageChannels.add(key);
        console.warn(
          `[ai-channel] 渠道「${ch.name}」(${ch.model}) 不支持多模态图生图，` +
            `后续直接走 /images/generations（注意：该路径不会携带参考图）。`,
        );
      }
    }
    return this.imageViaGenerations(ch, scope, prompt, opts);
  }

  private async imageViaGenerations(
    ch: ResolvedChannel,
    scope: NetworkScope,
    prompt: string,
    opts: { size?: string; n?: number },
  ): Promise<{ urls: string[]; b64: string[] }> {
    const resp = await this.http.post(
      `${ch.baseUrl}/images/generations`,
      scope,
      {
        model: ch.model,
        prompt,
        n: Math.min(Math.max(Number(opts.n) || 1, 1), 4),
        size: opts.size || '1024x1024',
      },
      {
        headers: {
          Authorization: `Bearer ${ch.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 600000,
      },
    );

    const data: any[] = resp.data?.data || [];
    const urls = data.map((d) => d?.url).filter(Boolean);
    const b64 = data.map((d) => d?.b64_json).filter(Boolean);
    if (!urls.length && !b64.length) {
      throw new BadRequestException(
        '生图接口未返回图片：' + JSON.stringify(resp.data).slice(0, 300),
      );
    }
    return { urls, b64 };
  }

  /** 通过多模态对话生图（图生图 / 参考图改写） */
  private async imageViaChat(
    ch: ResolvedChannel,
    scope: NetworkScope,
    prompt: string,
    refs: string[],
  ): Promise<{ urls: string[]; b64: string[] }> {
    const parts: ChatPart[] = [
      { type: 'text', text: prompt },
      ...refs.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ];
    // 图生图必须带图，不能降级去图；且失败后有 /images/generations 回退，
    // 故只试 1 次，避免在不支持多模态的网关上白等。
    const text = await this.chat(ch, scope, parts, {
      system: '你是图像生成助手。请依据参考图与描述生成新图片，并直接返回图片。',
      maxTokens: 2000,
      attempts: 1,
      allowDropImages: false,
    });

    const urls = this.extractImageUrls(text);
    const b64 = this.extractBase64(text);
    if (!urls.length && !b64.length) {
      throw new BadRequestException('多模态对话未返回图片');
    }
    return { urls, b64 };
  }

  private extractImageUrls(text: string): string[] {
    const out = new Set<string>();
    const md = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = md.exec(text))) out.add(m[1]);
    const raw = /https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi;
    while ((m = raw.exec(text))) out.add(m[0]);
    return [...out];
  }

  private extractBase64(text: string): string[] {
    const out: string[] = [];
    const re = /data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push(m[1]);
    return out;
  }
}
