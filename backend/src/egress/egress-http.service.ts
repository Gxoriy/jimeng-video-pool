import { Injectable, BadRequestException } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { EgressService } from './egress.service';
import { NetworkScope } from '../common/roles.enum';

/** 瞬态网络错误（可重试） */
const TRANSIENT_ERRORS = ['socket hang up', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'];

/**
 * 可重试的 HTTP 状态码。第三方中转站（如 new.api.edu.gr）经常随机吐 502/504，
 * 重试一次往往就好；4xx 属于请求本身有问题，重试无意义。
 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

function isTransientError(err: any): boolean {
  const msg = err?.message || '';
  return TRANSIENT_ERRORS.some((t) => msg.includes(t));
}

function isRetryableStatus(err: any): boolean {
  const s = err?.response?.status;
  return typeof s === 'number' && RETRYABLE_STATUS.has(s);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 出站 HTTP 客户端 —— 所有打到外部 AI（AI 渠道 / RunningHub）的请求都必须经过本服务，
 * 由 EgressGuard 在发起前校验目标主机（SSRF 防护）。
 */
@Injectable()
export class EgressHttpService {
  constructor(private egress: EgressService) {}

  private async request(
    method: string,
    url: string,
    scope: NetworkScope,
    config: AxiosRequestConfig = {},
  ) {
    await this.egress.assertAllowed(url, scope);

    const maxRetries = 2;
    let lastErr: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = attempt * 2000;
          console.log(`[egress-http] 重试 ${attempt}/${maxRetries}（${delay}ms 后）: ${url}`);
          await sleep(delay);
        }
        return await axios.request({ method: method as any, url, ...config });
      } catch (err: any) {
        lastErr = err;
        if ((isTransientError(err) || isRetryableStatus(err)) && attempt < maxRetries) {
          console.log(
            `[egress-http] 可重试错误 (${err?.response?.status || err?.message})，准备重试...`,
          );
          continue;
        }
        const status = err?.response?.status;
        const raw = err?.response?.data;
        const msg =
          raw && typeof raw === 'object'
            ? JSON.stringify(raw).slice(0, 500)
            : typeof raw === 'string'
              ? raw.slice(0, 500)
              : err?.message;
        const ex = new BadRequestException(`外部调用失败 (${status || 'ERR'}): ${msg}`);
        // 把上游状态码挂到异常上，供调用方（如 AiChannelClient）判断是否值得再重试
        (ex as any).upstreamStatus = status;
        throw ex;
      }
    }

    const status = lastErr?.response?.status;
    const msg = lastErr?.message || '未知错误';
    throw new BadRequestException(`外部调用失败 (${status || 'ERR'}): ${msg}`);
  }

  get(url: string, scope: NetworkScope, config: AxiosRequestConfig = {}) {
    return this.request('GET', url, scope, config);
  }

  post(url: string, scope: NetworkScope, data?: any, config: AxiosRequestConfig = {}) {
    // 诊断日志：记录请求体大小，便于排查 413
    const bodySize = data ? JSON.stringify(data).length : 0;
    console.log(`[egress-http] POST ${url} | 请求体 ≈ ${Math.round(bodySize / 1024)}KB`);
    return this.request('POST', url, scope, { ...config, data });
  }
}
