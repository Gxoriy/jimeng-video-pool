import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EgressHttpService } from '../egress/egress-http.service';
import { AuthUser } from '../auth/auth.service';
import { encrypt, decrypt } from '../common/utils/encryption.util';
import { HedraClient } from '../pipeline/clients/hedra.client';

/**
 * 用户个人设置 —— 目前核心是 RunningHub API Key。
 *
 * 设计变更说明：
 *   P3 视频生成会消耗 R 币，新用户免费额度仅 100R，远不够用，
 *   因此**取消**原先「Bearer 拆分 + 随机选号」的共享 Key 池策略，
 *   改为每个用户在此填写自己的 RunningHub API Key，费用与额度各自独立。
 */
@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private http: EgressHttpService,
    private hedra: HedraClient,
  ) {}

  /** 读取当前用户设置（Key/cookie 只回掩码，不回明文） */
  async get(user: AuthUser) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        runninghubKeyEnc: true,
        runninghubKeyAt: true,
        hedraCookieEnc: true,
        hedraCookieAt: true,
      },
    });
    return {
      runninghubKeyConfigured: !!u?.runninghubKeyEnc,
      runninghubKeyMask: u?.runninghubKeyEnc ? this.mask(u.runninghubKeyEnc) : null,
      runninghubKeyAt: u?.runninghubKeyAt || null,
      hedraCookieConfigured: !!u?.hedraCookieEnc,
      hedraCookieMask: u?.hedraCookieEnc ? this.mask(u.hedraCookieEnc) : null,
      hedraCookieAt: u?.hedraCookieAt || null,
    };
  }

  /** 保存 / 更新自己的 RunningHub Key */
  async setRunninghubKey(user: AuthUser, apiKey: string) {
    const key = (apiKey || '').trim();
    if (!key) throw new BadRequestException('RunningHub API Key 不能为空');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { runninghubKeyEnc: encrypt(key), runninghubKeyAt: new Date() },
    });
    return this.get(user);
  }

  /** 清空自己的 Key */
  async clearRunninghubKey(user: AuthUser) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { runninghubKeyEnc: null, runninghubKeyAt: null },
    });
    return this.get(user);
  }

  /**
   * 内部使用：取出当前用户的 RunningHub 明文 Key。
   * 未配置时直接抛错，提示用户去「个人设置」填写——不做任何回退共享。
   */
  async requireRunninghubKey(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { runninghubKeyEnc: true },
    });
    if (!u?.runninghubKeyEnc) {
      throw new BadRequestException(
        '尚未配置个人 RunningHub API Key，请前往「个人设置」填写后再发起视频生成',
      );
    }
    try {
      return decrypt(u.runninghubKeyEnc);
    } catch {
      throw new BadRequestException('RunningHub API Key 解密失败，请重新填写');
    }
  }

  /** 校验 Key 是否有效（顺带回显账户 R 币余额，若接口支持） */
  async testRunninghubKey(user: AuthUser) {
    const key = await this.requireRunninghubKey(user.id);
    const base = this.config.get<string>('app.runninghubApiBase');
    const url = `${base}/api/openapi/v1/account/status`;
    try {
      const resp = await this.http.get(url, user.networkScope, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 15000,
      });
      const d = resp.data?.data ?? resp.data;
      return {
        ok: true,
        remainCoins: d?.remainCoins ?? d?.coins ?? null,
        raw: d,
      };
    } catch (e: any) {
      return { ok: false, message: e?.message || '校验失败' };
    }
  }

  private mask(enc: string): string {
    try {
      const raw = decrypt(enc);
      return raw.length <= 8 ? '****' : `${raw.slice(0, 4)}****${raw.slice(-4)}`;
    } catch {
      return '****';
    }
  }

  /** 保存个人 Hedra cookie（加密存储，数组/对象/header 均可） */
  async setHedraCookie(user: AuthUser, cookie: string) {
    const raw = (cookie || '').trim();
    if (!raw) throw new BadRequestException('Hedra cookie 不能为空');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { hedraCookieEnc: encrypt(raw), hedraCookieAt: new Date() },
    });
    return this.get(user);
  }

  /** 清空个人 Hedra cookie */
  async clearHedraCookie(user: AuthUser) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { hedraCookieEnc: null, hedraCookieAt: null },
    });
    return this.get(user);
  }

  /** 测试个人 Hedra cookie 是否可登录（验 profile 接口） */
  async testHedraCookie(user: AuthUser) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { hedraCookieEnc: true },
    });
    if (!u?.hedraCookieEnc) {
      return { ok: false, message: '尚未配置个人 Hedra cookie，请先到「个人设置」填写' };
    }
    let raw: string;
    try {
      raw = decrypt(u.hedraCookieEnc);
    } catch {
      return { ok: false, message: 'Hedra cookie 解密失败，请重新填写' };
    }
    try {
      const p = await this.hedra.profile(raw);
      return {
        ok: true,
        email: p.email,
        message: p.email ? `登录正常：${p.email}` : '登录正常',
      };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Hedra 登录校验失败' };
    }
  }
}
