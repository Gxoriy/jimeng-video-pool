import * as _ from 'lodash';

/**
 * 【复用 jimen2api】Bearer 拆分（src/api/controllers/core.ts:824 tokenSplit）
 *
 * 原始实现：
 *   authorization.replace(/^Bearer\s+/i, "").split(",").map(t => t.trim()).filter(Boolean)
 *
 * 这里保持完全相同的拆分逻辑：去掉 Bearer 前缀 -> 按逗号切分 -> 去空白 -> 过滤空串。
 * 客户端可直接传 `Bearer k1,k2,k3`，与 jimen2api 完全一致。
 */
export function tokenSplit(authorization?: string): string[] {
  if (!authorization) return [];
  return authorization
    .replace(/^Bearer\s+/i, '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * 【复用 jimen2api】等概率随机选号（src/api/routes/images.ts:32 _.sample(tokens)）
 *
 * 原始实现： const token = _.sample(tokens);
 * 这里保持等价：从合并后的 Key 池中随机选一个作为本次上游调用凭证，
 * 实现负载均衡 / 配额分摊。
 */
export function sampleToken(pool: string[]): string | undefined {
  if (!pool || pool.length === 0) return undefined;
  return _.sample(pool);
}
