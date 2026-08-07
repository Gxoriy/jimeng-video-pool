import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt } from '../common/utils/encryption.util';

/**
 * 概念 B 连接器：外部号池服务 `http://43.130.31.50:18813`（kieai2api 号池中转站）。
 *
 * 设计要点（务必与概念 A 区分）：
 *  - 默认 **关闭**。仅当环境变量 `EXTERNAL_POOL_BASE_URL` 配置且该连接器被显式调用时才参与。
 *  - 它是一个「独立号池 SERVICE」，aigen-panel 作为**客户端**去拉号；与本地导入（概念 A）平行，
 *    二者通过 `JimengAccount.source` 字段区分（local | external）。
 *  - 选号逻辑共用 `JimengAccountService.selectOne()`：external 账号同步进本地表后，自动进入选号池。
 *
 * ⚠️ 重要概念错配（实测探查结论，2026-08-07）：
 *  `:18813` 管理的是**上游 AI 提供方 API 账号**（含 refresh_token / ssid / kie_api_key / kie_site_token），
 *  **并非** jimeng.jianying.com 的 cookie `sessionid`。
 *  即梦调用核心（`jimeng-core.service.generateCookie`）需要真实即梦 cookie sessionid 才能登录。
 *  因此从 `:18813` 拉到的 bytedance/seedream/seedance 账号，其 token 字段（ssid/refresh_token/kie_api_key）
 *  **很可能无法通过即梦的会话存活校验**（`getTokenLiveStatus` → 标记 expired 并被选号过滤）。
 *  本连接器仍忠实实现「拉号→落库」的管线（默认关闭、按需同步），真实可用性由 `check` 机制自动判定；
 *  若要让外部号池真正贡献即梦生成，需 :18813 方提供「即梦 cookie sessionid」形态账号或另接其 API。
 */

interface RawPoolAccount {
  id?: string | number;
  email?: string;
  password?: string;
  ssid?: string;
  refresh_token?: string;
  raw_line?: string;
  kie_user_id?: string;
  kie_api_key?: string;
  kie_site_token?: string;
  provider?: string;
  credits?: number | string;
  status?: string;
  [k: string]: any;
}

@Injectable()
export class ExternalPoolClient {
  private readonly logger = new Logger(ExternalPoolClient.name);
  private readonly http: AxiosInstance;
  private token: string | null = null;
  private tokenAt = 0;
  private readonly tokenTtlMs = 30 * 60 * 1000;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const base = this.baseUrl;
    this.http = axios.create({
      baseURL: base,
      timeout: 20000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** 是否启用外部号池（配置了 BASE_URL 才启用） */
  get isEnabled(): boolean {
    return !!this.config.get<string>('app.externalPoolBaseUrl');
  }

  private get baseUrl(): string {
    return (this.config.get<string>('app.externalPoolBaseUrl') || '').replace(/\/$/, '');
  }

  private get username(): string {
    return this.config.get<string>('app.externalPoolUsername') || 'admin';
  }

  private get password(): string {
    return this.config.get<string>('app.externalPoolPassword') || 'Aa.17666521319';
  }

  /** 登录获取 JWT（带内存缓存） */
  private async login(): Promise<string> {
    if (this.token && Date.now() - this.tokenAt < this.tokenTtlMs) return this.token!;
    const resp = await this.http.post('/api/auth/login', {
      username: this.username,
      password: this.password,
    });
    const data = resp.data?.data ?? resp.data;
    const tk =
      data?.token || data?.access_token || data?.jwt || resp.data?.token || resp.data?.access_token;
    if (!tk) throw new Error('外部号池登录未返回 token');
    this.token = tk;
    this.tokenAt = Date.now();
    return tk;
  }

  /** 拉取账号列表（按 provider 过滤可选） */
  async fetchAccounts(provider?: string): Promise<RawPoolAccount[]> {
    const tk = await this.login();
    const resp = await this.http.get('/api/admin/accounts', {
      headers: { Authorization: `Bearer ${tk}` },
      params: provider ? { provider } : undefined,
    });
    const body = resp.data?.data ?? resp.data;
    const list: RawPoolAccount[] = Array.isArray(body) ? body : body?.accounts ?? body?.list ?? [];
    return list;
  }

  /** 判断账号是否属于即梦相关提供方（bytedance / seedream / seedance） */
  private isJimengRelevant(acc: RawPoolAccount): boolean {
    const p = (acc.provider || '').toLowerCase();
    return p.includes('bytedance') || p.includes('seedream') || p.includes('seedance');
  }

  /** 从账号对象中提取最可能是会话 token 的字段 */
  private pickToken(acc: RawPoolAccount): string {
    return acc.ssid || acc.refresh_token || acc.kie_api_key || acc.kie_site_token || '';
  }

  /**
   * 同步外部号池 -> 本地 JimengAccount（source='external'）。
   * 采用「先清空 external、再全量重建」的对账策略，简单且幂等。
   * 返回本次同步的账号数量。
   */
  async syncToLocal(): Promise<{ enabled: boolean; synced: number; note: string }> {
    if (!this.isEnabled) {
      return { enabled: false, synced: 0, note: '外部号池未启用（未配置 EXTERNAL_POOL_BASE_URL）' };
    }
    this.logger.log('开始同步外部号池 :18813 -> 本地 JimengAccount(source=external)');
    const all = await this.fetchAccounts();
    const relevant = all.filter((a) => this.isJimengRelevant(a) && this.pickToken(a));
    this.logger.log(`外部号池共 ${all.length} 个账号，其中即梦相关 ${relevant.length} 个`);

    // 对账：移除旧的 external 账号，重建
    await this.prisma.jimengAccount.deleteMany({ where: { source: 'external' } });

    let synced = 0;
    for (const acc of relevant) {
      const tokenVal = this.pickToken(acc);
      const provider = acc.provider || 'bytedance';
      const ident = acc.email || acc.kie_user_id || String(acc.id ?? synced);
      // 把 token 伪装成即梦 cookie map，供 generateCookie 重建 / selfHeal 兜底查值
      const cookieMap = JSON.stringify([
        { name: 'sessionid', value: tokenVal },
        { name: 'sid_tt', value: tokenVal },
        { name: 'sessionid_ss', value: tokenVal },
      ]);
      try {
        await this.prisma.jimengAccount.create({
          data: {
            label: `ext:${provider}:${ident}`,
            cookieEnc: encrypt(cookieMap),
            sessionid: encrypt(tokenVal),
            source: 'external',
            status: 'active',
            credits: Number(acc.credits) || 0,
          },
        });
        synced++;
      } catch (e: any) {
        this.logger.warn(`外部账号 ${ident} 入库失败: ${e?.message || e}`);
      }
    }
    return {
      enabled: true,
      synced,
      note: '已同步。注意：:18813 的 bytedance 账号为上游 API token，可能通不过即梦会话校验，check 后会自动标记 expired。',
    };
  }
}
