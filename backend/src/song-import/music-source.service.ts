import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import { EgressService } from '../egress/egress.service';
import { NetworkScope } from '../common/roles.enum';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as https from 'https';
import { v4 as uuid } from 'uuid';

/**
 * 音乐聚合源（如 kw-api.cenguigui.cn 及其 mp3 CDN）的 HTTPS 证书经常过期，
 * 导致 axios 默认校验报错 `certificate has expired`。该源为受信的 BROAD 出站下载，
 * 且仍受 EgressGuard 的 DNS 内网拦截保护，故对其请求跳过证书校验（仅限本服务）。
 * 切勿将此 agent 用于其它业务请求。
 */
const INSECURE_HTTPS_AGENT = new https.Agent({ rejectUnauthorized: false });

export interface ParsedSong {
  song: string;
  artist: string;
}

export interface SongMeta {
  title: string;
  artist: string;
  mp3Url: string;
  durationSec?: number;
  lyrics?: string;
  coverUrl?: string;
}

/**
 * 音乐聚合源客户端 —— 参考 suno_auto_production-master 的 music_sources（kuwo_api 默认主源）。
 *
 * 流程：
 *   1) parseSongList 解析「歌名-作者」多行文本
 *   2) fetchSong 调聚合 API 取 mp3 直链 + 元数据 + LRC 歌词
 *   3) download 把 mp3 落到服务器本地存储（供 P2/P3 直接取 localPath 使用）
 *
 * 出站说明：音乐 API 与返回的 mp3 CDN 均为服务端受信下载，统一以 BROAD 范围出站，
 * 但仍受 EgressGuard 的 DNS 内网拦截保护（不会打到内网地址）。
 */
@Injectable()
export class MusicSourceService {
  private readonly logger = new Logger(MusicSourceService.name);
  private base: string;
  private storeDir: string;

  constructor(
    private config: ConfigService,
    private egress: EgressService,
  ) {
    this.base = (
      this.config.get<string>('app.musicSourceBase') ||
      'https://kw-api.cenguigui.cn'
    ).replace(/\/+$/, '');
    this.storeDir = path.join(
      this.config.get<string>('app.storagePath') || './data/media',
      'songs',
    );
  }

  /** 解析「歌名-作者」多行文本，每行产出一首 */
  parseSongList(text: string): ParsedSong[] {
    const out: ParsedSong[] = [];
    for (const raw of (text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      // 支持 - / — (em dash) / – (en dash) 分隔
      const parts = line.split(/[-—–]/);
      if (parts.length >= 2) {
        const song = parts[0].trim();
        const artist = parts.slice(1).join('-').trim();
        if (!song) continue;
        out.push({ song, artist: artist || '空' });
      } else {
        out.push({ song: line, artist: '空' });
      }
    }
    return out;
  }

  /**
   * 对受信音乐源发起 GET，跳过 HTTPS 证书校验（解决证书过期问题）。
   * 仍先经 EgressService 做 SSRF / 内网拦截，不破坏出站安全策略。
   */
  private async insecureGet(url: string, config: AxiosRequestConfig = {}) {
    await this.egress.assertAllowed(url, NetworkScope.BROAD);
    try {
      return await axios.get(url, {
        ...config,
        httpsAgent: INSECURE_HTTPS_AGENT,
        beforeRedirect: (options) => {
          // 重定向到新 host（尤其是 mp3 CDN）时继续复用不校验 agent
          options.httpsAgent = INSECURE_HTTPS_AGENT;
          options.agent = INSECURE_HTTPS_AGENT;
        },
      });
    } catch (err: any) {
      this.logger.warn(`[insecureGet] ${url} 失败: ${err?.message}`);
      throw err;
    }
  }

  /** 搜索 + 取详情，返回可直接下载的元数据 */
  async fetchSong(song: string, artist: string): Promise<SongMeta> {
    const kw = artist && artist !== '空' ? `${song} ${artist}` : song;

    const searchUrl = `${this.base}/?name=${encodeURIComponent(kw)}&page=1&limit=1`;
    const sResp = await this.insecureGet(searchUrl, { timeout: 20000 });
    const raw = sResp.data;
    // 防御：聚合源偶尔返回空串/HTML，给出清晰报错而非「未找到歌曲」
    if (typeof raw === 'string' || !raw || (typeof raw === 'object' && !Array.isArray(raw) && !raw.data)) {
      this.logger.warn(`[fetchSong] 音乐源返回非预期内容: ${typeof raw === 'string' ? raw.slice(0, 120) : JSON.stringify(raw).slice(0, 120)}`);
      throw new BadRequestException('音乐聚合源返回异常（非预期 JSON），请检查 app.musicSourceBase 配置或该源是否可用');
    }
    const list: any[] =
      sResp.data?.data && Array.isArray(sResp.data.data)
        ? sResp.data.data
        : Array.isArray(sResp.data)
          ? sResp.data
          : [];
    const first = list[0];
    if (!first?.rid) {
      throw new BadRequestException(`未找到歌曲：${kw}`);
    }

    const detailUrl = `${this.base}/?id=${encodeURIComponent(first.rid)}&type=song&level=exhigh`;
    const dResp = await this.insecureGet(detailUrl, { timeout: 20000 });
    const d = dResp.data?.data || dResp.data;
    const mp3Url: string | undefined = d?.url;
    if (!mp3Url) {
      throw new BadRequestException(`未获取到下载链接：${kw}`);
    }

    return {
      title: d?.name || d?.title || song,
      artist: d?.artist || (artist === '空' ? '' : artist),
      mp3Url,
      durationSec: this.parseDuration(d?.duration),
      lyrics: this.cleanLyrics(d?.lyric),
      coverUrl: d?.pic,
    };
  }

  /** 下载 mp3 到本地存储，返回本地路径 */
  async download(mp3Url: string): Promise<string> {
    await fs.mkdir(this.storeDir, { recursive: true });
    let ext = '.mp3';
    try {
      const p = new URL(mp3Url).pathname;
      const e = path.extname(p);
      if (e && e.length <= 5) ext = e;
    } catch {
      /* 忽略，默认 .mp3 */
    }
    const dest = path.join(this.storeDir, `${uuid()}${ext}`);
    const resp = await this.insecureGet(mp3Url, {
      responseType: 'arraybuffer',
      timeout: 120000,
    });
    await fs.writeFile(dest, Buffer.from(resp.data as ArrayBuffer));
    this.logger.log(`下载歌曲落盘: ${dest}`);
    return dest;
  }

  private parseDuration(raw?: string | number): number | undefined {
    if (raw == null) return undefined;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
    return isNaN(n) ? undefined : Math.round(n);
  }

  /** 清洗 LRC 歌词：去时间戳、去元信息行、压缩空行 */
  private cleanLyrics(raw?: string): string | undefined {
    if (!raw) return undefined;
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.replace(/\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\]/g, ''))
      .filter((l) => !/^[一-鿿\w/]{1,10}[：:]/.test(l.trim())) // 跳过 词：/曲：等
      .filter((l) => !/^(歌名|歌曲|演唱|歌手)\s*[-—–]\s*/.test(l.trim()))
      .map((l) => l.trim())
      .filter(Boolean);
    const cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return cleaned || undefined;
  }
}
