import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Provider } from '../common/roles.enum';
import { AuthUser } from '../auth/auth.service';
import { tokenSplit, sampleToken } from '../common/utils/token-split.util';
import { encrypt, decrypt } from '../common/utils/encryption.util';

/**
 * Key 池服务 —— 复用 jimen2api 的「Bearer 拆分 + 随机选号」思路，并扩展为
 * 「系统 Key + 每用户 Key 池」。设计 §8。
 *
 * 选号优先级：
 *   1) 客户端请求自带 `Bearer k1,k2,k3`（tokenSplit 后的合并池）-> 优先
 *   2) 否则从「用户自有 Key ∪ 系统 Key」合并池随机选一个（_.sample 等价）
 */
@Injectable()
export class KeyPoolService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /** 系统级 Key（来自 .env 的逗号拆分存储形态） */
  getSystemKeys(provider: Provider): string[] {
    const key =
      provider === Provider.OPENAI
        ? this.config.get<string[]>('app.openaiApiKeys')
        : this.config.get<string[]>('app.runninghubApiKeys');
    return Array.isArray(key) ? key : [];
  }

  /**
   * 选出本次请求使用的 Key。完全复用 tokenSplit + sampleToken。
   * @param provider  openai | runninghub
   * @param user      当前用户（取其自有 Key 并解密）
   * @param reqBearer 请求头 Authorization（可能自带 k1,k2,k3 池）
   */
  async selectKey(
    provider: Provider,
    user: AuthUser,
    reqBearer?: string,
  ): Promise<string> {
    // 1) 客户端自带池优先（与 jimen2api 完全一致）
    const clientPool = tokenSplit(reqBearer);
    if (clientPool.length) return sampleToken(clientPool) as string;

    // 2) 合并池 = 用户自有 Key ∪ 系统 Key
    const pool: string[] = [...this.getSystemKeys(provider)];

    const userKeys = await this.prisma.apiKey.findMany({
      where: { provider, scope: 'user', ownerUserId: user.id },
    });
    for (const k of userKeys) pool.push(decrypt(k.keyEnc));

    const chosen = sampleToken(pool);
    if (!chosen) {
      throw new UnauthorizedException(
        `没有可用的 ${provider} Key（系统未配置且你未添加个人 Key）`,
      );
    }
    // 记录最后使用时间（best-effort）
    if (userKeys.length) {
      await this.prisma.apiKey
        .updateMany({
          where: { provider, scope: 'user', ownerUserId: user.id },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => undefined);
    }
    return chosen;
  }

  /** 用户添加自己的 Key（加密入库） */
  async addUserKey(user: AuthUser, provider: Provider, rawKey: string, label?: string) {
    return this.prisma.apiKey.create({
      data: {
        provider,
        scope: 'user',
        ownerUserId: user.id,
        keyEnc: encrypt(rawKey),
        label,
      },
      select: { id: true, provider: true, label: true, createdAt: true, scope: true },
    });
  }

  /** 列出当前用户的 Key（不返回明文，仅掩码） */
  async listUserKeys(user: AuthUser) {
    const rows = await this.prisma.apiKey.findMany({
      where: { scope: 'user', ownerUserId: user.id },
      select: {
        id: true,
        provider: true,
        label: true,
        scope: true,
        createdAt: true,
        lastUsedAt: true,
        keyEnc: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      masked: maskKey(decrypt(r.keyEnc)),
      keyEnc: undefined,
    }));
  }

  async deleteUserKey(user: AuthUser, id: string) {
    await this.prisma.apiKey.deleteMany({
      where: { id, scope: 'user', ownerUserId: user.id },
    });
    return { id };
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}
