import type { ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CharacterGen from './pages/CharacterGen';
import Inspiration from './pages/Inspiration';
import VideoGen from './pages/VideoGen';
import VideoWorkspace from './pages/VideoWorkspace';
import Characters from './pages/Characters';
import Songs from './pages/Songs';
import Prompts from './pages/Prompts';
import Tasks from './pages/Tasks';
import TaskLogs from './pages/TaskLogs';
import Users from './pages/Users';
import Settings from './pages/Settings';
import AiChannels from './pages/AiChannels';
import JimengGen from './pages/JimengGen';
import JimengAccounts from './pages/JimengAccounts';
import MediaLibrary from './pages/MediaLibrary';
import { useFeatures } from './context/Features';

/**
 * 路由：三阶段流水线
 *   /character-gen  P1 生成形象
 *   /inspiration    P2 获取灵感
 *   /video          P3 视频生成
 */

/** 即梦功能关闭时，重定向走即梦相关页面（菜单已隐藏，此处再兜底；后端接口也会返回 403） */
function RequireJimengEnabled({ children }: { children: ReactNode }) {
  const { hideJimeng } = useFeatures();
  if (hideJimeng) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />

        {/* 三阶段（旧入口，重定向到统一视频工作区） */}
        <Route path="character-gen" element={<Navigate to="/video-workspace" replace />} />
        <Route path="inspiration" element={<Navigate to="/video-workspace" replace />} />
        <Route path="video" element={<Navigate to="/video-workspace" replace />} />

        {/* 统一视频工作区（获取灵感 + 生成形象 + 视频生成 合并） */}
        <Route path="video-workspace" element={<VideoWorkspace />} />

        {/* 素材库 */}
        <Route path="libraries/characters" element={<Characters />} />
        <Route path="libraries/songs" element={<Songs />} />
        <Route path="libraries/prompts" element={<Prompts />} />

        {/* 即梦生成（登录可见；隐藏即梦时由 RequireJimengEnabled 重定向） */}
        <Route path="jimeng-gen" element={<RequireJimengEnabled><JimengGen /></RequireJimengEnabled>} />

        {/* 素材库（视频/图片） */}
        <Route path="libraries/media" element={<MediaLibrary />} />

        <Route path="tasks" element={<Tasks />} />
        <Route path="task-logs" element={<TaskLogs />} />
        <Route path="settings" element={<Settings />} />

        {/* 仅超级管理员 */}
        <Route path="users" element={<Users />} />
        <Route path="ai-channels" element={<AiChannels />} />
        <Route path="jimeng-accounts" element={<RequireJimengEnabled><JimengAccounts /></RequireJimengEnabled>} />

        {/* 旧路径兼容 */}
        <Route path="gen/image" element={<Navigate to="/character-gen" replace />} />
        <Route path="gen/digital-human" element={<Navigate to="/inspiration" replace />} />
        <Route path="gen/video" element={<Navigate to="/video" replace />} />
        <Route path="api-keys" element={<Navigate to="/settings" replace />} />
      </Route>
    </Routes>
  );
}
