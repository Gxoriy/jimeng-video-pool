import { api } from './client';

/* ================= 类型定义 ================= */

export interface JimengAccount {
  id: string;
  label: string;
  status: 'active' | 'inactive' | 'error';
  lastCheckAt?: string;
  lastError?: string;
}

export interface JimengTaskResult {
  done: boolean;
  taskId: string;
  /** 图片结果 */
  images?: string[];
  /** 视频结果 */
  videoUrl?: string;
  coverUrl?: string;
  error?: string;
}

export interface AccountSummary {
  totalAccounts: number;
  activeCount: number;
  totalCredits: number;
}

/* ================= 即梦 API ================= */

/** 获取账号列表 */
export async function listAccounts(): Promise<JimengAccount[]> {
  const { data } = await api.get('/jimeng/accounts');
  return data.data || data || [];
}

/** 获取账号摘要（含积分） */
export async function getAccountSummary(): Promise<AccountSummary> {
  const { data } = await api.get('/jimeng/accounts/summary');
  return data.data || data || { totalAccounts: 0, activeCount: 0, totalCredits: 0 };
}

/** 上传文件到即梦 */
export async function uploadToJimeng(
  file: File,
  category: 'image' | 'video' | 'audio'
): Promise<{ id: string; url: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('category', category);

  const { data } = await api.post('/jimeng/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  
  return data.data || data;
}

/** 启动视频生成任务 */
export async function startJimengVideo(params: {
  model: string;
  prompt: string;
  ratio: string;
  resolution: string;
  duration: number;
  firstFrameUploadId?: string;
  endFrameUploadId?: string;
  references?: Array<{
    type: string;
    uploadId?: string;
    characterId?: string;
    mentionLabel: string;
    url: string;
  }>;
  referenceMode?: string;
}): Promise<string> {
  const { data } = await api.post('/jimeng/video/generate', params);
  return data.data?.taskId || data.taskId || data.id;
}

/** 启动图片生成任务 */
export async function startJimengImage(params: {
  model: string;
  prompt: string;
  ratio: string;
  imageUploadId?: string;
  references?: Array<{
    type: string;
    uploadId?: string;
    characterId?: string;
    mentionLabel: string;
    url: string;
  }>;
}): Promise<string> {
  const { data } = await api.post('/jimeng/image/generate', params);
  return data.data?.taskId || data.taskId || data.id;
}

/** 轮询视频任务状态 */
export async function pollVideoTask(taskId: string): Promise<JimengTaskResult> {
  const { data } = await api.get(`/jimeng/video/task/${taskId}`);
  return data.data || data;
}

/** 轮询图片任务状态 */
export async function pollImageTask(taskId: string): Promise<JimengTaskResult> {
  const { data } = await api.get(`/jimeng/image/task/${taskId}`);
  return data.data || data;
}
