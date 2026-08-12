import {
  Injectable,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as crypto from 'crypto';
import { EgressHttpService } from '../egress/egress-http.service';
import { NetworkScope } from '../common/roles.enum';

/**
 * 即梦（Jimeng）核心请求能力 —— 从 jimen2api-all-master（jimeng-free-api）移植。
 *
 * 关键约定（用户实测结论）：
 *  - 调用即梦时**只用 sessionid 重建 Cookie**（generateCookie），不可原样回放整份 cookie map；
 *    整份 map 仅作为登录失败时的兜底查值来源（见 jimeng.service 调用策略）。
 *  - 所有出站请求经 EgressHttpService，受 SSRF 白名单约束。
 */

const JIMENG_BASE = 'https://jimeng.jianying.com';
const IMAGEX_HOST = 'https://imagex.bytedanceapi.com';
const VOD_HOST = 'https://vod.bytedanceapi.com';

const DEFAULT_ASSISTANT_ID = 513695;
const VERSION_CODE = '5.8.0';
const PLATFORM_CODE = '7';
const DRAFT_VERSION = '3.3.20';
const WEB_VERSION = '7.5.0';
const MIN_VERSION = '3.0.2';
const FILE_MAX_SIZE = 100 * 1024 * 1024;

// 模块级随机常量（与 jimen2api 一致，模拟浏览器会话）
// 注意：uid_tt / _tea_web_id 必须是模块级固定值，不能在每次请求时重新随机，
// 否则即梦会把 sessionid 与 uid_tt 不匹配的会话判定为异常登录，导致 302 踢回、查活全部失效。
const WEB_ID = Math.floor(Math.random() * 9_999_999_999_999_999_999 + 7_000_000_000_000_000_000).toString();
const UID_TT = crypto.randomUUID().replace(/-/g, '');

const FAKE_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-language': 'zh-CN,zh;q=0.9',
  'Cache-control': 'no-cache',
  Appid: `${DEFAULT_ASSISTANT_ID}`,
  Appvr: VERSION_CODE,
  Origin: JIMENG_BASE,
  Pragma: 'no-cache',
  Priority: 'u=1, i',
  Referer: JIMENG_BASE,
  Pf: PLATFORM_CODE,
  'Sec-Ch-Ua': '"Google Chrome";v="142", "Chromium";v="142", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
};

// ---------------- 本地工具函数 ----------------
function md5(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex');
}
function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}
function uuidNoDash(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
function randomAlphanumeric(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

let crc32Table: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!crc32Table) {
    crc32Table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32Table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crc32Table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function isBase64Data(value: string): boolean {
  return /^data:/.test(value);
}
function extractBase64Format(value: string): string | null {
  const m = value.trim().match(/^data:(.+);base64,/);
  return m ? m[1] : null;
}
function removeBase64Header(value: string): string {
  return value.replace(/^data:(.+);base64,/, '');
}
function extFromMime(mimeType: string | null): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
  };
  return (mimeType && map[mimeType]) || 'bin';
}

// ---------------- 即梦 cookie 重建（主调用路径） ----------------
/**
 * 用 sessionid（即 refreshToken）重建即梦 Cookie。
 * 注意：只填 sessionid/sid_tt/sid_guard 等核心字段 + 随机伪造 uid_tt，
 * 不回放导入时的整份 cookie map（实测原样回放会登录失败）。
 */
export function generateCookie(refreshToken: string): string {
  return [
    `_tea_web_id=${WEB_ID}`,
    `is_staff_user=false`,
    `store-region=cn-gd`,
    `store-region-src=uid`,
    `sid_guard=${refreshToken}%7C${unixTimestamp()}%7C5184000%7CMon%2C+03-Feb-2025+08%3A17%3A09+GMT`,
    `uid_tt=${UID_TT}`,
    `uid_tt_ss=${UID_TT}`,
    `sid_tt=${refreshToken}`,
    `sessionid=${refreshToken}`,
    `sessionid_ss=${refreshToken}`,
  ].join('; ');
}

// ---------------- 错误码 ----------------
export class JimengInsufficientCreditError extends BadRequestException {
  constructor(msg: string) {
    super(msg);
  }
}

