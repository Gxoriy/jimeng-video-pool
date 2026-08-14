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
const DRAFT_VERSION = '3.3.4'; // native aigc_draft 接口的 version 字段（参考 jimeng-free-api）
const DRAFT_MIN_VERSION = '3.0.2'; // native aigc_draft 接口的 min_version 字段
const WEB_VERSION = '7.5.0';
const MIN_VERSION = '3.0.2';
const FILE_MAX_SIZE = 100 * 1024 * 1024;

// 即梦图片模型 -> 内部模型名（native aigc_draft 接口要求 root_model 用内部名）
// 注意：旧版模型名（high_aes_general_v21_L:general_v2.1_L 等带后缀形式）已被即梦下线，
// 调用一律返回 ret=1000 invalid parameter；当前可用内部名均为 high_aes_general_vXX 形式。
// 实测可用：v50(5.0)/v42(4.6)/v41(4.1)/v40(4.0)/v40l(4.5)；v30l/v30l_art_fangzhou(3.x) 已不可用。
const IMAGE_MODEL_MAP: Record<string, string> = {
  'jimeng-5.0': 'high_aes_general_v50',
  'jimeng-4.6': 'high_aes_general_v42',
  'jimeng-4.5': 'high_aes_general_v40l',
  'jimeng-4.1': 'high_aes_general_v41',
  'jimeng-4.0': 'high_aes_general_v40',
  // 兼容旧模型名（原 v21_L/v20_L 等已下线），统一映射到可用的 4.5 模型，保证老前端也能生成
  'jimeng-2.1': 'high_aes_general_v40l',
  'jimeng-2.0-pro': 'high_aes_general_v42',
  'jimeng-2.0': 'high_aes_general_v40l',
  'jimeng-1.4': 'high_aes_general_v40l',
  'jimeng-xl-pro': 'high_aes_general_v40l',
};

// 即梦视频模型 -> 内部模型名（native aigc_draft 接口要求 root_model 用内部名）
// 参考 jimeng-free-api-all（jefferychou2008）videos.ts。
const VIDEO_MODEL_MAP: Record<string, string> = {
  'jimeng-video-3.5-pro': 'dreamina_ic_generate_video_model_vgfm_3.5_pro',
  'jimeng-video-3.0-pro': 'dreamina_ic_generate_video_model_vgfm_3.0_pro',
  'jimeng-video-3.0': 'dreamina_ic_generate_video_model_vgfm_3.0',
  'jimeng-video-2.0': 'dreamina_ic_generate_video_model_vgfm_lite',
  'seedance-2.0-mini': 'dreamina_seedance_40_pro',
  'seedance-2.0': 'dreamina_seedance_40_pro',
  // seedance-1.0-pro 无公开内部名，退化为 3.0_pro（如不可用，前端请改用 seedance-2.0-mini）
  'seedance-1.0-pro': 'dreamina_ic_generate_video_model_vgfm_3.0_pro',
};

// 不同视频模型使用的 draft version（aigc_draft 接口的 version 字段）
const VIDEO_MODEL_DRAFT_VERSIONS: Record<string, string> = {
  'jimeng-video-3.5-pro': '3.3.4',
  'jimeng-video-3.0-pro': '3.2.8',
  'jimeng-video-3.0': '3.2.8',
  'jimeng-video-2.0': '3.2.8',
  'seedance-2.0-mini': '3.3.9',
  'seedance-2.0': '3.3.9',
  'seedance-1.0-pro': '3.2.8',
};

