import { Injectable, Logger, OnModuleDestroy, OnModuleInit, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { JimengCoreService } from './jimeng-core.service';
import { JimengAccountService } from './jimeng-account.service';
import { decrypt } from '../common/utils/encryption.util';
import { NetworkScope } from '../common/roles.enum';

/**
 * Phase 2 · 即梦每日签到养号。
 *
 * 即梦每天可通过 /commerce/v1/benefits/credit_receive 免费领取一轮积分。
 * 本服务按固定间隔（默认 30 分钟）扫描号池，对「今天还没签到」的 active 账号
 * 自动领取并回写 credits / lastCheckinAt；领取前若登录态失效，先走
 * 长效 cookie → 网站接口 → 短效 cookie 兑换（selfHeal）。
 *
 * 签到领到的积分直接抬高账号在 selectOne() 里的加权权重，
 * 与 jimeng_tasks.creditsUsed（每次任务消耗）共同构成养号闭环。
 */
@Injectable()
export class JimengCheckinService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JimengCheckinService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: JimengCoreService,
    private readonly accounts: JimengAccountService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (!this.config.get<boolean>('app.jimengCheckinEnabled')) {
      this.logger.log('每日签到养号已禁用（JIMENG_CHECKIN_ENABLED=false）');
      return;
    }
    const interval = this.config.get<number>('app.jimengCheckinIntervalMs') || 1800000;
    // 启动 60 秒后先跑一轮，之后按间隔循环
    this.timer = setTimeout(() => {
      this.tick();
      this.timer = setInterval(() => this.tick(), interval);
    }, 60000) as any;
    this.logger.log(`每日签到养号已启动，扫描间隔 ${Math.round(interval / 60000)} 分钟`);
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer as any);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.checkinAll(NetworkScope.BROAD);
      if (result.checkedIn > 0 || result.failed > 0) {
        this.logger.log(
          `签到扫描完成：签到 ${result.checkedIn}，跳过 ${result.skipped}，失败 ${result.failed}`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`签到扫描异常：${e?.message}`);
    } finally {
      this.running = false;
    }
  }

  /** 今天（Asia/Shanghai）是否已签到 */
  private checkedToday(lastCheckinAt: Date | null): boolean {
    if (!lastCheckinAt) return false;
    const fmt = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(lastCheckinAt) === fmt.format(new Date());
  }

  /** 计算连续签到天数：上次签到是昨天则 +1，否则重置为 1 */
  private calcStreak(lastCheckinAt: Date | null, prevStreak: number): number {
    if (!lastCheckinAt) return 1;
    const fmt = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const lastDate = fmt.format(lastCheckinAt);
    const yesterdayStr = fmt.format(yesterday);
    const todayStr = fmt.format(new Date());
    // 如果今天已签过（重复调用），保持原 streak
    if (lastDate === todayStr) return prevStreak || 1;
    // 如果上次签到是昨天，streak +1
    if (lastDate === yesterdayStr) return (prevStreak || 0) + 1;
    // 否则重置
    return 1;
  }

  /** 单个账号签到：领积分 → 查积分回写。返回明细供管理接口展示 */
  async checkinOne(id: string, scope: NetworkScope) {
    const acc = await this.prisma.jimengAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('账号不存在');
    if (acc.status !== 'active') {
      return { id, ok: false, reason: `账号状态为 ${acc.status}，不可签到` };
    }
    if (this.checkedToday(acc.lastCheckinAt)) {
      return { id, ok: true, skipped: true, reason: '今日已签到', credits: acc.credits };
    }

    let sessionid = decrypt(acc.sessionid);
    try {
      await this.core.receiveCredit(sessionid, scope);
    } catch (e: any) {
      // 登录态失效：先尝试长效 cookie 兑换短效 cookie 再领一次
      const healed = await this.accounts.selfHeal(id, scope);
      if (!healed) {
        await this.prisma.jimengAccount.update({ where: { id }, data: { status: 'expired' } }).catch(() => {});
        return { id, ok: false, reason: `登录失效且自愈失败：${e?.message}` };
      }
      sessionid = healed;
      try {
        await this.core.receiveCredit(sessionid, scope);
      } catch (e2: any) {
        return { id, ok: false, reason: `签到领取失败：${e2?.message}` };
      }
    }

    let credits = acc.credits;
    try {
      credits = (await this.core.getCredit(sessionid, scope)).totalCredit;
    } catch {
      /* 领取成功但查积分失败，不阻断 */
    }
    // 计算连续签到天数：如果上次签到是昨天，streak+1；否则重置为 1
    const streak = this.calcStreak(acc.lastCheckinAt, acc.checkinStreak || 0);
    await this.prisma.jimengAccount.update({
      where: { id },
      data: { credits, lastCheckinAt: new Date(), checkinStreak: streak, status: 'active' },
    });
    return { id, ok: true, credits, checkinStreak: streak };
  }

  /** 全量签到：所有 active 且今日未签到的账号 */
  async checkinAll(scope: NetworkScope) {
    const rows = await this.prisma.jimengAccount.findMany({ where: { status: 'active' } });
    const result = { total: rows.length, checkedIn: 0, skipped: 0, failed: 0, items: [] as any[] };
    for (const acc of rows) {
      if (this.checkedToday(acc.lastCheckinAt)) {
        result.skipped++;
        continue;
      }
      const r = await this.checkinOne(acc.id, scope);
      if (r.ok) result.checkedIn++;
      else result.failed++;
      result.items.push(r);
    }
    return result;
  }
}