@Injectable()
export class JimengCoreService {
  private readonly logger = new Logger(JimengCoreService.name);

  constructor(private readonly http: EgressHttpService) {}

  /** 从 Authorization: Bearer t1,t2,t3 拆出 token 列表 */
  tokenSplit(authorization: string): string[] {
    return authorization
      .replace(/^Bearer\s+/i, '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  /** 计算请求签名（Sign），与 jimen2api 完全一致 */
  private buildSign(uri: string, deviceTime: number): string {
    return md5(`9e2c|${uri.slice(-7)}|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}||11ac`);
  }

  /**
   * 即梦通用请求（POST/GET）。返回 axios 响应，调用方自行 checkResult。
   * scope 用于 SSRF 白名单判定。
   */
  async jimengRequest(
    method: 'get' | 'post',
    uri: string,
    sessionid: string,
    options: { params?: Record<string, any>; data?: any; headers?: Record<string, string>; timeout?: number; validateStatus?: () => boolean } = {},
    scope: NetworkScope = NetworkScope.RESTRICTED,
  ): Promise<AxiosResponse> {
    const deviceTime = unixTimestamp();
    const sign = this.buildSign(uri, deviceTime);
    const fullUrl = `${JIMENG_BASE}${uri}`;
    const requestParams = {
      aid: DEFAULT_ASSISTANT_ID,
      device_platform: 'web',
      region: 'CN',
      webId: WEB_ID,
      ...(options.params || {}),
    };
    const headers: Record<string, string> = {
      ...FAKE_HEADERS,
      Cookie: generateCookie(sessionid),
      'Device-Time': `${deviceTime}`,
      Sign: sign,
      'Sign-Ver': '1',
      ...(options.headers || {}),
    };
    const config: AxiosRequestConfig = {
      params: requestParams,
      headers,
      timeout: options.timeout || 45000,
      ...(options.validateStatus ? { validateStatus: options.validateStatus } : {}),
    };
    if (method === 'post') {
      (config as any).data = options.data;
    }
    return method === 'get'
      ? this.http.get(fullUrl, scope, config)
      : this.http.post(fullUrl, scope, options.data, config);
  }

  /** 校验即梦返回体，ret!='0' 抛错 */
  checkResult(result: AxiosResponse): any {
    const data = result.data;
    const ret = data?.ret;
    const errmsg = data?.errmsg;
    if (ret === undefined || ret === null) return data;
    if (!Number.isFinite(Number(ret))) return data;
    if (String(ret) === '0') return data.data;
    if (String(ret) === '5000' || String(ret) === '1006') {
      throw new JimengInsufficientCreditError(`[积分不足]: ${errmsg} (错误码: ${ret})`);
    }
    throw new BadRequestException(`[即梦请求失败]: ${errmsg} (错误码: ${ret})`);
  }

  /** AWS SigV4 授权头（imagex / vod 上传凭证） */
  private async generateAWSAuthorizationHeader(
    accessKeyID: string,
    secretAccessKey: string,
    sessionToken: string,
    region: string,
    service: string,
    requestMethod: string,
    requestParams: Record<string, any>,
    requestBody: any = {},
  ): Promise<Record<string, string> & { canonicalQueryString: string }> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const amzDay = amzDate.substring(0, 8);

    const requestHeaders: Record<string, string> = {
      'x-amz-date': amzDate,
      'x-amz-security-token': sessionToken,
    };
    const hasBody = requestBody && Object.keys(requestBody).length > 0;
    const bodyPayload = hasBody ? JSON.stringify(requestBody) : '';
    const bodyHash = crypto.createHash('sha256').update(bodyPayload, 'utf8').digest('hex');
    if (hasBody) requestHeaders['x-amz-content-sha256'] = bodyHash;

    const credentialString = `${amzDay}/${region}/${service}/aws4_request`;
    const canonicalQueryString = Object.keys(requestParams)
      .sort()
      .map((key) => {
        const value = encodeURIComponent(String(requestParams[key])).replace(
          /[!'()*]/g,
          (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
        );
        return `${encodeURIComponent(key)}=${value}`;
      })
      .join('&');

    const signedHeaders = Object.keys(requestHeaders)
      .map((k) => k.toLowerCase())
      .sort()
      .join(';');
    const canonicalHeaders = Object.keys(requestHeaders)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map((k) => `${k.toLowerCase()}:${requestHeaders[k].trim()}`)
      .join('\n') + '\n';

    const canonicalRequest = [
      requestMethod.toUpperCase(),
      '/',
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      bodyHash,
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialString,
      crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
    ].join('\n');

    const kDate = crypto.createHmac('sha256', 'AWS4' + secretAccessKey).update(amzDay).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const signingKey = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyID}/${credentialString}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      'X-Amz-Date': amzDate,
      'X-Amz-Security-Token': sessionToken,
      ...(hasBody ? { 'X-Amz-Content-Sha256': bodyHash } : {}),
      Authorization: authorization,
      canonicalQueryString,
    } as Record<string, string> & { canonicalQueryString: string };
  }

  /** 上传图片到 imagex，返回 image_uri */
  async uploadFile(
    sessionid: string,
    fileSource: string | Buffer,
    scope: NetworkScope = NetworkScope.RESTRICTED,
  ): Promise<string> {
    let fileData: Buffer;
    let filename = `${uuidNoDash()}.png`;

    if (Buffer.isBuffer(fileSource)) {
      fileData = fileSource;
    } else if (isBase64Data(fileSource)) {
      const mimeType = extractBase64Format(fileSource);
      filename = `${uuidNoDash()}.${extFromMime(mimeType)}`;
      fileData = Buffer.from(removeBase64Header(fileSource), 'base64');
    } else if (fileSource.startsWith('http://') || fileSource.startsWith('https://')) {
      const resp = await this.http.get(fileSource, scope, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: FILE_MAX_SIZE,
      } as any);
      fileData = Buffer.from(resp.data);
      filename = fileSource.split('?')[0].split('/').pop() || filename;
    } else {
      throw new BadRequestException(`不支持的文件来源: ${String(fileSource).slice(0, 40)}`);
    }

    // 获取上传令牌
    const uploadAuth = await this.jimengRequest(
      'post',
      '/mweb/v1/get_upload_token?aid=513695&da_version=3.2.2&aigc_features=app_lip_sync',
      sessionid,
      { data: { scene: 2 } },
      scope,
    ).then((r) => this.checkResult(r));
    if (!uploadAuth || !uploadAuth.access_key_id) {
      throw new BadRequestException('获取上传凭证失败，账号可能已掉线');
    }

    const crc = (crc32(fileData) >>> 0).toString(16);
    const applyParams = {
      Action: 'ApplyImageUpload',
      FileSize: fileData.length,
      ServiceId: 'tb4s082cfz',
      Version: '2018-08-01',
      s: randomAlphanumeric(11),
    };
    const applyHead = await this.generateAWSAuthorizationHeader(
      uploadAuth.access_key_id,
      uploadAuth.secret_access_key,
      uploadAuth.session_token,
      'cn-north-1',
      'imagex',
      'GET',
      applyParams,
    );
    const { canonicalQueryString: applyQuery, ...applyHeaders } = applyHead;
    const uploadImgRes = await this.http.get(`${IMAGEX_HOST}/?${applyQuery}`, scope, {
      headers: applyHeaders as any,
      timeout: 30000,
    } as any);
    if (uploadImgRes.data?.['Response ']?.hasOwnProperty('Error')) {
      throw new BadRequestException(uploadImgRes.data['Response ']['Error']['Message']);
    }
    const UploadAddress = uploadImgRes.data.Result.UploadAddress;
    const uploadImgUrl = `https://${UploadAddress.UploadHosts[0]}/upload/v1/${UploadAddress.StoreInfos[0].StoreUri}`;

    const imageUploadRes = await this.http.post(
      uploadImgUrl,
      scope,
      fileData,
      {
        headers: {
          Authorization: UploadAddress.StoreInfos[0].Auth,
          'Content-Crc32': crc,
          'Content-Type': 'application/octet-stream',
        },
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      } as any,
    );
    if (imageUploadRes.data.code !== 2000) {
      throw new BadRequestException(imageUploadRes.data.message || '上传文件失败');
    }

    const commitParams = {
      Action: 'CommitImageUpload',
      FileSize: fileData.length,
      ServiceId: 'tb4s082cfz',
      Version: '2018-08-01',
    };
    const commitHead = await this.generateAWSAuthorizationHeader(
      uploadAuth.access_key_id,
      uploadAuth.secret_access_key,
      uploadAuth.session_token,
      'cn-north-1',
      'imagex',
      'POST',
      commitParams,
      { SessionKey: UploadAddress.SessionKey },
    );
    const { canonicalQueryString: commitQuery, ...commitHeaders } = commitHead;
    const commitImg = await this.http.post(
      `${IMAGEX_HOST}/?${commitQuery}`,
      scope,
      { SessionKey: UploadAddress.SessionKey },
      {
        headers: { ...(commitHeaders as any), 'Content-Type': 'application/json' },
        timeout: 30000,
      } as any,
    );
    if (commitImg.data?.['Response ']?.hasOwnProperty('Error')) {
      throw new BadRequestException(commitImg.data['Response ']['Error']['Message']);
    }
    return commitImg.data.Result.Results[0].Uri;
  }