// 即梦图片分辨率/比例表（来自 jimeng-free-api 参考实现）
const IMAGE_RESOLUTION_OPTIONS: {
  [resolution: string]: { [ratio: string]: { width: number; height: number; ratio: number } };
} = {
  '1k': {
    '1:1': { width: 1024, height: 1024, ratio: 1 }, '4:3': { width: 768, height: 1024, ratio: 4 },
    '3:4': { width: 1024, height: 768, ratio: 2 }, '16:9': { width: 1024, height: 576, ratio: 3 },
    '9:16': { width: 576, height: 1024, ratio: 5 }, '3:2': { width: 1024, height: 682, ratio: 7 },
    '2:3': { width: 682, height: 1024, ratio: 6 }, '21:9': { width: 1195, height: 512, ratio: 8 },
  },
  '2k': {
    '1:1': { width: 2048, height: 2048, ratio: 1 }, '4:3': { width: 2304, height: 1728, ratio: 4 },
    '3:4': { width: 1728, height: 2304, ratio: 2 }, '16:9': { width: 2560, height: 1440, ratio: 3 },
    '9:16': { width: 1440, height: 2560, ratio: 5 }, '3:2': { width: 2496, height: 1664, ratio: 7 },
    '2:3': { width: 1664, height: 2496, ratio: 6 }, '21:9': { width: 3024, height: 1296, ratio: 8 },
  },
  '4k': {
    '1:1': { width: 4096, height: 4096, ratio: 101 }, '4:3': { width: 4608, height: 3456, ratio: 104 },
    '3:4': { width: 3456, height: 4608, ratio: 102 }, '16:9': { width: 5120, height: 2880, ratio: 103 },
    '9:16': { width: 2880, height: 5120, ratio: 105 }, '3:2': { width: 4992, height: 3328, ratio: 107 },
    '2:3': { width: 3328, height: 4992, ratio: 106 }, '21:9': { width: 6048, height: 2592, ratio: 108 },
  },
};

