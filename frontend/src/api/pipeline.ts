import { api } from './client';

/* ---------------- 类型 ---------------- */

export type Stage = 'character' | 'inspiration';

export interface Channel {
  id: string;
  name: string;
  model?: string;
  protocol: string;
  usableFor: string;
  supportsImage: boolean;
  supportsVision: boolean;
  remark?: string;
}

export interface UploadItem {
  id: string;
  kind: 'image' | 'audio';
  filename: string;
  url: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

export interface CharacterImage {
  id: string;
  url: string;
  localPath?: string | null;
  prompt?: string;
  model?: string;
  style?: string;
  createdAt: string;
}

export interface Character {
  id: string;
  name: string;
  coverUrl?: string;
  category?: string;
  tags: string[];
  description?: string;
  images?: CharacterImage[];
}

export interface Song {
  id: string;
  title: string;
  artist?: string;
  url?: string;
  localPath?: string;
  duration?: number;
  category?: string;
  tags: string[];
  lyrics?: string;
  coverUrl?: string;
  /** 入库状态：pending_review=待审核；active=已归档 */
  status?: 'pending_review' | 'active';
  createdAt?: string;
}

export interface Prompt {
  id: string;
  title: string;
  content: string;
  type: 'character' | 'action';
  category?: string;
  tags: string[];
}

export interface TaskDetail {
  id: string;
  type: 'character' | 'inspiration' | 'video';
  status: 'pending' | 'running' | 'success' | 'failed';
  prompt?: string;
  resultUrls?: string[];
  resultText?: string;
  /** 结构化结果（获取灵感/工作区产出的 {characterPrompt, actionPrompt, promptSource}） */
  resultData?: { characterPrompt?: string; actionPrompt?: string; promptSource?: string } | null;
  errorMessage?: string;
  createdAt: string;
  finishedAt?: string;
  /** 工作区任务阶段：prompt_expansion / video_generation */
  params?: { stage?: string; [k: string]: any };
  media?: { url: string; type: string }[];
}

/* ---------------- 通用取数 ---------------- */

const unwrap = (r: any) => r.data?.data;

/** 普通用户可选的 AI 渠道（不含任何密钥信息） */
export const listChannels = (stage: Stage) =>
  api.get('/pipeline/channels', { params: { stage } }).then(unwrap) as Promise<Channel[]>;

export const listCharacters = (q?: string) =>
  api
    .get('/libraries/characters', { params: { page: 1, pageSize: 200, q } })
    .then((r) => unwrap(r).data as Character[]);

export const listSongs = (q?: string, status?: 'pending_review' | 'active') =>
  api
    .get('/libraries/songs', {
      params: { page: 1, pageSize: 200, q, status: status || undefined },
    })
    .then((r) => unwrap(r).data as Song[]);

/** 歌曲库分页（支持 status 过滤），用于歌曲库页面 */
export const listSongsPage = (params: {
  q?: string;
  status?: 'pending_review' | 'active';
  page?: number;
  pageSize?: number;
}) =>
  api
    .get('/libraries/songs', { params: { page: 1, pageSize: 20, ...params } })
    .then(unwrap) as Promise<{ data: Song[]; total: number }>;

export const getSong = (id: string) =>
  api.get(`/libraries/songs/${id}`).then(unwrap) as Promise<Song>;

export const updateSong = (id: string, payload: Partial<Song>) =>
  api.put(`/libraries/songs/${id}`, payload).then(unwrap);

export const deleteSong = (id: string) =>
  api.delete(`/libraries/songs/${id}`).then(unwrap);

/** 人工审核通过后归档入库（status: pending_review -> active） */
export const archiveSong = (id: string) =>
  api.post(`/libraries/songs/${id}/archive`, {}).then(unwrap);

/* ---------------- 形象库 ---------------- */

export const listCharactersPage = (params: {
  q?: string;
  status?: 'pending_review' | 'active';
  page?: number;
  pageSize?: number;
}) =>
  api
    .get('/libraries/characters', { params: { page: 1, pageSize: 20, ...params } })
    .then(unwrap) as Promise<{ data: Character[]; total: number }>;

/** 人工审核通过后归档入库（status: pending_review -> active） */
export const archiveCharacter = (id: string) =>
  api.post(`/libraries/characters/${id}/archive`, {}).then(unwrap);

/** 删除形象（同步删除其下所有风格图） */
export const deleteCharacter = (id: string) =>
  api.delete(`/libraries/characters/${id}`).then(unwrap);

/** 获取单个形象的完整信息（含全部多张风格图） */
export const getCharacter = (id: string) =>
  api.get(`/libraries/characters/${id}`).then(unwrap) as Promise<Character>;

/** 人工编辑形象信息：改名 / 分类 / 贴标签 / 描述 */
export const updateCharacter = (id: string, payload: { name?: string; category?: string; tags?: string[]; description?: string }) =>
  api.put(`/libraries/characters/${id}`, payload).then(unwrap) as Promise<Character>;

/** 向已有形象追加多张不同风格/背景的图 */
export const appendCharacterImages = (id: string, payload: { urls?: string[]; uploadIds?: string[]; style?: string; prompt?: string }) =>
  api.post(`/libraries/characters/${id}/images`, payload).then(unwrap);

/** 删除形象下某张图 */
export const deleteCharacterImage = (id: string, imageId: string) =>
  api.delete(`/libraries/characters/${id}/images/${imageId}`).then(unwrap);

/** 修改某张图的风格/提示词/URL */
export const patchCharacterImage = (id: string, imageId: string, payload: { style?: string; prompt?: string; url?: string }) =>
  api.patch(`/libraries/characters/${id}/images/${imageId}`, payload).then(unwrap);

/** 调用 AI 对指定提示词智能分类（返回 {category, tags}） */
export const classifyPrompt = (id: string) =>
  api.post(`/libraries/prompts/${id}/classify`, {}).then(unwrap) as Promise<{
    category?: string;
    tags: string[];
  }>;

/* ---------------- 歌曲批量导入 ---------------- */

export interface SongImportItemResult {
  id: string;
  title: string;
  artist?: string;
  status: 'pending_review' | 'active';
  skipped: boolean;
  source: 'text' | 'upload';
  coverUrl?: string;
  duration?: number;
  category?: string;
  tags?: string[];
  language?: string;
  description?: string;
  lyrics?: string;
  /** 本条是否真正走了 AI 识别（false=降级为原始信息 + 待分类） */
  aiUsed?: boolean;
  error?: string;
}

export interface SongImportResult {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  items: SongImportItemResult[];
}

/** 方式一：「歌名-作者」文本自动下载 + AI 识别（enableAi=false 时跳过 AI 直接入库） */
export const importSongsFromText = (text: string, overwrite = false, enableAi = true) =>
  api
    .post('/song-import/from-text', { text, overwrite, enableAi })
    .then(unwrap) as Promise<SongImportResult>;

/** 方式二：本地上传音频文件已拿到 uploadId，提交做 AI 识别（enableAi=false 时跳过 AI 直接入库） */
export const importSongsFromUpload = (uploadIds: string[], overwrite = false, enableAi = true) =>
  api
    .post('/song-import/from-upload', { uploadIds, overwrite, enableAi })
    .then(unwrap) as Promise<SongImportResult>;

/** 对已入库歌曲重新执行 AI 识别 */
export const reclassifySong = (id: string) =>
  api
    .post(`/song-import/reclassify/${id}`)
    .then(unwrap) as Promise<{
      id: string;
      title: string;
      artist?: string;
      category?: string;
      tags: string[];
      language?: string;
      description?: string;
    }>;

/* ---------------- 形象批量导入 ---------------- */

export interface CharacterImportItemResult {
  id: string;
  name: string;
  status: 'pending_review' | 'active';
  skipped: boolean;
  coverUrl?: string;
  category?: string;
  tags?: string[];
  description?: string;
  /** 本条是否真正走了 AI 视觉识别（false=降级为文件名猜测） */
  aiUsed?: boolean;
  error?: string;
}

export interface CharacterImportResult {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  items: CharacterImportItemResult[];
}

/** 本地上传图片(已拿到 uploadId) → 视觉 AI 识别并进入待审核（enableAi=false 时跳过 AI 直接入库） */
export const importCharactersFromUpload = (uploadIds: string[], overwrite = false, enableAi = true) =>
  api
    .post('/character-import/from-upload', { uploadIds, overwrite, enableAi })
    .then(unwrap) as Promise<CharacterImportResult>;

export const listPrompts = (type: 'character' | 'action', tag?: string) =>
  api
    .get('/libraries/prompts', { params: { page: 1, pageSize: 200, type, tag } })
    .then((r) => unwrap(r).data as Prompt[]);

export const listPromptsPage = (params: {
  q?: string;
  type?: 'character' | 'action';
  page?: number;
  pageSize?: number;
}) =>
  api
    .get('/libraries/prompts', { params: { page: 1, pageSize: 20, ...params } })
    .then(unwrap) as Promise<{ data: Prompt[]; total: number }>;

export const createPrompt = (payload: Partial<Prompt>) =>
  api.post(`/libraries/prompts`, payload).then(unwrap);

export const updatePrompt = (id: string, payload: Partial<Prompt>) =>
  api.put(`/libraries/prompts/${id}`, payload).then(unwrap);

export const deletePrompt = (id: string) =>
  api.delete(`/libraries/prompts/${id}`).then(unwrap);

export const listTags = (type: string) =>
  api.get(`/libraries/tags/${type}`).then(unwrap) as Promise<{ id: string; name: string }[]>;

/* ---------------- 上传（按用户隔离） ---------------- */

export async function uploadFile(kind: 'image' | 'audio', file: File): Promise<UploadItem> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await api.post(`/uploads/${kind}`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return unwrap(r);
}

export const listUploads = (kind?: 'image' | 'audio') =>
  api.get('/uploads', { params: { kind } }).then(unwrap) as Promise<UploadItem[]>;

/* ---------------- 三阶段 ---------------- */

export interface CharacterGenPayload {
  channelId?: string;
  model?: string;
  /** 生成来源：ai = 管理员配置的 AI 渠道（默认）；jimeng = 即梦原生生成 */
  source?: 'ai' | 'jimeng';
  /** 即梦模型（source=jimeng 时生效） */
  jimengModel?: string;
  promptId?: string;
  promptText?: string;
  imageUploadId?: string;
  referenceCharacterId?: string;
  referenceCharacterImageId?: string;
  songId?: string;
  size?: string;
  /** 比例（即梦原生参数，如 16:9 / 9:16 / 1:1 / 3:4 / 4:3） */
  ratio?: string;
  /** 画质/分辨率：即梦 1k / 2k / 4k */
  resolution?: string;
  n?: number;
  saveToCharacterId?: string;
  newCharacterName?: string;
  newCharacterTags?: string[];
}

export const runCharacterGen = (payload: CharacterGenPayload) =>
  api.post('/pipeline/character', payload).then(unwrap) as Promise<{ taskId: string }>;

export interface InspirationPayload {
  channelId?: string;
  model?: string;
  imageUploadId?: string;
  referenceCharacterId?: string;
  referenceCharacterImageId?: string;
  audioUploadId?: string;
  songId?: string;
  extraRequirement?: string;
  saveToPromptLibrary?: boolean;
  savePromptTitle?: string;
  savePromptTags?: string[];
}

export const runInspiration = (payload: InspirationPayload) =>
  api.post('/pipeline/inspiration', payload).then(unwrap) as Promise<{ taskId: string }>;

export interface VideoGenPayload {
  imageUploadId?: string;
  characterId?: string;
  characterImageId?: string;
  audioUploadId?: string;
  songId?: string;
  durationSeconds: number;
  audioStartSeconds: number;
  audioEndSeconds?: number;
  actionPrompt: string;
  maxResolution: number;
  fps: number;
}

export const runVideoGen = (payload: VideoGenPayload) =>
  api.post('/pipeline/video', payload).then(unwrap) as Promise<{ taskId: string }>;

/**
 * 新视频工作区上传接口（占位，未完成）。
 * 上传图片 + 音频，返回动作提示词；不可达时前端降级走旧流程（获取灵感）。
 */
export interface WorkspacePayload {
  text?: string;
  characterImageId?: string;
  characterId?: string;
  imageUploadId?: string;
  imageUrl?: string;
  songId?: string;
  audioUploadId?: string;
  audioUrl?: string;
  durationSeconds?: number;
  audioStartSeconds?: number;
  audioEndSeconds?: number;
  maxResolution?: number;
  fps?: number;
}

export interface WorkspaceRetryPayload {
  durationSeconds?: number;
  audioStartSeconds?: number;
  audioEndSeconds?: number;
  maxResolution?: number;
  fps?: number;
}

/** 视频工作区：创建统一任务（提示词扩写 -> 视频生成），失败也会落库 */
export const createWorkspaceTask = (payload: WorkspacePayload) =>
  api.post('/pipeline/workspace', payload).then(unwrap) as Promise<{ taskId: string; status: string }>;

/** 断点续跑：重试失败的工作区任务 */
export const retryWorkspaceTask = (taskId: string, payload: WorkspaceRetryPayload = {}) =>
  api.post(`/pipeline/workspace/${taskId}/retry`, payload).then(unwrap) as Promise<{ taskId: string; status: string }>;

/** Hedra 提示词扩写接口实测（纯文本） */
export const testHedra = (text?: string) =>
  api.post('/pipeline/hedra/test', { text }).then(unwrap) as Promise<{ prompt: string; model: string }>;

/** 提示词扩写（仅文本，不生成视频）：供视频工作区「提示词扩写」按钮调用 */
export const expandPrompt = (payload: {
  text: string;
  characterImageId?: string;
  imageUploadId?: string;
  songId?: string;
  audioUploadId?: string;
}) =>
  api
    .post('/pipeline/hedra/expand', payload)
    .then(unwrap) as Promise<{ prompt: string; model: string; usedFallback?: boolean; source?: string }>;

export const getNodeMapStatus = () =>
  api.get('/pipeline/video/node-map').then(unwrap) as Promise<{
    workflowId: string;
    configured: string[];
    missing: string[];
  }>;

/* ---------------- 即梦生成（异步任务） ---------------- */

export interface JimengImagePayload {
  model?: string;
  prompt: string;
  ratio?: string;
  resolution?: string;
  sampleStrength?: number;
  negativePrompt?: string;
  filePath?: string;
  imageUploadId?: string;
  characterId?: string;
  characterImageId?: string;
  saveToCharacterId?: string;
  newCharacterName?: string;
  newCharacterTags?: string[];
}

export const runJimengImage = (payload: JimengImagePayload) =>
  api.post('/jimeng/image/generations', payload).then(unwrap) as Promise<{ taskId: string }>;

export interface JimengVideoPayload {
  model?: string;
  prompt: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
  filePaths?: string[];
  firstFrameUploadId?: string;
  firstFrameCharacterId?: string;
  endFrameUploadId?: string;
  endFrameCharacterId?: string;
}

export const runJimengVideo = (payload: JimengVideoPayload) =>
  api.post('/jimeng/video/generations', payload).then(unwrap) as Promise<{ taskId: string }>;

export interface JimengModel {
  id: string;
  name: string;
}

export const getJimengModels = () =>
  api.get('/jimeng/models').then(unwrap) as Promise<{ image?: JimengModel[]; video?: JimengModel[] }>;

/* ---------------- 素材库（media 表） ---------------- */

export interface MediaItem {
  id: string;
  type: string;
  url: string;
  localPath?: string;
  taskId?: string;
  createdAt: string;
  task?: { prompt?: string; model?: string; type?: string };
}

export const listMedia = (params: {
  type?: string;
  page?: number;
  pageSize?: number;
}) =>
  api
    .get('/media', { params: { page: 1, pageSize: 20, ...params } })
    .then(unwrap) as Promise<{ data: MediaItem[]; total: number; page: number; pageSize: number }>;

/* ---------------- 任务列表（视频工作区历史） ---------------- */

export const listTasks = (params: {
  type?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}) =>
  api
    .get('/tasks', { params: { page: 1, pageSize: 50, ...params } })
    .then(unwrap) as Promise<{ data: TaskDetail[]; total: number }>;

export const deleteTask = (id: string) => api.delete(`/tasks/${id}`).then(unwrap);

export const deleteMedia = (id: string) =>
  api.delete(`/media/${id}`).then(unwrap);

/* ---------------- 即梦签到管理 ---------------- */

export interface CheckinResult {
  id: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  credits?: number;
}

export interface CheckinAllResult {
  total: number;
  checkedIn: number;
  skipped: number;
  failed: number;
  items: CheckinResult[];
}

export const checkinAll = () =>
  api.post('/admin/jimeng-accounts/checkin-all').then(unwrap) as Promise<CheckinAllResult>;

export const checkinOne = (id: string) =>
  api.post(`/admin/jimeng-accounts/${id}/checkin`).then(unwrap) as Promise<CheckinResult>;

/* ---------------- 个人设置（RunningHub Key） ---------------- */

export const getSettings = () =>
  api.get('/settings').then(unwrap) as Promise<{
    runninghubKeyConfigured: boolean;
    runninghubKeyMask: string | null;
    runninghubKeyAt: string | null;
    hedraCookieConfigured: boolean;
    hedraCookieMask: string | null;
    hedraCookieAt: string | null;
  }>;

export const saveRunninghubKey = (apiKey: string) =>
  api.put('/settings/runninghub-key', { apiKey }).then(unwrap);

export const clearRunninghubKey = () =>
  api.delete('/settings/runninghub-key').then(unwrap);

export const testRunninghubKey = () =>
  api.post('/settings/runninghub-key/test').then(unwrap) as Promise<{
    ok: boolean;
    remainCoins?: number | null;
    message?: string;
  }>;

/* ---------------- 个人设置（Hedra Cookie） ---------------- */

/** 保存个人 Hedra cookie（数组/对象/header 均可，加密存储） */
export const saveHedraCookie = (cookie: string) =>
  api.put('/settings/hedra-cookie', { cookie }).then(unwrap);

export const clearHedraCookie = () =>
  api.delete('/settings/hedra-cookie').then(unwrap);

/** 测试个人 Hedra cookie 是否有效（验登录态） */
export const testHedraCookie = () =>
  api.post('/settings/hedra-cookie/test').then(unwrap) as Promise<{
    ok: boolean;
    email?: string;
    message?: string;
  }>;

/* ---------------- 任务轮询 ---------------- */

export async function pollTask(
  taskId: string,
  opts: {
    intervalMs?: number;
    maxTries?: number;
    onTick?: (task: TaskDetail) => void;
  } = {},
): Promise<TaskDetail> {
  const interval = opts.intervalMs ?? 3000;
  const maxTries = opts.maxTries ?? 400; // 视频最长约 20 分钟

  for (let i = 0; i < maxTries; i++) {
    const t = (await api.get(`/tasks/${taskId}`).then(unwrap)) as TaskDetail;
    opts.onTick?.(t);
    if (t.status === 'success' || t.status === 'failed') return t;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('轮询超时，请稍后到「任务管理」查看结果');
}

/** resultUrls 可能是字符串或对象数组，统一成 string[] */
export function normalizeUrls(urls: any): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map((u) => (typeof u === 'string' ? u : u?.url)).filter(Boolean);
}