  /** 获取积分信息 */
  async getCredit(sessionid: string, scope: NetworkScope = NetworkScope.RESTRICTED) {
    const result = await this.jimengRequest(
      'post',
      '/commerce/v1/benefits/user_credit',
      sessionid,
      { data: {}, headers: { Referer: 'https://jimeng.jianying.com/ai-tool/image/generate' } },
      scope,
    );
    const data = this.checkResult(result);
    const credit = data?.credit || {};
    const total = (credit.gift_credit || 0) + (credit.purchase_credit || 0) + (credit.vip_credit || 0);
    return { totalCredit: total, ...credit };
  }

  /** 领取今日积分（每日签到养号；生成时积分不足也会触发） */
  async receiveCredit(sessionid: string, scope: NetworkScope = NetworkScope.RESTRICTED) {
    const result = await this.jimengRequest(
      'post',
      '/commerce/v1/benefits/credit_receive',
      sessionid,
      { data: { time_zone: 'Asia/Shanghai' }, headers: { Referer: 'https://jimeng.jianying.com/ai-tool/image/generate' } },
      scope,
    );
    const data = this.checkResult(result);
    return data?.cur_total_credits ?? null;
  }

  /** Token 存活检测 */
  async getTokenLiveStatus(sessionid: string, scope: NetworkScope = NetworkScope.RESTRICTED): Promise<boolean> {
    return (await this.refreshSession(sessionid, scope)).alive;
  }

