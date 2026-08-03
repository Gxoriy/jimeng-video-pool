import { Injectable, ForbiddenException } from '@nestjs/common';
import * as dns from 'dns/promises';
import { ConfigService } from '@nestjs/config';
import { NetworkScope } from '../common/roles.enum';

/**
 * EgressGuard —— 出站请求前的 SSRF 防护（设计 §7 / 需求 #12）。
 *
 * 规则：
 *   1) 解析目标主机 DNS，拒绝 RFC1918 / 回环 / 链路本地等内网地址。
 *   2) restricted 角色（普通用户）仅允许命中 ALLOWED_EGRESS_HOSTS 白名单
 *      （支持 *. 通配，如 *.runninghub.cn）。
 *   3) broad 角色（super_admin）仍需经 Nginx 层管控，但应用层放通。
 */
@Injectable()
export class EgressService {
  private allowedHosts: string[] = [];

  constructor(private config: ConfigService) {
    this.allowedHosts =
      this.config.get<string[]>('app.allowedEgressHosts') || [];
  }

  /** 判断是否为内网/保留地址 */
  private isPrivateIp(ip: string): boolean {
    // IPv4
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      const parts = ip.split('.').map(Number);
      if (parts[0] === 10) return true;
      if (parts[0] === 127) return true;
      if (parts[0] === 0) return true;
      if (parts[0] === 169 && parts[1] === 254) return true; // 链路本地
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT
      if (parts[0] >= 224) return true; // 组播/保留
      return false;
    }
    // IPv6
    if (ip === '::1' || ip.startsWith('fe80') || ip.startsWith('fc') || ip.startsWith('fd')) {
      return true;
    }
    return false;
  }

  private hostMatches(host: string, pattern: string): boolean {
    const h = host.toLowerCase();
    const p = pattern.toLowerCase().trim();
    if (p.startsWith('*.')) {
      const base = p.slice(2);
      return h === base || h.endsWith('.' + base);
    }
    return h === p;
  }

  /**
   * 校验某个目标 URL 是否允许当前角色访问。不通过直接抛 403。
   */
  async assertAllowed(targetUrl: string, scope: NetworkScope): Promise<void> {
    let url: URL;
    try {
      url = new URL(targetUrl);
    } catch {
      throw new ForbiddenException('非法的目标 URL');
    }
    const host = url.hostname;

    // 解析所有 A/AAAA 记录，任一为内网即拒绝（防 DNS rebinding）
    let addresses: string[] = [];
    try {
      const records = await dns.lookup(host, { all: true });
      addresses = records.map((r) => r.address);
    } catch {
      // 解析失败也拒绝，避免盲打内网
      throw new ForbiddenException(`无法解析目标主机: ${host}`);
    }

    if (addresses.some((ip) => this.isPrivateIp(ip))) {
      throw new ForbiddenException(`禁止访问内网地址: ${host}`);
    }

    if (scope === NetworkScope.BROAD) return; // 超级管理员放通（仍由 Nginx 管控）

    const allowed = this.allowedHosts.some((pattern) =>
      this.hostMatches(host, pattern),
    );
    if (!allowed) {
      throw new ForbiddenException(
        `当前角色禁止访问该主机: ${host}（不在出站白名单）`,
      );
    }
  }
}
