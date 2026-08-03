import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  pollTask,
  runCharacterGen,
  runInspiration,
  runVideoGen,
  normalizeUrls,
  type CharacterGenPayload,
  type InspirationPayload,
  type VideoGenPayload,
} from '../api/pipeline';

export type Stage = 'character' | 'inspiration' | 'video';

export interface SessionState {
  taskId?: string;
  status?: 'pending' | 'running' | 'success' | 'failed';
  statusText?: string;
  results: string[];
  resultText?: string;
  /** 获取灵感产出的动作提示词，跨页面/刷新保留，供视频生成直接带入 */
  actionPrompt?: string;
  /** 获取灵感产出的形象提示词，跨页面/刷新保留，供生成形象直接带入 */
  characterPrompt?: string;
  error?: string;
}

/**
 * 表单草稿：用户在页面上填过、选过的一切内容。
 * 与任务进度分开存，即使没有发起过任务，刷新后也不丢。
 */
export interface DraftState {
  /** antd Form 的字段值 */
  form: Record<string, any>;
  /** 图片来源选择（ImageSourceValue） */
  image: Record<string, any>;
  /** 音频来源选择（AudioSourceValue） */
  audio: Record<string, any>;
  /** 页面级零散状态，如标签筛选 */
  extra: Record<string, any>;
}

const emptySession = (): SessionState => ({ results: [] });
const emptyDraft = (): DraftState => ({ form: {}, image: {}, audio: {}, extra: {} });

interface TaskSessionCtx {
  get: (stage: Stage) => SessionState;
  startCharacter: (payload: CharacterGenPayload) => Promise<string>;
  startInspiration: (payload: InspirationPayload) => Promise<string>;
  startVideo: (payload: VideoGenPayload) => Promise<string>;
  clear: (stage: Stage) => void;

  /** 表单草稿：读取 */
  getDraft: (stage: Stage) => DraftState;
  /** 表单草稿：局部更新（自动落盘） */
  patchDraft: (stage: Stage, p: Partial<DraftState>) => void;
  /** 表单草稿：清空当前阶段 */
  clearDraft: (stage: Stage) => void;
  /** 草稿是否已从存储恢复（用于提示用户） */
  restoredFromStorage: boolean;
}

const Ctx = createContext<TaskSessionCtx | null>(null);

/**
 * 用 localStorage 而不是 sessionStorage：
 *   sessionStorage 只在同一个标签页存活，用户关掉标签页或在新标签打开就没了；
 *   localStorage 能扛住刷新（F5）、关闭标签页、重开浏览器，体验更接近「草稿箱」。
 * 退出登录时会主动清空（见 AppLayout.onLogout）。
 */
export const TASK_STORAGE_KEY = 'aigen-panel-workspace-v2';

type Persisted = {
  sessions: Record<Stage, SessionState>;
  drafts: Record<Stage, DraftState>;
};

const STAGES: Stage[] = ['character', 'inspiration', 'video'];

function readStorage(): { data: Persisted; restored: boolean } {
  const fresh: Persisted = {
    sessions: { character: emptySession(), inspiration: emptySession(), video: emptySession() },
    drafts: { character: emptyDraft(), inspiration: emptyDraft(), video: emptyDraft() },
  };
  try {
    const raw = localStorage.getItem(TASK_STORAGE_KEY);
    if (!raw) return { data: fresh, restored: false };
    const parsed = JSON.parse(raw);
    let restored = false;
    STAGES.forEach((k) => {
      if (parsed?.sessions?.[k]) {
        fresh.sessions[k] = { ...emptySession(), ...parsed.sessions[k] };
        if (fresh.sessions[k].taskId) restored = true;
      }
      if (parsed?.drafts?.[k]) {
        fresh.drafts[k] = { ...emptyDraft(), ...parsed.drafts[k] };
        if (Object.keys(fresh.drafts[k].form || {}).length) restored = true;
      }
    });
    return { data: fresh, restored };
  } catch {
    // 存储损坏时直接丢弃，不影响页面渲染
    return { data: fresh, restored: false };
  }
}