  /**
   * 长效 cookie 访问网站接口换取短效 cookie。
   *
   * 策略：
   * 1. 先调 /commerce/v1/benefits/user_credit（查积分）。能查到就说明 sessionid 可用，
   *    直接判定 alive = true。这是 jimen2api 实际判定账号可用的核心标准。
   * 2. 再调 /passport/account/info/v2 尝试捕获响应头 Set-Cookie 中刷新的 sessionid/sid_tt/sid_guard
   *    （即「短效 cookie」），用于后续生成。该接口失败不影响存活判定。
   */
  async refreshSession(
    sessionid: string,
    scope: NetworkScope = NetworkScope.RESTRICTED,
  ): Promise<{ alive: boolean; refreshed?: { sessionid?: string; sidTt?: string; sidGuard?: string }; error?: string }> {
    // 步骤 1：以查积分作为存活判定（最可靠）
    let alive = false;
    let step1Error: string | undefined;
    try {
      await this.getCredit(sessionid, scope);
      alive = true;
    } catch (err: any) {
      // 积分不足（ret=5000/1006）说明账号能登录，只是没分，仍算 alive
      if (err instanceof JimengInsufficientCreditError) {
        alive = true;
        this.logger.log(`[refreshSession] 账号登录正常但积分不足`);
      } else {
        step1Error = err?.message || String(err);
        this.logger.warn(`[refreshSession] 查积分失败，账号可能已失效: ${step1Error}`);
      }
    }

    // 步骤 2：尝试从 passport 接口刷新短效 cookie（失败不阻断）
    try {
      const result = await this.jimengRequest(
        'post',
        '/passport/account/info/v2',
        sessionid,
        { params: { account_sdk_source: 'web' } },
        scope,
      );
      let passportAlive = false;
      try {
        const data = this.checkResult(result);
        passportAlive = !!data?.user_id;
      } catch (err: any) {
        this.logger.debug(`[refreshSession] /passport/account/info/v2 返回非成功: ${err?.message || err}`);
      }
      // passport 能走到 user_id 也认活（兜底）
      if (passportAlive) alive = true;
      const refreshed = this.extractRefreshedCookies(result.headers);
      return { alive, refreshed, error: step1Error };
    } catch (err: any) {
      const step2Error = err?.message || String(err);
      this.logger.debug(`[refreshSession] /passport/account/info/v2 调用失败: ${step2Error}`);
      return { alive, error: step1Error || step2Error };
    }
  }

