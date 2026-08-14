import React, { useEffect, useState, useCallback } from 'react';
import { message, Card, Tabs, TabsProps, Spin, Image, Space, Tag, Typography, Empty, Button, Modal, Result, Alert } from 'antd';
import {
  VideoCameraOutlined, PictureOutlined, CheckCircleOutlined,
  CloseCircleOutlined, LoadingOutlined, DownloadOutlined, ReloadOutlined
} from '@ant-design/icons';
import JimengGeneratorV2, { VideoGenParams, ImageGenParams, ReferenceItem } from '../components/JimengGeneratorV2';
import '../components/JimengGeneratorV2.css';

import * as JMApi from '../api/jimeng';

/* ================= 类型 ================= */

interface JimengTask {
  id: string;
  type: 'image' | 'video';
  status: 'pending' | 'processing' | 'done' | 'failed' | 'timeout';
  prompt: string;
  /** 图片结果 */
  images?: string[];
  /** 视频结果 */
  videoUrl?: string;
  coverUrl?: string;
  error?: string;
  createdAt: Date;
}

/* ================= 主页面 ================= */

export default function JimengGen() {
  const [tasks, setTasks] = useState<JimengTask[]>([]);
  const [activeTab, setActiveTab] = useState<'video' | 'image'>('video');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [accounts, setAccounts] = useState<JMApi.JimengAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [userCredits, setUserCredits] = useState<number | undefined>(undefined);

  // 加载账号列表和积分
  useEffect(() => {
    loadAccounts();
    loadCredits();
  }, []);

  // 轮询进行中的任务
  useEffect(() => {
    const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'processing');
    if (pending.length === 0) return;

    const timer = setTimeout(async () => {
      for (const task of pending) {
        try {
          let result;
          if (task.type === 'video') {
            result = await JMApi.pollVideoTask(task.id);
            if (result.done) {
              updateTask(task.id, {
                status: 'done',
                videoUrl: result.videoUrl,
                coverUrl: result.coverUrl,
              });
              setProgress(100);
              setGenerating(false);
              message.success('视频生成完成！');
            }
          } else {
            result = await JMApi.pollImageTask(task.id);
            if (result.done) {
              updateTask(task.id, {
                status: 'done',
                images: result.images,
              });
              setProgress(100);
              setGenerating(false);
              message.success('图片生成完成！');
            }
          }

          // 更新进度（模拟）
          setProgress(prev => Math.min(prev + 5, 90));
        } catch (e: any) {
          updateTask(task.id, { status: 'failed', error: e?.message || '查询失败' });
        }
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [tasks]);

  /* ========== 数据加载 ========== */

  async function loadAccounts() {
    try {
      const list = await JMApi.listAccounts();
      setAccounts(list);
    } catch {
      // 接口失败时保持空数组，模块不白屏
    } finally {
      setAccountsLoading(false);
    }
  }

  async function loadCredits() {
    try {
      const info = await JMApi.getAccountSummary();
      setUserCredits(info.totalCredits);
    } catch {
      // 积分加载失败不阻塞使用
    }
  }

  /* ========== 任务管理 ========== */

  function addTask(partial: Omit<JimengTask, 'id' | 'createdAt'>, id?: string) {
    const task: JimengTask = {
      ...partial,
      id: id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date(),
    };
    setTasks((prev) => [task, ...prev]);
    return task.id;
  }

  function updateTask(id: string, patch: Partial<JimengTask>) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }

  /* ========== 上传处理 ========== */

  const handleUploadFile = useCallback(async (
    category: 'image' | 'video' | 'audio',
    file: File
  ): Promise<{ id: string; url: string }> => {
    // 使用即梦上传接口或通用文件上传接口
    try {
      // 尝试使用即梦的上传接口
      const uploadCategory = category === 'video' ? 'video' : category === 'audio' ? 'audio' : 'image';
      const result = await JMApi.uploadToJimeng(file, uploadCategory as any);
      return { id: result.id || 'uploaded', url: result.url };
    } catch {
      // 回退到通用上传
      const { uploadFile } = require('../api/pipeline');
      const up = await uploadFile(category, file);
      return { id: up.id, url: up.url };
    }
  }, []);

  /* ========== 提交生成 ========== */

  const handleSubmitVideo = useCallback(async (params: VideoGenParams) => {
    if (!params.prompt.trim()) {
      message.warning('请输入提示词');
      return;
    }

    setGenerating(true);
    setProgress(10);

    try {
      // 构建参考素材列表（用于全能参考）
      const referenceUploadIds = params.references
        .filter(r => r.uploadId)
        .map(r => r.uploadId!);
      
      // 如果有参考素材，将它们作为额外参数传递
      const extraParams: any = {};
      if (params.mode !== 'off' && params.references.length > 0) {
        extraParams.references = params.references.map(r => ({
          type: r.type,
          uploadId: r.uploadId,
          characterId: r.characterId,
          mentionLabel: r.mentionLabel,
          url: r.url,
        }));
        extraParams.referenceMode = params.mode;
      }

      // 首帧/尾帧：如果有图片类型参考素材，可以自动用作首帧
      let firstFrameId = params.firstFrameUploadId;
      let endFrameId = params.endFrameUploadId;

      // 如果没有指定首帧但有图片参考，用第一张图作为首帧
      if (!firstFrameId && params.references.length > 0) {
        const firstImageRef = params.references.find(r => r.type === 'image');
        if (firstImageRef?.uploadId) {
          firstFrameId = firstImageRef.uploadId;
        }
      }

      const taskId = await JMApi.startJimengVideo({
        model: params.model,
        prompt: params.prompt,
        ratio: params.ratio,
        resolution: params.resolution,
        duration: params.duration,
        firstFrameUploadId: firstFrameId,
        endFrameUploadId: endFrameId,
        ...extraParams,
      });

      addTask({
        type: 'video',
        status: 'pending',
        prompt: params.prompt,
      }, taskId);

      message.info('视频生成任务已提交，请等待...');
      setProgress(20);
    } catch (e: any) {
      console.error('[JimengGen] video gen error:', e);
      message.error(e?.response?.data?.message || e?.message || '视频生成失败');
      setGenerating(false);
      setProgress(0);
    }
  }, []);

  const handleSubmitImage = useCallback(async (params: ImageGenParams) => {
    if (!params.prompt.trim()) {
      message.warning('请输入提示词');
      return;
    }

    setGenerating(true);
    setProgress(10);

    try {
      const extraParams: any = {};
      if (params.references.length > 0) {
        extraParams.references = params.references.map(r => ({
          type: r.type,
          uploadId: r.uploadId,
          characterId: r.characterId,
          mentionLabel: r.mentionLabel,
          url: r.url,
        }));
      }

      // 如果有图片参考，使用第一张作为参考图
      let refUploadId: string | undefined;
      const firstImageRef = params.references.find(r => r.type === 'image');
      if (firstImageRef?.uploadId) {
        refUploadId = firstImageRef.uploadId;
      }

      const taskId = await JMApi.startJimengImage({
        model: params.model,
        prompt: params.prompt,
        ratio: params.ratio,
        imageUploadId: refUploadId,
        ...extraParams,
      });

      addTask({
        type: 'image',
        status: 'pending',
        prompt: params.prompt,
      }, taskId);

      message.info('图片生成任务已提交，请等待...');
      setProgress(20);
    } catch (e: any) {
      console.error('[JimengGen] image gen error:', e);
      message.error(e?.response?.data?.message || e?.message || '图片生成失败');
      setGenerating(false);
      setProgress(0);
    }
  }, []);

  /* ========== 渲染 ========== */

  const tabItems: TabsProps['items'] = [
    {
      key: 'generate',
      label: (
        <Space>
          <VideoCameraOutlined />
          <span>创作</span>
        </Space>
      ),
      children: (
        <div className="jimeng-gen-create">
          {/* 账号池为空时的引导横幅（健壮性：避免"功能消失"错觉） */}
          {!accountsLoading && accounts.length === 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16, borderRadius: 10 }}
              message="尚未导入即梦账号"
              description={
                <span>
                  即梦生成需要可用的账号。请前往「即梦账号池」导入已登录即梦网页的 Cookie（sessionid），
                  你导入的账号会出现在这里。导入后即可正常生成视频/图片。
                </span>
              }
            />
          )}

          {/* 新版即梦风格生成器 */}
          <JimengGeneratorV2
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onSubmitVideo={handleSubmitVideo}
            onSubmitImage={handleSubmitImage}
            onUploadFile={handleUploadFile}
            characters={[]}
            generating={generating}
            progress={progress}
            userCredits={userCredits}
          />
        </div>
      ),
    },
    {
      key: 'results',
      label: (
        <Space>
          <PictureOutlined />
          <span>结果</span>
          {tasks.filter(t => t.status === 'done').length > 0 && (
            <Tag color="blue" style={{ marginLeft: 4 }}>{tasks.filter(t => t.status === 'done').length}</Tag>
          )}
        </Space>
      ),
      children: (
        <div className="jimeng-gen-results">
          {tasks.length === 0 ? (
            <Empty description="暂无生成记录，开始创作吧！" />
          ) : (
            <div className="task-list">
              {tasks.map((task) => (
                <Card key={task.id} size="small" className="task-card" hoverable>
                  <div className="task-header">
                    <Space>
                      <Tag color={task.type === 'video' ? 'purple' : 'blue'}>
                        {task.type === 'video' ? '视频' : '图片'}
                      </Tag>
                      <Typography.Text ellipsis style={{ maxWidth: 360 }}>
                        {task.prompt}
                      </Typography.Text>
                    </Space>
                    <Tag
                      color={
                        task.status === 'done'
                          ? 'success'
                          : task.status === 'failed'
                          ? 'error'
                          : task.status === 'processing'
                          ? 'processing'
                          : 'default'
                      }
                    >
                      {task.status === 'done' && <CheckCircleOutlined />}{' '}
                      {task.status === 'failed' && <CloseCircleOutlined />}{' '}
                      {task.status === 'processing' && <LoadingOutlined />}{' '}
                      {{ pending: '排队中', processing: '生成中', done: '已完成', failed: '失败', timeout: '超时' }[task.status]}
                    </Tag>
                  </div>

                  {(task.status === 'processing' || task.status === 'pending') && (
                    <div style={{ marginTop: 8 }}>
                      <Spin size="small" /> 正在处理...
                    </div>
                  )}

                  {task.status === 'done' && task.type === 'image' && task.images && (
                    <div className="result-images">
                      {task.images.map((url, idx) => (
                        <Image key={idx} src={url} className="result-img" />
                      ))}
                    </div>
                  )}

                  {task.status === 'done' && task.type === 'video' && task.videoUrl && (
                    <div className="result-video">
                      {task.coverUrl && <Image src={task.coverUrl} className="video-cover" preview={false} />}
                      <video src={task.videoUrl} controls className="video-player" />
                      <Button
                        type="primary"
                        size="small"
                        icon={<DownloadOutlined />}
                        href={task.videoUrl}
                        target="_blank"
                        style={{ marginTop: 6 }}
                      >
                        下载视频
                      </Button>
                    </div>
                  )}

                  {task.status === 'failed' && task.error && (
                    <Typography.Text type="danger" style={{ fontSize: 12, marginTop: 4 }}>
                      {task.error}
                    </Typography.Text>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="jimeng-gen-page">
      <Tabs defaultActiveKey="generate" items={tabItems} size="middle" className="jimeng-tabs-main" />

      <style>{`
        .jimeng-gen-page {
          max-width: 920px;
          margin: 0 auto;
          padding: 16px 20px;
        }

        .jimeng-gen-create {
          margin-bottom: 24px;
        }

        .jimeng-gen-results {
          min-height: 200px;
        }

        .task-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .task-card {
          border-radius: 10px;
        }

        .task-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .result-images {
          display: flex;
          gap: 8px;
          margin-top: 10px;
          flex-wrap: wrap;
        }

        .result-img {
          width: 160px;
          height: 160px;
          object-fit: cover;
          border-radius: 8px;
          border: 1px solid #f0f0f0;
        }

        .result-video {
          margin-top: 10px;
          text-align: center;
        }

        .video-cover {
          width: 240px;
          height: 135px;
          object-fit: cover;
          border-radius: 8px;
          margin-bottom: 6px;
        }

        .video-player {
          width: 100%;
          max-width: 400px;
          border-radius: 8px;
          max-height: 260px;
        }

        .jimeng-tabs-main > .ant-tabs-nav {
          margin-bottom: 18px;
        }

        @media (max-width: 640px) {
          .jimeng-gen-page {
            padding: 10px 12px;
          }
          
          .result-img {
            width: 120px;
            height: 120px;
          }
        }
      `}</style>
    </div>
  );
}
