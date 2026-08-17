import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse } from 'axios';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, extname, join } from 'path';
import { tmpdir } from 'os';
import { EgressService } from '../../egress/egress.service';
import { NetworkScope } from '../../common/roles.enum';

export type CookieMap = Record<string, string>;

export interface HedraGenerateOptions {
  text?: string;
  imagePaths?: string[];
  audioPaths?: string[];
  userInstructions?: string;
  model?: string;
}

export interface HedraGenerateResult {
  prompt: string;
  model: string;
  attachmentCount: number;
  usedFallback: boolean;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';

const PROMPT_ENHANCER_MODEL = 'together.ai/moonshotai/Kimi-K2.7-Code';
const MULTIMODAL_MODEL = 'google/gemini-3.5-flash';

const IMAGE_STRUCTURED_OUTPUT_GUIDE =
  'Structured output guide: Use these headers in this order, each on its own ' +
  'line, with a blank line between fields. Keep entries short and concrete. ' +
  'Omit any field that is irrelevant.\n\n' +
  'Subject: [who/what is in frame]\n\n' +
  'Action: [their motion or pose]\n\n' +
  'Context: [setting/environment]\n\n' +
  'Style & Ambiance: [lighting, medium, mood]\n\n' +
  'Camera & Lighting: [shot type, lens, light]\n\n' +
  'On-Screen Text: [ALWAYS include "No text, subtitles, or captions are ' +
  'visible on screen." unless the user explicitly requests visible text]\n\n' +
  'When reference images are provided, refer to them by number ' +
  '(Reference Image 1, ...). Do not fully re-describe the reference.';

const DEFAULT_EXPAND_HINT =
  'Please expand the following idea into a clear, detailed prompt.';

function parseCookieHeader(raw: string): CookieMap {
  const out: CookieMap = {};
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function flattenCookieList(list: any[]): CookieMap {
  const out: CookieMap = {};
  for (const c of list) {
    if (c && c.name && c.value != null) out[c.name] = String(c.value);
  }
  return out;
}

function parseCookieContent(text: string): CookieMap {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    let data: any = JSON.parse(t);
    if (data && typeof data === 'object' && 'cookies' in data) {
      data = (data as any).cookies;
    }
    if (Array.isArray(data)) {
      // 浏览器扩展导出的 cookie 数组：[{ name, value, domain, ... }]
      return flattenCookieList(data as any[]);
    }
    if (!data || typeof data !== 'object') {
      throw new BadRequestException('cookies JSON must be an object of name -> value');
    }
    const out: CookieMap = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (v != null) out[k] = String(v);
    }
    return out;
  }
  return parseCookieHeader(t);
}

function loadCookies(source: string | CookieMap): CookieMap {
  if (typeof source !== 'string') return { ...source };
  // source 是文件路径：读取后解析内容
  const text = readFileSync(source, 'utf8').trim();
  return parseCookieContent(text);
}

