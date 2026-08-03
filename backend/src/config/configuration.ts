import { registerAs } from '@nestjs/config';

/**
 * 集中读取业务配置。所有密钥来自 .env 或数据库（加密），不硬编码。
 *
 * 注意：不再有「系统级 Key 池 / 随机选号」。
 *  - P1 生成形象 / P2 获取灵感：使用超级管理员在后台配置的 AI 渠道（ai_channels 表）
 *  - P3 视频生成：使用每个用户自己填写的 RunningHub API Key（users.runninghub_key_enc）
 */
export default registerAs('app', () => ({
  host: process.env.HOST || '127.0.0.1',
  port: parseInt(process.env.PORT || '8000', 10),

  jwtSecret: process.env.JWT_SECRET || 'change-me-to-a-long-random-string',
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '24h',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || '30d',
  sessionSecret: process.env.SESSION_SECRET || 'change-me-session-secret',

  // EgressGuard 白名单（支持 *. 通配）
  allowedEgressHosts: parseCsv(process.env.ALLOWED_EGRESS_HOSTS),
  blockedEgressHosts: parseCsv(process.env.BLOCKED_EGRESS_HOSTS),

  storagePath: process.env.STORAGE_PATH || './data/media',
  uploadPath: process.env.UPLOAD_PATH || './data/uploads',
  /** 生成 upload url 时使用的对外基址，留空则用相对路径 /api/files */
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',

  runninghubApiBase:
    process.env.RUNNINGHUB_API_BASE || 'https://www.runninghub.cn',

  /**
   * 歌曲库批量导入 ·「歌名-作者」自动下载所用的音乐聚合 API。
   * 参考 suno_auto_production-master 的 music_sources（kuwo_api 默认主源）。
   * 该域名在 song-import 模块内以「服务端受信下载」方式走 BROAD 出站（仍受 DNS 内网拦截保护）。
   */
  musicSourceBase:
    process.env.MUSIC_SOURCE_BASE || 'https://kw-api.cenguigui.cn',
  /** ffprobe 可执行文件路径（读取上传音频时长）；留空则用 PATH 中的 ffprobe */
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  /**
   * ffmpeg 可执行文件路径（参考图降采样，避免内联 base64 过大触发网关 413）。
   * 留空则自动使用内置的 ffmpeg-static 二进制，无需系统安装 ffmpeg。
   */
  ffmpegPath: process.env.FFMPEG_PATH || '',
  /**
   * 参考图内联 base64 的目标体积上限（KB，默认 60）。
   * 若上游网关仍返回 413（request body too large），把它调小（如 40 / 30）即可。
   */
  maxInlineImageKB: parseInt(process.env.MAX_INLINE_IMAGE_KB || '60', 10),
  /** P3 数字人对口型工作流（用户给定） */
  runninghubWorkflowId:
    process.env.RUNNINGHUB_WORKFLOW_ID || '2031016553440878594',
  /**
   * P3 工作流「表单字段 -> ComfyUI 节点」映射。
   * RunningHub 的 nodeInfoList 需要精确的 nodeId/fieldName。
   *
   * 下方 DEFAULT_NODE_MAP 已按官方文档给定工作流 2031016553440878594
   * 的节点编号预置；若你的工作流节点编号不同，用 .env 的
   * RUNNINGHUB_NODE_MAP 覆盖即可（同名键会覆盖默认值）。
   * 未配置的字段会被跳过（走工作流默认值），并在任务日志中告警。
   */
  runninghubNodeMap: { ...DEFAULT_NODE_MAP, ...parseNodeMap(process.env.RUNNINGHUB_NODE_MAP) },

  redisUrl: process.env.REDIS_URL || undefined,
}));

export interface NodeMapEntry {
  nodeId: string;
  fieldName: string;
}

/** P3 表单字段清单（与前端一一对应）。
 *  注意：官方工作流 2031016553440878594 仅提供「音频起始秒」单个对口型偏移，
 *  没有独立的「结束秒」节点，故这里不列 audioEndSeconds；
 *  若所用工作流确有结束秒节点，可用 RUNNINGHUB_NODE_MAP + nodeOverrides 传入。 */
export const RUNNINGHUB_FIELDS = [
  'image',
  'audio',
  'durationSeconds',
  'audioStartSeconds',
  'actionPrompt',
  'maxResolution',
  'fps',
] as const;

export type RunningHubField = (typeof RUNNINGHUB_FIELDS)[number];

/** 默认字段名（沿用 ComfyUI 常见命名），nodeId 必须由部署方按实际工作流填写 */
const DEFAULT_FIELD_NAMES: Record<RunningHubField, string> = {
  image: 'image',
  audio: 'audio',
  durationSeconds: 'value',
  audioStartSeconds: 'value',
  actionPrompt: 'text',
  maxResolution: 'value',
  fps: 'value',
};

/**
 * 工作流 2031016553440878594 的官方节点映射（来自 RunningHub API 文档示例）。
 * 仅在 .env 未提供 RUNNINGHUB_NODE_MAP 时生效；同名键可被 .env 覆盖。
 * 注意：该工作流只有「音频起始秒」(audioStartSeconds) 单个对口型偏移输入，
 * 没有独立的「结束秒」节点，故 audioEndSeconds 不在此默认映射中。
 */
export const DEFAULT_NODE_MAP: Partial<Record<RunningHubField, NodeMapEntry>> = {
  image: { nodeId: '444', fieldName: 'image' },
  audio: { nodeId: '1755', fieldName: 'audio' },
  durationSeconds: { nodeId: '1583', fieldName: 'value' },
  audioStartSeconds: { nodeId: '1776', fieldName: 'value' },
  actionPrompt: { nodeId: '1624', fieldName: 'value' },
  maxResolution: { nodeId: '1606', fieldName: 'value' },
  fps: { nodeId: '1586', fieldName: 'value' },
};

export function parseNodeMap(raw?: string): Partial<Record<RunningHubField, NodeMapEntry>> {
  const out: Partial<Record<RunningHubField, NodeMapEntry>> = {};
  if (!raw) return out;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  for (const key of RUNNINGHUB_FIELDS) {
    const v = parsed?.[key];
    if (!v) continue;
    // 支持两种写法： "12:image"  或  {nodeId:"12", fieldName:"image"}
    if (typeof v === 'string') {
      const [nodeId, fieldName] = v.split(':');
      if (nodeId) out[key] = { nodeId, fieldName: fieldName || DEFAULT_FIELD_NAMES[key] };
    } else if (v.nodeId) {
      out[key] = {
        nodeId: String(v.nodeId),
        fieldName: String(v.fieldName || DEFAULT_FIELD_NAMES[key]),
      };
    }
  }
  return out;
}

export function parseCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
