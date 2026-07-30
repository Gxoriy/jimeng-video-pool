import * as crypto from 'crypto';

/**
 * 应用层 AES-256-GCM 加解密（设计 §12：凭据加密存储，密钥不入 .env 明文）。
 * 加密密钥来自 KEY_ENCRYPT_SECRET，缺失时回退 SESSION_SECRET（仅开发态）。
 */
function getKey(): Buffer {
  const secret =
    process.env.KEY_ENCRYPT_SECRET ||
    process.env.SESSION_SECRET ||
    'change-me-session-secret';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // 格式：iv.tag.cipher (均 base64)
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    enc.toString('base64'),
  ].join('.');
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) return payload; // 兼容未加密遗留值
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}