export function TaskSessionProvider({ children }: { children: React.ReactNode }) {
  const bootRef = useRef(readStorage());
  const [sessions, setSessions] = useState<Record<Stage, SessionState>>(bootRef.current.data.sessions);
  const [drafts, setDrafts] = useState<Record<Stage, DraftState>>(bootRef.current.data.drafts);
  const restoredFromStorage = bootRef.current.restored;

  // 任何变化都立即落盘：刷新 / 关标签页 / 重开浏览器都能恢复
  useEffect(() => {
    try {
      localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify({ sessions, drafts }));
    } catch {
      /* ignore quota errors */
    }
  }, [sessions, drafts]);

  const patch = useCallback((stage: Stage, p: Partial<SessionState>) => {
    setSessions((s) => ({ ...s, [stage]: { ...s[stage], ...p } }));
  }, []);

  const patchDraft = useCallback((stage: Stage, p: Partial<DraftState>) => {
    setDrafts((d) => ({ ...d, [stage]: { ...d[stage], ...p } }));
  }, []);

  const clearDraft = useCallback((stage: Stage) => {
    setDrafts((d) => ({ ...d, [stage]: emptyDraft() }));
  }, []);

  const pollLoop = useCallback(
    (stage: Stage, taskId: string) => {
      pollTask(taskId, {
        onTick: (t) =>
          patch(stage, {
            taskId,
            status: t.status,
            statusText: `任务 ${taskId.slice(0, 8)} · ${t.status}`,
            results: normalizeUrls(t.resultUrls),
            resultText: t.resultText,
            actionPrompt: t.resultData?.actionPrompt || t.resultText,
            characterPrompt: t.resultData?.characterPrompt,
            error: t.errorMessage,
          }),
      })
        .then((t) =>
          patch(stage, {
            status: t.status,
            statusText: t.status === 'success' ? '已完成' : '生成失败',
            results: normalizeUrls(t.resultUrls),
            resultText: t.resultText,
            actionPrompt: t.resultData?.actionPrompt || t.resultText,
            characterPrompt: t.resultData?.characterPrompt,
            error: t.errorMessage,
          }),
        )
        .catch((e: any) =>
          patch(stage, { status: 'failed', statusText: '', error: e?.message || '轮询超时' }),
        );
    },
    [patch],
  );

  const start = useCallback(
    async (
      stage: Stage,
      runFn: (p: any) => Promise<{ taskId: string }>,
      payload: any,
    ): Promise<string> => {
      patch(stage, {
        status: 'pending',
        statusText: '已提交，等待处理…',
        results: [],
        resultText: '',
        actionPrompt: '',
        characterPrompt: '',
        error: '',
      });
      const { taskId } = await runFn(payload);
      patch(stage, { taskId, status: 'running' });
      // 轮询在 Provider 内后台进行，切换路由不会中断
      pollLoop(stage, taskId);
      return taskId;
    },
    [patch, pollLoop],
  );

  // 挂载时恢复：若存储中有进行中的任务，重新挂载轮询（应对整页刷新 / 重开浏览器）
  useEffect(() => {
    const boot = bootRef.current.data.sessions;
    STAGES.forEach((k) => {
      const s = boot[k];
      if (s.taskId && (s.status === 'pending' || s.status === 'running')) {
        pollLoop(k, s.taskId);
      }
    });
    // 仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCharacter = useCallback(
    (p: CharacterGenPayload) => start('character', runCharacterGen, p),
    [start],
  );
  const startInspiration = useCallback(
    (p: InspirationPayload) => start('inspiration', runInspiration, p),
    [start],
  );
  const startVideo = useCallback((p: VideoGenPayload) => start('video', runVideoGen, p), [start]);

  // 注意：必须整体替换，否则 taskId/status 会残留（旧实现用 patch 合并，清不掉）
  const clear = useCallback((stage: Stage) => {
    setSessions((s) => ({ ...s, [stage]: emptySession() }));
  }, []);

  return (
    <Ctx.Provider
      value={{
        get: (s) => sessions[s],
        startCharacter,
        startInspiration,
        startVideo,
        clear,
        getDraft: (s) => drafts[s],
        patchDraft,
        clearDraft,
        restoredFromStorage,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useTaskSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTaskSession 必须在 TaskSessionProvider 内使用');
  return c;
}

/** 退出登录 / 切换账号时调用，避免草稿串号 */
export function clearWorkspaceStorage() {
  try {
    localStorage.removeItem(TASK_STORAGE_KEY);
    sessionStorage.removeItem('aigen-task-sessions'); // 清理旧版本遗留数据
  } catch {
    /* ignore */
  }
}
