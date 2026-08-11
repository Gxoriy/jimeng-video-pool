import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../common/utils/encryption.util';
import { JimengCoreService } from './jimeng-core.service';
import { NetworkScope } from '../common/roles.enum';
import { FileService } from '../file/file.service';

export interface ImportResult {
  id: string;
  label: string;
  source: string;
}

@Injectable()
export class JimengAccountService {
  private readonly logger = new Logger(JimengAccountService.name);
  /** 进程内选号并发锁（单实例有效；多实例建议接 redisUrl） */
  private busy = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: JimengCoreService,
    private readonly fileService: FileService,
  ) {}

  /** 从浏览器导出的 cookie 数组中提取 sessionid + 过期时间 */
  private parseCookie(raw: string): { sessionid: string; expireAt: Date | null; cookieJson: string } {
    let arr: any[];
    try {
      arr = JSON.parse(raw);
    } catch {
      throw new BadRequestException('cookie 不是合法 JSON 数组');
    }
    if (!Array.isArray(arr)) throw new BadRequestException('cookie 必须是数组');
    const find = (name: string) => arr.find((c) => c?.name === name)?.value;
    const sessionid = find('sessionid') || find('sid_tt') || find('sessionid_ss');
    if (!sessionid) throw new BadRequestException('cookie 中找不到 sessionid/sid_tt');
    const expStr = find('sessionid_expiration') || arr.find((c) => c?.name === 'sessionid')?.expirationDate;
    let expireAt: Date | null = null;
    if (expStr) {
      const n = typeof expStr === 'number' ? expStr : Number(expStr);
      if (!Number.isNaN(n)) {
        // browser cookie export 的 expirationDate 是秒级 Unix 时间戳；毫秒级则 >= 1e12
        expireAt = new Date(n < 1e12 ? n * 1000 : n);
      }
    }
    return { sessionid, expireAt, cookieJson: JSON.stringify(arr) };
  }

  /** 批量导入（支持多份 cookie 用换行/数组分隔） */
  async import(raw: string, source = 'local'): Promise<ImportResult[]> {
    // 支持 JSON 数组（多账号）或换行分隔的多段 JSON
    const items = this.splitCookies(raw);
    const results: ImportResult[] = [];
    for (const one of items) {
      const { sessionid, expireAt, cookieJson } = this.parseCookie(one);
      const created = await this.prisma.jimengAccount.create({
        data: {
          label: undefined,
          cookieEnc: encrypt(cookieJson),
          sessionid: encrypt(sessionid),
          expireAt,
          source,
          status: 'active',
        },
      });
      results.push({ id: created.id, label: created.label || '', source: created.source });
    }
    return results;
  }

  private splitCookies(raw: string): string[] {
    const trimmed = raw.trim();
    // 整段是 JSON 数组（可能是单个账号数组，或多个账号被包成二维数组）
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          // 每个元素是 cookie 对象 → 单个账号
          if (parsed.length && parsed[0] && typeof parsed[0] === 'object' && !Array.isArray(parsed[0])) {
            return [JSON.stringify(parsed)];
          }
          // 元素是字符串（每段 cookie JSON）或数组 → 多个账号
          if (parsed.every((p) => typeof p === 'string')) return parsed as string[];
        }
      } catch {
        /* fallback 按换行 */
      }
    }
    return trimmed.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  /** 管理员列表（脱敏：不回明文 token） */
  async list() {
    const rows = await this.prisma.jimengAccount.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => {
      const { sessionid, cookieEnc, ...rest } = r;
      let mask = '****';
      try {
        const raw = decrypt(sessionid);
        mask = raw.length <= 8 ? '****' : `${raw.slice(0, 4)}****${raw.slice(-4)}`;
      } catch {
        /* ignore */
      }
      return { ...rest, keyMask: mask };
    });
  }

  async update(id: string, dto: { label?: string; status?: string }) {
    const existing = await this.prisma.jimengAccount.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('账号不存在');
    return this.prisma.jimengAccount.update({ where: { id }, data: { ...(dto.label !== undefined ? { label: dto.label } : {}), ...(dto.status !== undefined ? { status: dto.status } : {}) } });
  }

  /** 获取账号完整信息（含解密后的 cookie JSON，用于编辑界面查看） */
  async getDetail(id: string) {
    const acc = await this.prisma.jimengAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账号不存在');
    let cookieJson: any = null;
    try {
      cookieJson = JSON.parse(decrypt(acc.cookieEnc));
    } catch {
      cookieJson = null;
    }
    return {
      ...acc,
      sessionid: decrypt(acc.sessionid),
      cookieJson,
    };
  }

  async remove(id: string) {
    const existing = await this.prisma.jimengAccount.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('账号不存在');
    await this.prisma.jimengAccount.delete({ where: { id } });
    return { id };
  }

  /** 查存活 + 积分，回写 status/credits（内部走 refresh 兑换短效 cookie） */
  async check(id: string, scope: NetworkScope) {
    return this.refresh(id, scope);
  }

  /**
   * 长效 cookie → 网站接口 → 短效 cookie 兑换 + 积分回写。
   * 调 /passport/account/info/v2 验证登录态并捕获刷新后的 sessionid，
   * 若返回值与当前 sessionid 不同，则把短效 cookie 写回 sessionid 与整份 cookie map。
   */
  async refresh(id: string, scope: NetworkScope): Promise<{ id: string; alive: boolean; refreshedSessionid?: string; credits: number; status: string; error?: string }> {
    const acc = await this.prisma.jimengAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账号不存在');
    const sessionid = decrypt(acc.sessionid);
    let lastError: string | undefined;
    const { alive, refreshed, error: refreshErr } = await this.core.refreshSession(sessionid, scope).catch((e) => {
      lastError = e?.message || String(e);
      return { alive: false, refreshed: undefined, error: lastError };
    });
    this.logger.warn(`[refresh] sessionid=${sessionid.slice(0, 12)}... -> raw alive=${alive}, refreshErr=${refreshErr || 'none'}`);
    if (refreshErr) lastError = refreshErr;

    let newSessionid = sessionid;
    let refreshedSessionid: string | undefined;
    if (alive && refreshed?.sessionid && refreshed.sessionid !== sessionid) {
      newSessionid = refreshed.sessionid;
      refreshedSessionid = newSessionid;
      // 把短效 cookie 写回整份 cookie map（sessionid/sessionid_ss/sid_tt），保持长效源可复用
      try {
        const cookieArr = JSON.parse(decrypt(acc.cookieEnc));
        for (const c of cookieArr) {
          if (!c || typeof c !== 'object') continue;
          if (c.name === 'sessionid' || c.name === 'sessionid_ss' || c.name === 'sid_tt') c.value = newSessionid;
          if (c.name === 'sid_guard' && refreshed.sidGuard) c.value = refreshed.sidGuard;
        }
        await this.prisma.jimengAccount.update({
          where: { id },
          data: { sessionid: encrypt(newSessionid), cookieEnc: encrypt(JSON.stringify(cookieArr)) },
        });
      } catch {
        // cookieEnc 损坏，仅更新 sessionid
        await this.prisma.jimengAccount.update({ where: { id }, data: { sessionid: encrypt(newSessionid) } });
      }
    }

    let credits = acc.credits;
    try {
      credits = (await this.core.getCredit(newSessionid, scope)).totalCredit;
    } catch {
      /* 积分查询失败不影响存活判定 */
    }
    const status = alive ? 'active' : 'expired';
    await this.prisma.jimengAccount.update({ where: { id }, data: { status, credits, lastCheckAt: new Date() } });
    return { id, alive, refreshedSessionid, credits, status, error: lastError };
  }

  /** 选号：从 active 且未过期账号中按积分加权随机选一个（带并发锁） */
  async selectOne(): Promise<{ id: string; sessionid: string }> {
    const now = new Date();
    const candidates = await this.prisma.jimengAccount.findMany({
      where: { status: 'active', OR: [{ expireAt: null }, { expireAt: { gt: now } }] },
    });
    const available = candidates.filter((c) => !this.busy.has(c.id));
    const pool = available.length ? available : candidates;
    if (!pool.length) throw new BadRequestException('当前没有可用的即梦账号（请先导入并查活）');

    // 按可用积分加权（credits - creditsUsed），积分<=0 时权重=1，避免饿死
    const weights = pool.map((c) => {
      const avail = c.credits - (c.creditsUsed || 0);
      return avail > 0 ? avail : 1;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) { idx = i; break; }
    }
    const chosen = pool[idx];
    this.busy.add(chosen.id);
    await this.prisma.jimengAccount.update({ where: { id: chosen.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return { id: chosen.id, sessionid: decrypt(chosen.sessionid) };
  }

  /** 释放选号锁 */
  release(id: string) {
    this.busy.delete(id);
  }

  /**
   * 登录失败自愈：长效 cookie 访问网站接口换取短效 cookie，返回刷新后的 sessionid（无则 null）。
   * 优先走 refresh 兑换；失败再从整份 cookie map 取真实 sessionid 兜底。
   */
  async selfHeal(id: string, scope: NetworkScope = NetworkScope.RESTRICTED): Promise<string | null> {
    const acc = await this.prisma.jimengAccount.findUnique({ where: { id } });
    if (!acc) return null;
    try {
      const { alive, refreshedSessionid } = await this.refresh(id, scope);
      if (refreshedSessionid) return refreshedSessionid;
      if (alive) return decrypt(acc.sessionid);
      return null;
    } catch {
      /* 兑换失败，走 cookie map 兜底 */
    }
    try {
      const cookieArr = JSON.parse(decrypt(acc.cookieEnc));
      const find = (name: string) => cookieArr.find((c: any) => c?.name === name)?.value;
      return find('sessionid') || find('sid_tt') || find('sessionid_ss') || null;
    } catch {
      return null;
    }
  }

  /** 获取账号摘要（含总积分） */
  async getSummary() {
    const [total, activeCount, creditResult] = await Promise.all([
      this.prisma.jimengAccount.count(),
      this.prisma.jimengAccount.count({ where: { status: 'active' } }),
      this.prisma.jimengAccount.aggregate({
        _sum: { credits: true },
        where: { status: 'active' },
      }),
    ]);
    
    return {
      totalAccounts: total,
      activeCount,
      totalCredits: creditResult._sum.credits || 0,
    };
  }

  /** 上传参考素材文件 */
  async uploadReferenceFile(file: Express.Multer.File, category: string) {
    // 使用 FileService 保存文件
    const savedFile = await this.fileService.saveFromBuffer(
      file.buffer,
      file.originalname,
      file.mimetype,
      category as any,
    );
    
    return {
      id: savedFile.id,
      url: savedFile.url,
      filename: savedFile.filename,
      category,
    };
  }
}