  /** 从响应头 Set-Cookie 中提取刷新的 sessionid / sid_tt / sid_guard */
  private extractRefreshedCookies(headers: Record<string, any>): { sessionid?: string; sidTt?: string; sidGuard?: string } {
    const setCookie = headers?.['set-cookie'] ?? headers?.['Set-Cookie'];
    if (!setCookie) return {};
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    const out: { sessionid?: string; sidTt?: string; sidGuard?: string } = {};
    for (const sc of arr) {
      const ms = String(sc).match(/sessionid=([^;]+)/i);
      if (ms) out.sessionid = decodeURIComponent(ms[1]);
      const mt = String(sc).match(/sid_tt=([^;]+)/i);
      if (mt) out.sidTt = decodeURIComponent(mt[1]);
      const mg = String(sc).match(/sid_guard=([^;]+)/i);
      if (mg) out.sidGuard = decodeURIComponent(mg[1].split('%7C')[0].split('|')[0]);
    }
    return out;
  }

  /* =========================================================
   * 视频 / 图片生成（基于 jimen2api-all 真实接口封装）
   * 说明：本 service 仅为「即梦核心调用层」，不依赖数据库，
   * 选号/存储由 jimeng-account.service 与 jimeng-video/image.service 负责。
   * 以下方法接收 sessionid，返回即梦平台的任务 id 或结果。
   * ========================================================= */

