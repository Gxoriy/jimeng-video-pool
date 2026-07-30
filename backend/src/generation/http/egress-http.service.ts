import { Injectable, BadRequestException, Global } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { EgressService } from '../../egress/egress.service';
import { NetworkScope } from '../../common/roles.enum';

/**
 * 出站 HTTP 客户端 —— 所有打到外部 AI 的请求都必须经过本服务，
 * 由 EgressGuard 在发起前校验目标主机（SSRF 防护，设计 §7）。
 */
@Injectable()
@Global()
export class EgressHttpService {
  constructor(private egress: EgressService) {}

  private async request(
    method: string,
    url: string,
    scope: NetworkScope,
    config: AxiosRequestConfig = {},
  ) {
    await this.egress.assertAllowed(url, scope);
    try {
      return await axios.request({ method: method as any, url, ...config });
    } catch (err: any) {
      const status = err?.response?.status;
      const msg =
        err?.response?.data && typeof err.response.data === 'object'
          ? JSON.stringify(err.response.data).slice(0, 500)
          : err?.message;
      throw new BadRequestException(`外部 AI 调用失败 (${status || 'ERR'}): ${msg}`);
    }
  }

  get(url: string, scope: NetworkScope, config: AxiosRequestConfig = {}) {
    return this.request('GET', url, scope, config);
  }

  post(url: string, scope: NetworkScope, data?: any, config: AxiosRequestConfig = {}) {
    return this.request('POST', url, scope, { ...config, data });
  }
}