function resolveImageResolution(resolution: string, ratio: string): { width: number; height: number; imageRatio: number; resolutionType: string } {
  const group = IMAGE_RESOLUTION_OPTIONS[resolution] || IMAGE_RESOLUTION_OPTIONS['2k'];
  const cfg = group[ratio] || group['1:1'];
  return { width: cfg.width, height: cfg.height, imageRatio: cfg.ratio, resolutionType: resolution };
}

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
    this.logger.error(`[checkResult] 即梦返回非零 ret=${ret} errmsg=${errmsg} body=${JSON.stringify(data).slice(0, 1200)}`);
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
      model?: string; // 用户模型名：seedance-2.0-mini / jimeng-video-3.5-pro ...
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

    const userModel = opts.model || 'seedance-2.0-mini';
    const internalModel = VIDEO_MODEL_MAP[userModel] || userModel;
    const draftVersion = VIDEO_MODEL_DRAFT_VERSIONS[userModel] || '3.2.8';
    const [w, h] = (opts.ratio || '16:9').split(':').map(Number);
    const duration = opts.duration || 10;
    const resolution = opts.resolution || '720p';

    const componentId = uuidNoDash();
    const submitId = uuidNoDash();

    // 全能参考（参考图驱动）：附加到 core_param
    const refInfo =
      opts.referenceMode && (opts.referenceImages || []).length
        ? { reference_type: opts.referenceMode, reference_images: opts.referenceImages }
        : {};

    const coreParam: any = {
      type: '', id: uuidNoDash(),
      model: internalModel,
      prompt: opts.prompt,
      negative_prompt: '',
      seed: -1,
      video_duration: duration,
      resolution: resolution === '1080p' ? '1080p' : '720p',
      aspect_ratio: `${w}:${h}`,
      mode: 'general',
      first_frame_image: firstFrameImageUri ? { image_uri: firstFrameImageUri } : null,
      last_frame_image: endFrameImageUri ? { image_uri: endFrameImageUri } : null,
      manual_beautify: false,
      mp_mode: false,
      watermark: false,
      movie_gen: 0,
      ...refInfo,
    };

    const draftContent = {
      type: 'draft', id: uuidNoDash(), min_version: DRAFT_MIN_VERSION, min_features: [],
      is_from_tsn: true, version: draftVersion, main_component_id: componentId,
      component_list: [{
        type: 'video_base_component', id: componentId, min_version: DRAFT_MIN_VERSION, aigc_mode: 'workbench',
        metadata: { type: '', id: uuidNoDash(), created_platform: 3, created_platform_version: '', created_time_in_ms: Date.now().toString(), created_did: '' },
        generate_type: 'generate',
        abilities: {
          type: '', id: uuidNoDash(),
          generate: {
            type: '', id: uuidNoDash(),
            core_param: coreParam,
            gen_option: { type: '', id: uuidNoDash(), generate_all: false },
          },
        },
      }],
    };

    const payload: any = {
      extend: { root_model: internalModel },
      submit_id: submitId,
      metrics_extra: JSON.stringify({
        promptSource: 'custom', generateCount: 1, enterFrom: 'click',
        sceneOptions: JSON.stringify([{ type: 'video', scene: 'VideoAllFunction', modelReqKey: userModel, abilityList: [], reportParams: { enterSource: 'generate', vipSource: 'generate' } }]),
        generateId: submitId, isRegenerate: false,
      }),
      draft_content: JSON.stringify(draftContent),
      http_common_info: { aid: DEFAULT_ASSISTANT_ID },
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
    const taskId =
      data?.aigc_data?.history_record_id ||
      data?.history_record_id ||
      data?.task_id ||
      data?.id;
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
        data: { history_ids: [taskId], type: 2 },
        headers: { Referer: 'https://jimeng.jianying.com/ai-tool/video/generate' },
      },
      scope,
    );
    const data = this.checkResult(result);
    const entry: any = data?.[taskId] || (data?.data && data.data[taskId]);
    if (!entry) {
      return { status_code: 1, progress: 10 } as any;
    }
    const status = entry.status;
    const failCode = entry.fail_code;
    const item_list: any[] = entry.item_list || [];
    if (item_list.length > 0) {
      let videoUrl = '';
      let coverUrl = '';
      for (const it of item_list) {
        const v =
          it?.video?.large_images?.[0]?.video_url ||
          it?.video?.video_url ||
          it?.common_attr?.play_url;
        if (v) videoUrl = v;
        const c =
          it?.video?.large_images?.[0]?.cover_image_url ||
          it?.video?.cover_image_url ||
          it?.cover?.url ||
          it?.common_attr?.cover_url;
        if (c) coverUrl = c;
      }
      return { status_code: 2, video_url: videoUrl, cover_url: coverUrl, progress: 100 } as any;
    }
    if (status === 30) {
      return {
        status_code: 3,
        status_msg: failCode === '2038' ? '内容被安全策略过滤' : (entry.fail_reason || '生成失败'),
      } as any;
    }
    return { status_code: 1, progress: 30 } as any;
  }

  /**
   * 提交图片生成任务（native aigc_draft/generate，结构对齐 jimeng-free-api）。
   * @returns { task_id } 即梦返回的 history_record_id
   */
  async generateImage(
    sessionid: string,
    opts: {
      prompt: string;
      ratio?: string;
      model?: string; // 用户模型名：jimeng-5.0 / jimeng-4.6 / jimeng-4.5 / jimeng-4.1 / jimeng-4.0
      resolution?: string; // 1k | 2k | 4k
      imageUrl?: string; // 参考图（图生图），本地/外链 url，需 uploadFile 转 image_uri
    },
    scope: NetworkScope = NetworkScope.RESTRICTED,
  ): Promise<{ task_id: string }> {
    const userModel = opts.model || 'jimeng-5.0';
    const internalModel = IMAGE_MODEL_MAP[userModel] || userModel;
    const resolution = opts.resolution || '2k';
    const { width, height, imageRatio, resolutionType } = resolveImageResolution(resolution, opts.ratio || '1:1');

    let imageUri: string | undefined;
    if (opts.imageUrl) {
      try {
        imageUri = await this.uploadFile(sessionid, opts.imageUrl);
      } catch (e: any) {
        this.logger.warn(`[generateImage] 参考图上传失败: ${e?.message}`);
      }
    }
    const isBlend = !!imageUri;

    const componentId = uuidNoDash();
    const submitId = uuidNoDash();
    const sceneOption = {
      type: 'image',
      scene: isBlend ? 'ImageBasicGenerate' : 'ImageBasicGenerate',
      modelReqKey: userModel,
      resolutionType,
      abilityList: isBlend ? [{ abilityId: 'byte_edit', imageCount: 1, imageId: imageUri }] : [],
      reportParams: {
        enterSource: 'generate',
        vipSource: 'generate',
        extraVipFunctionKey: `${userModel}-${resolutionType}`,
        useVipFunctionDetailsReporterHoc: true,
      },
    };

    const coreParam: any = {
      type: '', id: uuidNoDash(),
      model: internalModel,
      prompt: isBlend ? `##${opts.prompt}` : opts.prompt,
      negative_prompt: '',
      seed: Math.floor(Math.random() * 100000000) + 2500000000,
      sample_strength: 0.5,
      image_ratio: imageRatio,
      large_image_info: { type: '', id: uuidNoDash(), min_version: DRAFT_MIN_VERSION, height, width, resolution_type: resolutionType },
      intelligent_ratio: false,
    };
    if (isBlend) {
      coreParam.ability_list = [{
        type: '', id: uuidNoDash(), name: 'byte_edit',
        image_uri_list: [imageUri],
        image_list: [{ type: 'image', id: uuidNoDash(), source_from: 'upload', platform_type: 1, name: '', image_uri: imageUri, width: 0, height: 0, format: '', uri: imageUri }],
        strength: 0.5,
      }];
      coreParam.prompt_placeholder_info_list = [{ type: '', id: uuidNoDash(), ability_index: 0 }];
      coreParam.postedit_param = { type: '', id: uuidNoDash(), generate_type: 0 };
    }

    const draftContent = {
      type: 'draft', id: uuidNoDash(), min_version: DRAFT_MIN_VERSION, min_features: [],
      is_from_tsn: true, version: DRAFT_VERSION, main_component_id: componentId,
      component_list: [{
        type: 'image_base_component', id: componentId, min_version: DRAFT_MIN_VERSION, aigc_mode: 'workbench',
        metadata: { type: '', id: uuidNoDash(), created_platform: 3, created_platform_version: '', created_time_in_ms: Date.now().toString(), created_did: '' },
        generate_type: isBlend ? 'blend' : 'generate',
        abilities: {
          type: '', id: uuidNoDash(),
          [isBlend ? 'blend' : 'generate']: {
            type: '', id: uuidNoDash(),
            core_param: coreParam,
            gen_option: { type: '', id: uuidNoDash(), generate_all: false },
          },
        },
      }],
    };

    const payload: any = {
      extend: { root_model: internalModel },
      submit_id: submitId,
      metrics_extra: JSON.stringify({
        promptSource: 'custom', generateCount: 1, enterFrom: 'click',
        sceneOptions: JSON.stringify([sceneOption]), generateId: submitId, isRegenerate: false,
      }),
      draft_content: JSON.stringify(draftContent),
      http_common_info: { aid: DEFAULT_ASSISTANT_ID },
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
    const taskId =
      data?.aigc_data?.history_record_id ||
      data?.history_record_id ||
      data?.task_id ||
      data?.id;
    if (!taskId) throw new Error('即梦未返回图片任务ID：' + JSON.stringify(data).slice(0, 200));
    return { task_id: taskId };
  }

  /** 轮询图片生成结果（响应结构：data[history_id] = { status, item_list, fail_code }） */
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
        data: {
          history_ids: [taskId],
          image_info: {
            width: 2048,
            height: 2048,
            format: 'webp',
            image_scene_list: [
              { scene: 'smart_crop', width: 360, height: 360, uniq_key: 'smart_crop-w:360-h:360', format: 'webp' },
              { scene: 'smart_crop', width: 480, height: 480, uniq_key: 'smart_crop-w:480-h:480', format: 'webp' },
              { scene: 'smart_crop', width: 720, height: 720, uniq_key: 'smart_crop-w:720-h:720', format: 'webp' },
              { scene: 'normal', width: 1080, height: 1080, uniq_key: '1080', format: 'webp' },
              { scene: 'normal', width: 720, height: 720, uniq_key: '720', format: 'webp' },
              { scene: 'normal', width: 480, height: 480, uniq_key: '480', format: 'webp' },
            ],
          },
        },
        headers: { Referer: 'https://jimeng.jianying.com/ai-tool/image/generate' },
      },
      scope,
    );
    const data = this.checkResult(result);
    const entry: any = data?.[taskId] || (data?.data && data.data[taskId]);
    if (!entry) {
      return { status_code: 1, progress: 10 } as any;
    }
    const status = entry.status;
    const failCode = entry.fail_code;
    const item_list: any[] = entry.item_list || [];
    if (item_list.length > 0) {
      const images: string[] = item_list
        .map((it: any) => it?.image?.large_images?.[0]?.image_url || it?.common_attr?.cover_url || null)
        .filter((u: string | null) => !!u);
      return { status_code: 2, images, progress: 100 } as any;
    }
    if (status === 30) {
      return {
        status_code: 3,
        status_msg: failCode === '2038' ? '内容被安全策略过滤' : (entry.fail_reason || '生成失败'),
      } as any;
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
