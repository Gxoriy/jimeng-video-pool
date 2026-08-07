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
const WEB_ID = Math.floor(Math.random() * 9_999_999_999_999_999_999 + 7_000_000_000_000_000_000).toString();

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
    `uid_tt=${uuidNoDash()}`,
    `uid_tt_ss=${uuidNoDash()}`,
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
   * 调用 /passport/account/info/v2 验证登录态，并捕获响应 Set-Cookie 中刷新的
   * sessionid / sid_tt / sid_guard（即「短效 cookie」），供后续生成使用。
   *
   * 说明：jimen2api-all-master 内并无独立「转换脚本」——其 generateCookie(refreshToken)
   * 仅用 sessionid 重建 Cookie、acquireToken 原样返回。这里的 refreshSession 就是在我们
   * 模块里补上的「长效 cookie → 网站接口 → 短效 cookie」兑换逻辑。
   */
  async refreshSession(
    sessionid: string,
    scope: NetworkScope = NetworkScope.RESTRICTED,
  ): Promise<{ alive: boolean; refreshed?: { sessionid?: string; sidTt?: string; sidGuard?: string } }> {
    try {
      const result = await this.jimengRequest(
        'post',
        '/passport/account/info/v2',
        sessionid,
        { params: { account_sdk_source: 'web' } },
        scope,
      );
      let alive = false;
      try {
        const data = this.checkResult(result);
        alive = !!data?.user_id;
      } catch {
        alive = false;
      }
      const refreshed = this.extractRefreshedCookies(result.headers);
      return { alive, refreshed };
    } catch {
      return { alive: false };
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