  /**
   * 提交视频生成任务。
   * @returns { task_id } 即梦平台的生成任务 id
   */
  async generateVideo(
    sessionid: string,
    opts: {
      prompt: string;
      ratio?: string;
      resolution?: string;
      duration?: number;
      firstFrameImage?: string; // 本地图片 url，需先 uploadFile 转 image_uri
      endFrameImage?: string;
      referenceImages?: string[]; // 已转 image_uri 的参考图
      referenceMode?: string;
    },
    scope: NetworkScope = NetworkScope.RESTRICTED,
  ): Promise<{ task_id: string }> {
    // 首帧 / 尾帧：本地 url -> image_uri
    let firstFrameImageUri: string | undefined;
    let endFrameImageUri: string | undefined;

    if (opts.firstFrameImage) {
      try {
        firstFrameImageUri = await this.uploadFile(sessionid, opts.firstFrameImage);
      } catch (e: any) {
        this.logger.warn(`[generateVideo] 首帧上传失败: ${e?.message}`);
      }
    }
    if (opts.endFrameImage) {
      try {
        endFrameImageUri = await this.uploadFile(sessionid, opts.endFrameImage);
      } catch (e: any) {
        this.logger.warn(`[generateVideo] 尾帧上传失败: ${e?.message}`);
      }
    }

    const [w, h] = (opts.ratio || '16:9').split(':').map(Number);
    const duration = opts.duration || 10;
    const resolution = opts.resolution || '720p';

    // 参考图作为 content（文本前）
    const imageContents: any[] = [];
    for (const uri of opts.referenceImages || []) {
      imageContents.push({ type: 'image', image_uri: uri });
    }

    const mainContent: any[] = [
      ...imageContents,
      { type: 'text', text: opts.prompt },
    ];

    const payload: any = {
      model: 'vision',
      data_type: 'aigc_video',
      main_file_id: '',
      generate_num: 1,
      generate_params: {
        video_duration: duration,
        resolution: resolution === '1080p' ? '1080p' : '720p',
        aspect_ratio: `${w}:${h}`,
        mode: 'general',
        model_version: 'v3.0',
        first_frame_image: firstFrameImageUri ? { image_uri: firstFrameImageUri } : null,
        last_frame_image: endFrameImageUri ? { image_uri: endFrameImageUri } : null,
        manual_beautify: false,
        mp_mode: false,
        watermark: false,
        movie_gen: 0,
        seed: -1,
        // 全能参考：若提供参考图，附加 master/reference 信息
        ...(opts.referenceMode && (opts.referenceImages || []).length
          ? { reference_type: opts.referenceMode, reference_images: opts.referenceImages }
          : {}),
      },
      content: JSON.stringify(mainContent),
      assistant_id: DEFAULT_ASSISTANT_ID,
      chat_id: '',
      event_group_id: uuidNoDash(),
      ref_proxy_id: '',
      ref_proxy_source: '',
      client_agent: 'web_script',
      origin_assistant_id: DEFAULT_ASSISTANT_ID,
      prompt_recommend: false,
      file_extra: {},
      template_id: '',
      template_version: '',
      version_code: VERSION_CODE,
      platform_code: PLATFORM_CODE,
      draft_version: DRAFT_VERSION,
      app_version: WEB_VERSION,
      min_version: MIN_VERSION,
    };

    const result = await this.jimengRequest(
      'post',
      '/mweb/v1/aigc_draft/generate',
      sessionid,
      {
        data: payload,
        headers: { Referer: 'https://jimeng.jianying.com/ai-tool/video/generate' },
      },
      scope,
    );
    const data = this.checkResult(result);
    const taskId = data?.task_id || data?.id;
    if (!taskId) throw new Error('即梦未返回任务ID：' + JSON.stringify(data).slice(0, 200));
    return { task_id: taskId };
  }

  /** 轮询视频生成结果 */
  async queryVideoResult(
    taskId: string,
    sessionid: string,
    scope: NetworkScope = NetworkScope.RESTRICTED,
  ) {
    const result = await this.jimengRequest(
      'post',
      '/mweb/v1/get_history_by_ids',
      sessionid,
      {
        data: { draft_ids: [taskId], type: 2, force_legacy: false },
        headers: { Referer: 'https://jimeng.jianying.com/ai-tool/video/generate' },
      },
      scope,
    );
    const data = this.checkResult(result);
    const histories: any[] = data?.histories || data?.data?.histories || [];
    const task = histories[0];
    if (!task) {
      // 还没生成出来，返回处理中
      return { status_code: 1, progress: 10 } as any;
    }
    const status = task.status; // 1=排队 2=生成中 3=成功 4=失败
    if (status === 3) {
      let videoUrl = '';
      let coverUrl = '';
      try {
        const work = JSON.parse(task.workflow_json || '{}');
        const items = work?.data?.[0]?.work_list?.[0]?.origin?.[0]?.work?.[0]?.items || [];
        // 取最后一个含视频的项
        for (const it of items) {
          if (it?.video?.video_url?.url) videoUrl = it.video.video_url.url;
          if (it?.cover?.url) coverUrl = it.cover.url;
          if (it?.video?.cover_image?.url) coverUrl = it.video.cover_image.url;
        }
      } catch (e) {
        this.logger.warn(`[queryVideoResult] 解析 workflow_json 失败: ${e}`);
      }
      return { status_code: 2, video_url: videoUrl, cover_url: coverUrl, progress: 100 } as any;
    }
    if (status === 4) {
      return { status_code: 3, status_msg: task.fail_reason || '生成失败' } as any;
    }
    return { status_code: 1, progress: 30 } as any;
  }

