import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Empty,
  Image,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import type { TableRowSelection } from 'antd/es/table/interface';
import {
  AudioOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  RedoOutlined,
  ReloadOutlined,
  SyncOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  listCharacters,
  listSongs,
  listUploads,
  getCharacter,
  createWorkspaceTask,
  retryWorkspaceTask,
  listTasks,
  deleteTask,
  pollTask,
  uploadFile,
  type Character,
  type Song,
  type TaskDetail,
  type UploadItem,
  type WorkspacePayload,
  type WorkspaceRetryPayload,
} from '../api/pipeline';

const PARAM_DEFAULTS = { durationSeconds: 0, audioStartSeconds: 0, maxResolution: 1024, fps: 25 };

interface Draft {
  characterId?: string;
  imageId?: string;
  songId?: string;
  imageUploadId?: string;
  audioUploadId?: string;
  text?: string;
  params?: typeof PARAM_DEFAULTS;
}

const DRAFT_KEY = 'aigen-panel-video-workspace-draft';

/** 触发浏览器下载单个 URL */
function downloadUrl(url: string, filename?: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || url.split('/').pop() || 'download';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function VideoWorkspace() {
  /* ---------- 列表状态 ---------- */
  const [tasks, setTasks] = useState<TaskDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [activeTask, setActiveTask] = useState<TaskDetail | null>(null);
  const pollingRefs = useRef<Record<string, boolean>>({});

  /* ---------- 素材缓存 ---------- */
  const [characters, setCharacters] = useState<Character[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const charMap = useMemo(() => {
    const m = new Map<string, Character>();
    characters.forEach((c) => m.set(c.id, c));
    return m;
  }, [characters]);
  const songMap = useMemo(() => {
    const m = new Map<string, Song>();
    songs.forEach((s) => m.set(s.id, s));
    return m;
  }, [songs]);

  /* ---------- 新建任务弹窗 ---------- */
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [charQ, setCharQ] = useState('');
  const [songQ, setSongQ] = useState('');
  const [selCharId, setSelCharId] = useState<string | null>(null);
  const [selCharImages, setSelCharImages] = useState<{ id: string; url: string; style?: string }[]>([]);
  const [selImageId, setSelImageId] = useState<string | null>(null);
  const [selSongId, setSelSongId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [params, setParams] = useState<typeof PARAM_DEFAULTS>({ ...PARAM_DEFAULTS });
  const [imageUpload, setImageUpload] = useState<UploadItem | null>(null);
  const [audioUpload, setAudioUpload] = useState<UploadItem | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const draftRef = useRef<Draft>({});

  /* ---------- 编辑/重试 ---------- */
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editParams, setEditParams] = useState<typeof PARAM_DEFAULTS>({ ...PARAM_DEFAULTS });

  /* ---------- 初始化 ---------- */
  const loadTasks = async (p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const status = statusFilter === 'all' ? undefined : statusFilter;
      const res = await listTasks({ type: 'video', q: q || undefined, page: p, pageSize: ps });
      setTasks(res.data || []);
      setTotal(res.total || 0);
      // 自动开始轮询运行中任务
      (res.data || []).forEach((t) => {
        if (t.status === 'running' || t.status === 'pending') startPoll(t.id);
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
    listCharacters().then(setCharacters).catch(() => undefined);
    listSongs(undefined, 'active').then(setSongs).catch(() => undefined);
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) draftRef.current = JSON.parse(raw);
    } catch { /* ignore */ }
    // 恢复草稿中的上传文件
    listUploads().then((ups) => {
      const d = draftRef.current;
      if (d.imageUploadId) {
        const found = ups.find((u) => u.id === d.imageUploadId);
        if (found) setImageUpload(found);
      }
      if (d.audioUploadId) {
        const found = ups.find((u) => u.id === d.audioUploadId);
        if (found) setAudioUpload(found);
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadTasks(page, pageSize);
  }, [page, pageSize, statusFilter, sortField, sortOrder, q]);

  const saveDraft = (patch: Partial<Draft>) => {
    draftRef.current = { ...draftRef.current, ...patch };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draftRef.current)); } catch { /* ignore */ }
  };

  /* ---------- 轮询 ---------- */
  const startPoll = (taskId: string) => {
    if (pollingRefs.current[taskId]) return;
    pollingRefs.current[taskId] = true;
    pollTask(taskId, {
      intervalMs: 3000,
      maxTries: 400,
      onTick: (t) => {
        setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
        if (activeTask?.id === t.id) setActiveTask(t);
      },
    })
      .then((t) => {
        setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
        if (activeTask?.id === t.id) setActiveTask(t);
      })
      .catch(() => undefined)
      .finally(() => {
        delete pollingRefs.current[taskId];
      });
  };

  /* ---------- 弹窗选择 ---------- */
  const openModal = () => {
    const d = draftRef.current;
    setSelCharId(d.characterId || null);
    setSelImageId(d.imageId || null);
    setSelSongId(d.songId || null);
    setText(d.text || '');
    setParams({ ...PARAM_DEFAULTS, ...(d.params || {}) });
    setOpen(true);
    if (d.characterId) loadCharImages(d.characterId);
  };

  const loadCharImages = async (charId: string) => {
    try {
      const c = await getCharacter(charId);
      setSelCharImages((c.images || []).map((i) => ({ id: i.id, url: i.url, style: i.style || '默认' })));
    } catch { /* ignore */ }
  };

  const onPickCharacter = (id: string) => {
    setSelCharId(id);
    setSelImageId(null);
    setImageUpload(null);
    saveDraft({ characterId: id, imageId: undefined, imageUploadId: undefined });
    loadCharImages(id);
  };

  const onPickImage = (id: string) => {
    setSelImageId(id);
    setImageUpload(null);
    saveDraft({ imageId: id, imageUploadId: undefined });
  };

  const onPickSong = (id: string) => {
    setSelSongId(id);
    setAudioUpload(null);
    saveDraft({ songId: id, audioUploadId: undefined });
  };

  const handleUploadImage = async (file: File) => {
    setUploadingImage(true);
    try {
      const item = await uploadFile('image', file);
      setImageUpload(item);
      setSelCharId(null);
      setSelImageId(null);
      setSelCharImages([]);
      saveDraft({ imageUploadId: item.id, characterId: undefined, imageId: undefined });
      message.success(`图片已上传：${item.filename}`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '图片上传失败');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleUploadAudio = async (file: File) => {
    setUploadingAudio(true);
    try {
      const item = await uploadFile('audio', file);
      setAudioUpload(item);
      setSelSongId(null);
      saveDraft({ audioUploadId: item.id, songId: undefined });
      message.success(`音频已上传：${item.filename}`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '音频上传失败');
    } finally {
      setUploadingAudio(false);
    }
  };

  const canExecute = (!!selImageId || !!imageUpload) && (!!selSongId || !!audioUpload);

  /* ---------- 新建任务：统一接口，先落库再异步执行 ---------- */
  const onExecute = async () => {
    if (!canExecute) return;
    setSubmitting(true);
    try {
      const payload: WorkspacePayload = {
        text,
        characterImageId: selImageId || undefined,
        imageUploadId: imageUpload?.id,
        songId: selSongId || undefined,
        audioUploadId: audioUpload?.id,
        durationSeconds: params.durationSeconds,
        audioStartSeconds: params.audioStartSeconds,
        audioEndSeconds: undefined,
        maxResolution: params.maxResolution,
        fps: params.fps,
      };
      const { taskId } = await createWorkspaceTask(payload);
      message.success('任务已创建并开始执行');
      saveDraft({
        characterId: selCharId || undefined,
        imageId: selImageId || undefined,
        songId: selSongId || undefined,
        imageUploadId: imageUpload?.id,
        audioUploadId: audioUpload?.id,
        text,
        params,
      });
      setOpen(false);
      setPage(1);
      await loadTasks(1, pageSize);
      startPoll(taskId);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '创建任务失败');
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- 断点续跑 / 编辑参数 ---------- */
  const onRetry = async (task: TaskDetail, override?: WorkspaceRetryPayload) => {
    try {
      const { taskId } = await retryWorkspaceTask(task.id, override || {});
      message.success('已开始断点续跑');
      startPoll(taskId);
      loadTasks();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '重试失败');
    }
  };

  const openEdit = () => {
    if (!activeTask) return;
    const p = activeTask.params || {};
    setEditParams({
      durationSeconds: p.durationSeconds ?? PARAM_DEFAULTS.durationSeconds,
      audioStartSeconds: p.audioStartSeconds ?? PARAM_DEFAULTS.audioStartSeconds,
      maxResolution: p.maxResolution ?? PARAM_DEFAULTS.maxResolution,
      fps: p.fps ?? PARAM_DEFAULTS.fps,
    });
    setEditOpen(true);
  };

  const onEditConfirm = async () => {
    if (!activeTask) return;
    setEditLoading(true);
    try {
      await onRetry(activeTask, {
        durationSeconds: editParams.durationSeconds,
        audioStartSeconds: editParams.audioStartSeconds,
        maxResolution: editParams.maxResolution,
        fps: editParams.fps,
      });
      setEditOpen(false);
    } finally {
      setEditLoading(false);
    }
  };

  /* ---------- 列表操作 ---------- */
  const onSelectChange = (keys: React.Key[]) => setSelectedRowKeys(keys);

  const doDelete = async (id: string) => {
    try {
      await deleteTask(id);
      message.success('已删除');
      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (activeTask?.id === id) setActiveTask(null);
      if (selectedRowKeys.includes(id)) setSelectedRowKeys((prev) => prev.filter((k) => k !== id));
      loadTasks();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const onBatchDelete = async () => {
    if (!selectedRowKeys.length) return;
    for (const id of selectedRowKeys) {
      await doDelete(id as string);
    }
    message.success('批量删除完成');
  };

  const onBatchExport = () => {
    if (!selectedRowKeys.length) return;
    selectedRowKeys.forEach((id) => {
      const t = tasks.find((x) => x.id === id);
      (t?.resultUrls || []).forEach((u) => downloadUrl(u));
    });
    message.success('已触发所选任务的结果下载');
  };

  const rowSelection: TableRowSelection<TaskDetail> = {
    selectedRowKeys,
    onChange: onSelectChange,
  };

  /* ---------- 表格列（已精简：移除冗余的「任务类型/风格/歌手」列，避免横向滚动；类型标签并入标题列，风格/歌手信息保留在右侧详情面板） ---------- */
  const columns = [
    {
      title: '任务 / 标题',
      dataIndex: 'prompt',
      key: 'title',
      width: 340,
      ellipsis: { showTitle: true },
      render: (_: any, t: TaskDetail) => {
        const source = t.resultData?.promptSource || 'workspace';
        const songId = t.params?.songId;
        const song = songId ? songMap.get(songId) : undefined;
        const raw = song?.title || t.prompt?.slice(0, 30) || '未命名任务';
        const titleText = song?.title ? `《${raw}》` : raw;
        return (
          <Space size={6}>
            <Tag color="blue" style={{ marginRight: 0 }}>
              {source === 'hedra' ? '翻唱' : '数字人'}
            </Tag>
            <span>{titleText}</span>
          </Space>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => {
        const color = s === 'success' ? 'green' : s === 'failed' ? 'red' : 'blue';
        const label = s === 'success' ? '完成' : s === 'failed' ? '失败' : s === 'running' ? '执行中' : '待处理';
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      fixed: 'right' as const,
      render: (_: any, t: TaskDetail) => (
        <Space>
          <Tooltip title="预览">
            <Button size="small" icon={<EyeOutlined />} onClick={() => setActiveTask(t)} />
          </Tooltip>
          {t.status === 'failed' && (
            <Tooltip title="断点续跑">
              <Button size="small" icon={<RedoOutlined />} onClick={() => onRetry(t)} />
            </Tooltip>
          )}
          <Tooltip title="删除">
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => doDelete(t.id)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  /* ---------- 右侧面板 ---------- */
  const taskSong = activeTask?.params?.songId ? songMap.get(activeTask.params.songId) : undefined;
  const taskCharImageUrl = activeTask?.params?.imageUrl;
  const resultUrls = activeTask?.resultUrls || [];
  const actionPrompt = activeTask?.resultData?.actionPrompt || activeTask?.prompt || '';

  const previewTab = (
    <Space direction="vertical" style={{ width: '100%' }}>
      {taskCharImageUrl && (
        <div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>参考形象</div>
          <Image src={taskCharImageUrl} preview={false} style={{ maxHeight: 240, borderRadius: 6, objectFit: 'cover' }} />
        </div>
      )}
      {resultUrls.length > 0 ? (
        resultUrls.map((u, i) => (
          <div key={i}>
            <video src={u} controls style={{ width: '100%', borderRadius: 6 }} />
          </div>
        ))
      ) : (
        <Empty description="暂无视频结果" />
      )}
    </Space>
  );

  const detailTab = (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
          #{taskSong?.title ? `《${taskSong.title}》` : activeTask?.prompt?.slice(0, 20) || '未命名任务'}
        </div>
        <Space wrap>
          <Tag color="blue">
            {activeTask?.resultData?.promptSource === 'hedra' ? '翻唱' : '数字人'}
          </Tag>
          {taskSong?.category && <Tag>{taskSong.category}</Tag>}
          {taskSong?.tags?.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Space>
      </div>

      <Descriptions title="任务信息" bordered size="small" column={2}>
        <Descriptions.Item label="歌手">{taskSong?.artist || '-'}</Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {activeTask?.createdAt ? new Date(activeTask.createdAt).toLocaleString('zh-CN') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={activeTask?.status === 'success' ? 'green' : activeTask?.status === 'failed' ? 'red' : 'blue'}>
            {activeTask?.status === 'success' ? '完成' : activeTask?.status === 'failed' ? '失败' : activeTask?.status === 'running' ? '执行中' : '待处理'}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="当前阶段">{activeTask?.params?.stage || '-'}</Descriptions.Item>
      </Descriptions>

      <Card size="small" title="音频预览">
        {taskSong?.url ? (
          <audio src={taskSong.url} controls style={{ width: '100%' }} />
        ) : (
          <Empty description="暂无音频" />
        )}
      </Card>

      <Card
        size="small"
        title="歌词预览"
        extra={
          taskSong?.lyrics ? (
            <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(taskSong.lyrics || ''); message.success('歌词已复制'); }}>
              复制歌词
            </Button>
          ) : null
        }
      >
        <div style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {taskSong?.lyrics || '暂无歌词'}
        </div>
      </Card>

      <Card
        size="small"
        title="动作提示词"
        extra={
          actionPrompt ? (
            <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(actionPrompt); message.success('提示词已复制'); }}>
              复制
            </Button>
          ) : null
        }
      >
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {actionPrompt || '-'}
        </div>
      </Card>

      {activeTask?.errorMessage && (
        <Alert type="error" showIcon message={activeTask.errorMessage} />
      )}

      <Space wrap style={{ justifyContent: 'flex-end', width: '100%' }}>
        <Button
          icon={<FolderOpenOutlined />}
          onClick={() => {
            const url = resultUrls[0] || taskCharImageUrl;
            if (url) window.open(url, '_blank');
            else message.info('没有可打开的文件');
          }}
        >
          打开目录
        </Button>
        <Button
          icon={<EditOutlined />}
          disabled={activeTask?.status !== 'failed'}
          onClick={openEdit}
        >
          编辑参数
        </Button>
        <Button danger icon={<DeleteOutlined />} onClick={() => activeTask && doDelete(activeTask.id)}>
          删除
        </Button>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          disabled={!resultUrls.length}
          onClick={() => resultUrls.forEach((u, i) => downloadUrl(u, `result-${activeTask?.id}-${i + 1}`))}
        >
          打包导出
        </Button>
      </Space>
    </Space>
  );

  const detailPane = activeTask ? (
    <Tabs
      items={[
        { key: 'preview', label: '预览', children: previewTab },
        { key: 'detail', label: '详情', children: detailTab },
      ]}
    />
  ) : (
    <Empty description="点击左侧任务查看详情" />
  );

  /* ---------- 渲染 ---------- */
  return (
    <Card title="视频工作区">
      {/* 顶部工具栏 */}
      <Row gutter={12} style={{ marginBottom: 16 }} align="middle">
        <Col flex="auto">
          <Space wrap>
            <Input.Search
              placeholder="搜索任务"
              allowClear
              onSearch={(v) => { setQ(v); setPage(1); }}
              style={{ width: 220 }}
            />
            <Select
              value={statusFilter}
              onChange={(v) => { setStatusFilter(v); setPage(1); }}
              style={{ width: 120 }}
              options={[
                { label: '全部', value: 'all' },
                { label: '待处理', value: 'pending' },
                { label: '执行中', value: 'running' },
                { label: '已完成', value: 'success' },
                { label: '失败', value: 'failed' },
              ]}
            />
            <Select
              value={`${sortField}:${sortOrder}`}
              onChange={(v) => {
                const [f, o] = (v as string).split(':');
                setSortField(f);
                setSortOrder(o as 'asc' | 'desc');
              }}
              style={{ width: 160 }}
              options={[
                { label: '按创建时间降序', value: 'createdAt:desc' },
                { label: '按创建时间升序', value: 'createdAt:asc' },
              ]}
            />
          </Space>
        </Col>
        <Col>
          <Space wrap>
            <Button danger icon={<DeleteOutlined />} disabled={!selectedRowKeys.length} onClick={onBatchDelete}>
              批量删除
            </Button>
            <Button icon={<DownloadOutlined />} disabled={!selectedRowKeys.length} onClick={onBatchExport}>
              批量打包导出
            </Button>
            <Button icon={<SyncOutlined />} onClick={() => loadTasks(page, pageSize)}>
              同步到服务端
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => loadTasks(page, pageSize)}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openModal}>
              新建任务
            </Button>
          </Space>
        </Col>
      </Row>

      <Row gutter={16} align="top">
        {/* 左侧任务表格 */}
        <Col xs={24} sm={24} md={24} lg={15} xl={15} style={{ position: 'relative', zIndex: 2 }}>
          <Table
            rowKey="id"
            rowSelection={rowSelection}
            columns={columns}
            dataSource={tasks}
            loading={loading}
            scroll={{ x: 720 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              showTotal: (t) => `共 ${t} 条归档`,
            }}
            onChange={(p) => {
              setPage(p.current || 1);
              setPageSize(p.pageSize || 10);
            }}
            onRow={(t) => ({ onClick: () => setActiveTask(t), style: { cursor: 'pointer' } })}
          />
        </Col>

        {/* 右侧详情面板 */}
        <Col xs={24} sm={24} md={24} lg={9} xl={9} style={{ position: 'relative', zIndex: 1 }}>
          <Card
            title={activeTask ? '任务详情' : '预览 / 详情'}
            styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflow: 'auto' } }}
            extra={
              activeTask && (
                <Button size="small" icon={<CloseOutlined />} onClick={() => setActiveTask(null)}>
                  关闭
                </Button>
              )
            }
          >
            {detailPane}
          </Card>
        </Col>
      </Row>

      {/* 新建任务弹窗 */}
      <Modal
        open={open}
        title="新建视频任务 · 选择素材"
        onCancel={() => setOpen(false)}
        footer={null}
        width={960}
        maskStyle={{ backdropFilter: 'blur(6px)', background: 'rgba(0,0,0,0.35)' }}
        destroyOnClose
      >
        {/* 本地上传区 */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col xs={24} md={12}>
            <Card size="small" title="上传参考图" styles={{ body: { minHeight: 100 } }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Upload
                  beforeUpload={(file) => { handleUploadImage(file); return false; }}
                  showUploadList={false}
                  accept="image/*"
                >
                  <Button icon={<UploadOutlined />} loading={uploadingImage}>
                    选择图片上传
                  </Button>
                </Upload>
                {imageUpload ? (
                  <Space>
                    <FileImageOutlined style={{ color: '#1677ff' }} />
                    <span style={{ fontSize: 13 }}>{imageUpload.filename}</span>
                    <Button size="small" type="link" onClick={() => { setImageUpload(null); saveDraft({ imageUploadId: undefined }); }}>
                      清除
                    </Button>
                  </Space>
                ) : (
                  <span style={{ fontSize: 12, color: '#888' }}>未上传图片，可从下方形象库选择</span>
                )}
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card size="small" title="上传音频" styles={{ body: { minHeight: 100 } }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Upload
                  beforeUpload={(file) => { handleUploadAudio(file); return false; }}
                  showUploadList={false}
                  accept="audio/*"
                >
                  <Button icon={<UploadOutlined />} loading={uploadingAudio}>
                    选择音频上传
                  </Button>
                </Upload>
                {audioUpload ? (
                  <Space>
                    <AudioOutlined style={{ color: '#1677ff' }} />
                    <span style={{ fontSize: 13 }}>{audioUpload.filename}</span>
                    <Button size="small" type="link" onClick={() => { setAudioUpload(null); saveDraft({ audioUploadId: undefined }); }}>
                      清除
                    </Button>
                  </Space>
                ) : (
                  <span style={{ fontSize: 12, color: '#888' }}>未上传音频，可从下方歌曲库选择</span>
                )}
              </Space>
            </Card>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Card size="small" title="形象库" styles={{ body: { maxHeight: 360, overflow: 'auto' } }}>
              <Input.Search placeholder="搜索形象" allowClear onSearch={(v) => listCharacters(v).then(setCharacters).catch(() => undefined)} style={{ marginBottom: 8 }} />
              <List
                dataSource={characters}
                renderItem={(c) => (
                  <List.Item onClick={() => onPickCharacter(c.id)} style={{ cursor: 'pointer', background: c.id === selCharId ? '#e6f4ff' : 'transparent', padding: '6px 8px', borderRadius: 6 }}>
                    <Space>
                      {c.coverUrl && <Image src={c.coverUrl} width={32} height={32} preview={false} style={{ borderRadius: 4 }} />}
                      <span>{c.name}</span>
                      {c.id === selCharId && <Tag color="blue">已选</Tag>}
                    </Space>
                  </List.Item>
                )}
              />
              {selCharId && (
                <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>选择一张风格图：</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {selCharImages.map((img) => (
                      <div key={img.id} style={{ width: 96, border: img.id === selImageId ? '2px solid #1677ff' : '1px solid #f0f0f0', borderRadius: 6, padding: 4 }}>
                        <Checkbox checked={img.id === selImageId} onChange={(e) => e.target.checked && onPickImage(img.id)}>
                          <span style={{ fontSize: 11 }}>{img.style}</span>
                        </Checkbox>
                        <Image src={img.url} width={84} height={84} style={{ objectFit: 'cover', borderRadius: 4, marginTop: 2 }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card size="small" title="歌曲库" styles={{ body: { maxHeight: 360, overflow: 'auto' } }}>
              <Input.Search placeholder="搜索歌曲" allowClear onSearch={(v) => listSongs(v, 'active').then(setSongs).catch(() => undefined)} style={{ marginBottom: 8 }} />
              <List
                dataSource={songs}
                renderItem={(s) => (
                  <List.Item onClick={() => onPickSong(s.id)} style={{ cursor: 'pointer', background: s.id === selSongId ? '#e6f4ff' : 'transparent', padding: '6px 8px', borderRadius: 6 }}>
                    <Space>
                      <span>{s.title}{s.artist ? ' - ' + s.artist : ''}</span>
                      {s.id === selSongId && <Tag color="blue">已选</Tag>}
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>创意描述（可选，会传给 Hedra 做提示词扩写）</div>
          <Input.TextArea rows={2} value={text} onChange={(e) => { setText(e.target.value); saveDraft({ text: e.target.value }); }} placeholder="例如：深情演唱，面向镜头，固定镜头" />
        </div>
        <div style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}><div style={{ fontSize: 13, marginBottom: 4 }}>生成秒数</div><InputNumber min={0} max={600} value={params.durationSeconds} onChange={(v) => setParams((p) => ({ ...p, durationSeconds: v || 0 }))} style={{ width: '100%' }} addonAfter="秒" /></Col>
            <Col span={12}><div style={{ fontSize: 13, marginBottom: 4 }}>音频起始秒</div><InputNumber min={0} max={180} value={params.audioStartSeconds} onChange={(v) => setParams((p) => ({ ...p, audioStartSeconds: v || 0 }))} style={{ width: '100%' }} addonAfter="秒" /></Col>
          </Row>
        </div>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Button type="primary" disabled={!canExecute} loading={submitting} onClick={onExecute}>开始执行</Button>
        </div>
      </Modal>

      {/* 编辑参数弹窗 */}
      <Modal
        open={editOpen}
        title="编辑参数并断点续跑"
        onCancel={() => setEditOpen(false)}
        onOk={onEditConfirm}
        confirmLoading={editLoading}
        okText="开始续跑"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>生成秒数</div>
            <InputNumber min={0} max={600} value={editParams.durationSeconds} onChange={(v) => setEditParams((p) => ({ ...p, durationSeconds: v || 0 }))} style={{ width: '100%' }} addonAfter="秒" />
          </div>
          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>音频起始秒</div>
            <InputNumber min={0} max={180} value={editParams.audioStartSeconds} onChange={(v) => setEditParams((p) => ({ ...p, audioStartSeconds: v || 0 }))} style={{ width: '100%' }} addonAfter="秒" />
          </div>
          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>最大分辨率</div>
            <InputNumber min={256} max={2048} value={editParams.maxResolution} onChange={(v) => setEditParams((p) => ({ ...p, maxResolution: v || 1024 }))} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>帧率</div>
            <InputNumber min={1} max={60} value={editParams.fps} onChange={(v) => setEditParams((p) => ({ ...p, fps: v || 25 }))} style={{ width: '100%' }} />
          </div>
        </Space>
      </Modal>
    </Card>
  );
}