function cookieHeader(cookies: CookieMap): string {
  return Object.entries(cookies)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function cookieIsCleared(raw: string, value: string): boolean {
  if (!value) return true;
  for (const part of raw.split(';').slice(1)) {
    const eq = part.indexOf('=');
    const key = (eq < 0 ? part : part.slice(0, eq)).trim().toLowerCase();
    const val = (eq < 0 ? '' : part.slice(eq + 1)).trim();
    if (key === 'max-age') {
      const n = Number(val);
      if (Number.isFinite(n) && n <= 0) return true;
    }
    if (key === 'expires') {
      const t = Date.parse(val);
      if (!Number.isNaN(t) && t <= Date.now()) return true;
    }
  }
  return false;
}

function applySetCookie(cookies: CookieMap, setCookie: string[]): void {
  for (const raw of setCookie) {
    const first = raw.split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    if (cookieIsCleared(raw, value)) {
      delete cookies[name];
    } else {
      cookies[name] = value;
    }
  }
}

function guessMime(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function fileToDataUrl(filePath: string): { dataUrl: string; mime: string } {
  const raw = readFileSync(filePath);
  const mime = guessMime(filePath);
  return { dataUrl: `data:${mime};base64,${raw.toString('base64')}`, mime };
}

function buildPayload(opts: HedraGenerateOptions): any {
  const images = opts.imagePaths ?? [];
  const audios = opts.audioPaths ?? [];
  const attachments: any[] = [];
  const refBlocks: string[] = [];

  images.forEach((p, i) => {
    const { dataUrl } = fileToDataUrl(p);
    attachments.push({ type: 'image', url: dataUrl, category: 'reference' });
    refBlocks.push(`[Reference Image ${i + 1}]\nCategory: reference\nFile: ${basename(p)}`);
  });
  audios.forEach((p, i) => {
    const { dataUrl } = fileToDataUrl(p);
    attachments.push({ type: 'audio', url: dataUrl });
    refBlocks.push(`[Reference Audio ${i + 1}]\nFile: ${basename(p)}`);
  });

  const current = [...refBlocks, (opts.text ?? '').trim()].filter(Boolean).join('\n\n').trim();
  const pieces = [
    IMAGE_STRUCTURED_OUTPUT_GUIDE,
    (opts.userInstructions ?? '').trim(),
    current || DEFAULT_EXPAND_HINT,
  ].filter(Boolean);

  const payload: any = {
    task: 'expand_prompt',
    input: pieces.join('\n\n'),
    model: opts.model || (attachments.length ? MULTIMODAL_MODEL : PROMPT_ENHANCER_MODEL),
    options: { structure: 'fields' },
  };
  if (attachments.length) payload.attachments = attachments;
  return payload;
}

/**
 * Hedra 提示词扩写客户端（浏览器无关，纯 HTTP）。
 * 逆向来源：E:\WorkData\Hedra逆向API结果，端点 POST https://www.hedra.com/api/messages。
 */
@Injectable()
export class HedraClient {
  private cookies: CookieMap = {};
  private persistPath?: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(
    private config: ConfigService,
    private egress: EgressService,
  ) {
    this.baseUrl = (this.config.get<string>('app.hedraBaseUrl') || 'https://www.hedra.com').replace(/\/$/, '');
    this.timeoutMs = this.config.get<number>('app.hedraTimeoutMs') || 120000;
    const path = this.config.get<string>('app.hedraCookiePath') || '';
    if (path && existsSync(path)) {
      this.persistPath = path;
      this.cookies = loadCookies(path);
    }
  }

  private persist(): void {
    if (!this.persistPath) return;
    try {
      writeFileSync(this.persistPath, JSON.stringify(this.cookies, null, 2), 'utf8');
    } catch { /* ignore */ }
  }

  private headers(cookies: CookieMap, extra: Record<string, string> = {}): Record<string, string> {
    return {
      'user-agent': DEFAULT_UA,
      'accept-language': 'en-US,en;q=0.9',
      origin: this.baseUrl,
      referer: `${this.baseUrl}/app/library`,
      cookie: cookieHeader(cookies),
      ...extra,
    };
  }

  private async assertAllowed(url: string) {
    await this.egress.assertAllowed(url, NetworkScope.BROAD);
  }

  private async post(url: string, body: any, cookies: CookieMap): Promise<AxiosResponse<any>> {
    await this.assertAllowed(url);
    return axios.post(url, body, {
      headers: this.headers(cookies, {
        accept: '*/*',
        'content-type': 'application/json',
      }),
      timeout: this.timeoutMs,
      responseType: 'stream',
      validateStatus: () => true, // 自己处理状态码
    });
  }

  private applyCookies(cookies: CookieMap, resp: AxiosResponse<any>): void {
    const setCookie: string[] = Array.isArray(resp.headers['set-cookie'])
      ? resp.headers['set-cookie']
      : resp.headers['set-cookie']
        ? [resp.headers['set-cookie']]
        : [];
    if (setCookie.length) {
      applySetCookie(cookies, setCookie);
      // 仅全局 cookie（this.cookies）才回写文件；用户级覆盖不落盘
      if (cookies === this.cookies) this.persist();
    }
  }

  /**
   * 可选：验证 cookie 是否已登录。
   * @param cookieOverride 用户级 cookie 原始串（数组/对象/header 均可）；缺省用全局 .env 文件。
   */
  async profile(cookieOverride?: string): Promise<{ email?: string; id?: string; raw: any }> {
    const cookies = cookieOverride ? parseCookieContent(cookieOverride) : this.cookies;
    const url = `${this.baseUrl}/api/profile`;
    await this.assertAllowed(url);
    const resp = await axios.get(url, {
      headers: this.headers(cookies, { accept: 'application/json' }),
      timeout: 30000,
      validateStatus: () => true,
    });
    this.applyCookies(cookies, resp);
    const text = await this.readText(resp);
    if (resp.status >= 400) {
      throw new BadRequestException(`profile HTTP ${resp.status}: ${text.slice(0, 400)}`);
    }
    const raw = JSON.parse(text);
    const user = raw.loggedInUser;
    if (!user?.id) throw new BadRequestException('profile is not logged in');
    return { email: user.email, id: user.id, raw };
  }

  private async readText(resp: AxiosResponse<any>): Promise<string> {
    if (typeof resp.data === 'string') return resp.data;
    // stream mode
    const chunks: Buffer[] = [];
    for await (const chunk of resp.data) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /**
   * 核心：cookie + 图片 + 音频 + 文字 -> 结构化提示词。
   * 失败时抛错，调用方负责记录任务日志。
   */
  async generatePrompt(opts: HedraGenerateOptions, cookieOverride?: string): Promise<HedraGenerateResult> {
    const cookies = cookieOverride ? parseCookieContent(cookieOverride) : this.cookies;
    const payload = buildPayload(opts);
    const attachments = payload.attachments ?? [];
    let usedFallback = false;

    const attempt = async (body: any) => {
      const resp = await this.post(`${this.baseUrl}/api/messages`, body, cookies);
      this.applyCookies(cookies, resp);
      const text = await this.readText(resp);
      if (resp.status >= 400) {
        throw new BadRequestException(`/api/messages HTTP ${resp.status}: ${text.slice(0, 800)}`);
      }
      const prompt = text.trim();
      if (!prompt) throw new BadRequestException('prompt expansion returned empty body');
      return prompt;
    };

    let prompt: string;
    try {
      prompt = await attempt(payload);
    } catch (err) {
      // 音频附件若 4xx，按原始代码逻辑降级为「图 + 文」再试一次
      if (attachments.length) {
        const imageOnly = attachments.filter((a: any) => a.type === 'image');
        const next: any = { ...payload };
        delete next.attachments;
        if (imageOnly.length) {
          next.attachments = imageOnly;
          next.model = opts.model || MULTIMODAL_MODEL;
        } else {
          next.model = opts.model || PROMPT_ENHANCER_MODEL;
        }
        try {
          prompt = await attempt(next);
          usedFallback = true;
        } catch (e2) {
          throw err; // 抛出原始错误
        }
      } else {
        throw err;
      }
    }

    return {
      prompt,
      model: payload.model,
      attachmentCount: attachments.length,
      usedFallback,
    };
  }

  /** 从本地文件路径生成 payload（用于后端服务组装，不直接发请求） */
  buildPayloadForPaths(opts: HedraGenerateOptions): any {
    return buildPayload(opts);
  }

  private extFromContentTypeOrUrl(ct: string, url: string): string {
    const map: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'audio/wav': '.wav',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.m4a',
      'audio/aac': '.aac',
      'audio/ogg': '.ogg',
      'audio/flac': '.flac',
    };
    if (map[ct]) return map[ct];
    const m = url.match(/\.[a-z0-9]+$/i);
    return m ? m[0].toLowerCase() : '';
  }

  /**
   * 当素材仅提供 URL（无本地文件）时，临时下载到本地再交给 Hedra。
   * Hedra 要求附件以 data URL 内联，必须有本地字节。下载受 EgressGuard 管控。
   */
  async downloadToTemp(url: string): Promise<string> {
    if (!/^https?:\/\//i.test(url)) {
      throw new BadRequestException('Hedra 素材仅支持 http(s) 链接下载');
    }
    await this.assertAllowed(url);
    const resp = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: this.timeoutMs,
      headers: { 'user-agent': DEFAULT_UA, referer: this.baseUrl },
    });
    const ct: string = (resp.headers['content-type'] as string) || '';
    const ext = this.extFromContentTypeOrUrl(ct, url);
    const name = `hedra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const tmp = join(tmpdir(), name);
    writeFileSync(tmp, Buffer.from(resp.data));
    return tmp;
  }
}