  /**
   * 提交图片生成任务。
   * @returns { task_id }
   */
  async generateImage(
    sessionid: string,
    opts: {
      prompt: string;
      ratio?: string;
      imageUrl?: string; // 本地参考图 url，需 uploadFile 转 image_uri
    },
    scope: NetworkScope = NetworkScope.RESTRICTED,
  ): Promise<{ task_id: string }> {
    let imageUri: string | undefined;
    if (opts.imageUrl) {
      try {
        imageUri = await this.uploadFile(sessionid, opts.imageUrl);
      } catch (e: any) {
        this.logger.warn(`[generateImage] 参考图上传失败: ${e?.message}`);
      }
    }

    const [w, h] = (opts.ratio || '1:1').split(':').map(Number);
    const mainContent: any[] = [];
    if (imageUri) mainContent.push({ type: 'image', image_uri: imageUri });
    mainContent.push({ type: 'text', text: opts.prompt });

    const payload: any = {
      model: 'gemini-2.5-flash',
      data_type: 'aigc_image',
      main_file_id: '',
      generate_num: 4,
      generate_params: {
        prompt: opts.prompt,
        image_ratio: `${w}:${h}`,
        manual_beautify: false,
        watermark: false,
        seed: -1,
        scale: 2,
        restore_clear: false,
      },
      content: JSON.stringify(mainContent),
      assistant_id: DEFAULT_ASSISTANT_ID,
      chat_id: '',
      event_group_id: uuidNoDash(),
      ref_proxy_id: '',
      ref_proxy_source: '',
      client_agent: 'web_script',
      origin_assistant_id: DEFAULT_ASSISTANT_ID,
      prompt_recommend: false,
      file_extra: {},
      template_id: '',
      template_version: '',
      version_code: VERSION_CODE,
      platform_code: PLATFORM_CODE,
      draft_version: DRAFT_VERSION,
      app_version: WEB_VERSION,
      min_version: MIN_VERSION,
    };

    const result = await this.jimengRequest(
      'post',
      '/mweb/v1/aigc_draft/generate',
      sessionid,
      {
        data: payload,
        headers: { Referer: 'https://jimeng.jianying.com/ai-tool/image/generate' },
      },
      scope,
    );
    const data = this.checkResult(result);
    const taskId = data?.task_id || data?.id;
    if (!taskId) throw new Error('即梦未返回图片任务ID：' + JSON.stringify(data).slice(0, 200));
    return { task_id: taskId };
  }

  /** 轮询图片生成结果 */
  async queryImageResult(
    taskId: string,
    sessionid: string,
    scope: NetworkScope = NetworkScope.RESTRICTED,
  ) {
    const result = await this.jimengRequest(
      'post',
      '/mweb/v1/get_history_by_ids',
      sessionid,
      {
        data: { draft_ids: [taskId], type: 1, force_legacy: false },
        headers: { Referer: 'https://jimeng.jianying.com/ai-tool/image/generate' },
      },
      scope,
    );
    const data = this.checkResult(result);
    const histories: any[] = data?.histories || data?.data?.histories || [];
    const task = histories[0];
    if (!task) {
      return { status_code: 1, progress: 10 } as any;
    }
    const status = task.status;
    if (status === 3) {
      let images: string[] = [];
      try {
        const work = JSON.parse(task.workflow_json || '{}');
        const items = work?.data?.[0]?.work_list?.[0]?.origin?.[0]?.work?.[0]?.items || [];
        for (const it of items) {
          const u = it?.image?.image_url?.url || it?.image?.url;
          if (u) images.push(u);
        }
      } catch (e) {
        this.logger.warn(`[queryImageResult] 解析 workflow_json 失败: ${e}`);
      }
      return { status_code: 2, images, progress: 100 } as any;
    }
    if (status === 4) {
      return { status_code: 3, status_msg: task.fail_reason || '生成失败' } as any;
    }
    return { status_code: 1, progress: 30 } as any;
  }
}

export const JIMENG_CONSTANTS = {
  DEFAULT_ASSISTANT_ID,
  VERSION_CODE,
  PLATFORM_CODE,
  DRAFT_VERSION,
  WEB_VERSION,
  MIN_VERSION,
  JIMENG_BASE,
};
