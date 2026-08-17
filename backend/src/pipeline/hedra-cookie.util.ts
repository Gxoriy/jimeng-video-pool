import { PrismaService } from '../prisma/prisma.service';
import { decrypt } from '../common/utils/encryption.util';

/**
 * 解析用户个人设置的 Hedra cookie（解密后的原始 cookie 串）。
 * 返回 undefined 表示用户未配置，调用方应回退到全局 .env 的 HEDRA_COOKIE_PATH。
 *
 * 解密失败（如密钥轮换）时静默返回 undefined，不影响全局回退。
 */
export async function resolveUserHedraCookie(
  prisma: PrismaService,
  userId: string,
): Promise<string | undefined> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { hedraCookieEnc: true },
  });
  if (!u?.hedraCookieEnc) return undefined;
  try {
    return decrypt(u.hedraCookieEnc);
  } catch {
    return undefined;
  }
}
