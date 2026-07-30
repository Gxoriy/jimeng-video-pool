import { registerAs } from '@nestjs/config';

/**
 * 集中读取业务配置（设计 §11）。所有密钥来自 .env，不入库。
 */
export default registerAs('app', () => ({
  host: process.env.HOST || '127.0.0.1',
  port: parseInt(process.env.PORT || '8000', 10),

  jwtSecret: process.env.JWT_SECRET || 'change-me-to-a-long-random-string',
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  sessionSecret: process.env.SESSION_SECRET || 'change-me-session-secret',

  // 系统级 Key 池（逗号拆分 = Bearer 拆分的存储形态）
  openaiApiKeys: parseCsv(process.env.OPENAI_API_KEYS),
  runninghubApiKeys: parseCsv(process.env.RUNNINGHUB_API_KEYS),

  // EgressGuard 白名单（支持 *. 通配）
  allowedEgressHosts: parseCsv(process.env.ALLOWED_EGRESS_HOSTS),
  blockedEgressHosts: parseCsv(process.env.BLOCKED_EGRESS_HOSTS),

  storagePath: process.env.STORAGE_PATH || './data/media',

  runninghubApiBase:
    process.env.RUNNINGHUB_API_BASE || 'https://www.runninghub.cn',
  runninghubWorkflowId:
    process.env.RUNNINGHUB_WORKFLOW_ID || '2031016553440878594',

  redisUrl: process.env.REDIS_URL || undefined,
}));

/** 复用 jimen2api 的逗号切分思路 */
export function parseCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
