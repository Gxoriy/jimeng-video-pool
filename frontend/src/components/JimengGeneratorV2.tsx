import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Button, Upload, message, Dropdown, Tag, Tooltip, Image, Space, Select, Radio, Modal, InputNumber, Progress, Typography
} from 'antd';
import {
  PlusOutlined, VideoCameraOutlined, PictureOutlined, CustomerServiceOutlined,
  CloseOutlined, ClockCircleOutlined, SendOutlined, AppstoreOutlined,
  FireOutlined, ExperimentOutlined, PlayCircleOutlined, SoundOutlined,
  DeleteOutlined, UploadOutlined, ArrowsAltOutlined, CompressOutlined,
  QuestionCircleOutlined, ThunderboltOutlined, InfoCircleOutlined
} from '@ant-design/icons';
import type { MenuProps } from 'antd';

// ================= 类型定义 =================

/** 参考素材类型 */
export type ReferenceType = 'image' | 'video' | 'audio' | 'character';

/** 单个参考素材 */
export interface ReferenceItem {
  id: string;
  type: ReferenceType;
  name: string;
  url: string;
  uploadId?: string;       // 本地上传ID
  characterId?: string;    // 形象库ID
  characterImageId?: string;
  /** 用于@引用的显示名，如 "图片1"、"视频1" */
  mentionLabel: string;
}

/** 全能参考模式 */
export type OmniRefMode = 'off' | 'character' | 'motion' | 'style' | 'omni';

/** 视频生成参数 */
export interface VideoGenParams {
  prompt: string;
  model: string;
  ratio: string;
  resolution: string;
  duration: number;
  mode: OmniRefMode;
  references: ReferenceItem[];
  firstFrameUploadId?: string;
  endFrameUploadId?: string;
}

/** 图片生成参数 */
export interface ImageGenParams {
  prompt: string;
  model: string;
  ratio: string;
  references: ReferenceItem[];
}

// ================= 常量 =================

const MAX_REFERENCES = 12;
const MAX_PROMPT_LENGTH = 135;

const OMNI_REF_MODES: { key: OmniRefMode; label: string; icon: React.ReactNode; desc: string; cost?: number }[] = [
  { key: 'off', label: '关闭', icon: <CloseOutlined />, desc: '不使用全能参考' },
  { key: 'character', label: '角色参考', icon: <CustomerServiceOutlined />, desc: '保持角色一致性', cost: 6 },
  { key: 'motion', label: '动作参考', icon: <PlayCircleOutlined />, desc: '参考视频动作', cost: 8 },
  { key: 'style', label: '风格参考', icon: <PictureOutlined />, desc: '参考图片风格', cost: 5 },
  { key: 'omni', label: '全能参考', icon: <AppstoreOutlined />, desc: '组合图/文/音/视频多元素', cost: 10 },
];

const RATIO_OPTIONS = ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9', '9:21'];
const RESOLUTION_OPTIONS = ['720P', '1080P'];
const DURATION_OPTIONS = [5, 10, 15];
const VIDEO_MODELS = [
  { value: 'seedance-2.0-mini', label: '即梦 Seedance 2.0 mini' },
  { value: 'seedance-1.0-pro', label: '即梦 Seedance 1.0 pro' },
];
const IMAGE_MODELS = [
  { value: 'jimeng-5.0', label: '即梦图片 5.0' },
  { value: 'jimeng-4.6', label: '即梦图片 4.6' },
  { value: 'jimeng-4.5', label: '即梦图片 4.5' },
  { value: 'jimeng-4.1', label: '即梦图片 4.1' },
  { value: 'jimeng-4.0', label: '即梦图片 4.0' },
];

// ================= 积分预估 =================

function estimateCredits(params: VideoGenParams | ImageGenParams, isVideo: boolean): number {
  let base = isVideo ? 4 : 2;
  
  if (isVideo) {
    const vp = params as VideoGenParams;
    // 分辨率加成
    if (vp.resolution === '1080P') base += 2;
    // 时长加成
    base += Math.floor(vp.duration / 5);
    // 全能参考模式消耗
    const modeCost = OMNI_REF_MODES.find(m => m.key === vp.mode)?.cost || 0;
    base += modeCost;
    // 每个参考素材+1积分
    base += vp.references.length;
  } else {
    const ip = params as ImageGenParams;
    base += ip.references.length * 2;
  }
  
  return base;
}

// ================= 子组件：@提及选择器 =================

interface MentionPickerProps {
  references: ReferenceItem[];
  onInsert: (ref: ReferenceItem) => void;
  onOpenUpload: (type: ReferenceType) => void;
}

function MentionPicker({ references, onInsert, onOpenUpload }: MentionPickerProps) {
  const [open, setOpen] = useState(false);

  const imageRefs = references.filter(r => r.type === 'image');
  const videoRefs = references.filter(r => r.type === 'video');
  const audioRefs = references.filter(r => r.type === 'audio');
  const charRefs = references.filter(r => r.type === 'character');

  const menuItems: MenuProps['items'] = [
    ...(imageRefs.length ? [{
      type: 'group' as const,
      label: '📷 图片',
      children: imageRefs.map(ref => ({
        key: ref.id,
        label: (
          <Space>
            <Image src={ref.url} width={24} height={24} style={{ borderRadius: 4, objectFit: 'cover' }} preview={false} />
            <span>{ref.mentionLabel}</span>
            <span style={{ color: '#999', fontSize: 11 }}>{ref.name}</span>
          </Space>
        ),
        onClick: () => { onInsert(ref); setOpen(false); },
      }))
    }] : []),
    ...(videoRefs.length ? [{
      type: 'group' as const,
      label: '🎬 视频',
      children: videoRefs.map(ref => ({
        key: ref.id,
        label: (
          <Space>
            <PlayCircleOutlined style={{ color: '#52c41a' }} />
            <span>{ref.mentionLabel}</span>
            <span style={{ color: '#999', fontSize: 11 }}>{ref.name}</span>
          </Space>
        ),
        onClick: () => { onInsert(ref); setOpen(false); },
      }))
    }] : []),
    ...(audioRefs.length ? [{
      type: 'group' as const,
      label: '🎵 音频',
      children: audioRefs.map(ref => ({
        key: ref.id,
        label: (
          <Space>
            <SoundOutlined style={{ color: '#faad14' }} />
            <span>{ref.mentionLabel}</span>
            <span style={{ color: '#999', fontSize: 11 }}>{ref.name}</span>
          </Space>
        ),
        onClick: () => { onInsert(ref); setOpen(false); },
      }))
    }] : []),
    ...(charRefs.length ? [{
      type: 'group' as const,
      label: '👤 形象',
      children: charRefs.map(ref => ({
        key: ref.id,
        label: (
          <Space>
            <CustomerServiceOutlined style={{ color: '#722ed1' }} />
            <span>{ref.mentionLabel}</span>
          </Space>
        ),
        onClick: () => { onInsert(ref); setOpen(false); },
      }))
    }] : []),
    { type: 'divider' as const },
    {
      key: 'upload-image',
      label: <Space><PlusOutlined />上传图片</Space>,
      onClick: () => { onOpenUpload('image'); setOpen(false); },
    },
    {
      key: 'upload-video',
      label: <Space><PlusOutlined />上传视频</Space>,
      onClick: () => { onOpenUpload('video'); setOpen(false); },
    },
    {
      key: 'upload-audio',
      label: <Space><PlusOutlined />上传音频</Space>,
      onClick: () => { onOpenUpload('audio'); setOpen(false); },
    },
  ];

  if (references.length === 0 && false) { // always show for upload capability
    return null;
  }

  return (
    <Dropdown
      menu={{ items: menuItems }}
      trigger={['click']}
      open={open}
      onOpenChange={setOpen}
      placement="topLeft"
      overlayStyle={{ maxHeight: 360, overflow: 'auto' }}
    >
      <Button
        type="text"
        size="small"
        icon={<span style={{ fontWeight: 700, fontSize: 15 }}>@</span>}
        style={{
          borderRadius: 20,
          border: '1px solid #d9d9d9',
          fontWeight: 600,
          color: references.length > 0 ? '#1677ff' : '#999',
        }}
      >
        @
      </Button>
    </Dropdown>
  );
}

// ================= 子组件：全能参考面板 =================

interface OmniRefPanelProps {
  mode: OmniRefMode;
  onChange: (mode: OmniRefMode) => void;
  references: ReferenceItem[];
  onAddReference: (type: ReferenceType) => void;
  onRemoveReference: (id: string) => void;
  uploading: boolean;
}

function OmniRefPanel({ mode, onChange, references, onAddReference, onRemoveReference, uploading }: OmniRefPanelProps) {
  const [expanded, setExpanded] = useState(mode !== 'off');

  useEffect(() => {
    setExpanded(mode !== 'off');
  }, [mode]);

  return (
    <div className="omni-ref-panel">
      {/* 模式选择下拉 */}
      <Dropdown
        menu={{
          items: OMNI_REF_MODES.map(m => ({
            key: m.key,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <span style={{ fontSize: 16 }}>{m.icon}</span>
                <div>
                  <div>{m.label}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{m.desc} {m.cost ? `(${m.cost}积分)` : ''}</div>
                </div>
              </div>
            ),
            onClick: () => onChange(m.key),
          })),
          selectedKeys: [mode],
        }}
        trigger={['click']}
        placement="bottomLeft"
      >
        <Button
          icon={<AppstoreOutlined />}
          className={`omni-mode-btn ${mode !== 'off' ? 'active' : ''}`}
        >
          <Space size={4}>
            {OMNI_REF_MODES.find(m => m.key === mode)?.icon}
            <span>{OMNI_REF_MODES.find(m => m.key === mode)?.label || '全能参考'}</span>
          </Space>
        </Button>
      </Dropdown>

      {/* 展开的参考素材区 */}
      {expanded && (
        <div className="omni-ref-content">
          <div className="omni-ref-header">
            <span className="omni-ref-title">
              <ExperimentOutlined /> 参考素材 ({references.length}/{MAX_REFERENCES})
            </span>
            <Space size={4}>
              <Tooltip title="上传图片">
                <Button
                  size="small"
                  icon={<PictureOutlined />}
                  onClick={() => onAddReference('image')}
                  loading={uploading}
                  disabled={references.length >= MAX_REFERENCES}
                />
              </Tooltip>
              <Tooltip title="上传视频">
                <Button
                  size="small"
                  icon={<PlayCircleOutlined />}
                  onClick={() => onAddReference('video')}
                  loading={uploading}
                  disabled={references.length >= MAX_REFERENCES}
                />
              </Tooltip>
              <Tooltip title="上传音频">
                <Button
                  size="small"
                  icon={<SoundOutlined />}
                  onClick={() => onAddReference('audio')}
                  loading={uploading}
                  disabled={references.length >= MAX_REFERENCES}
                />
              </Tooltip>
            </Space>
          </div>

          {/* 素材列表 */}
          {references.length > 0 ? (
            <div className="omni-ref-list">
              {references.map((ref, idx) => (
                <div key={ref.id} className="omni-ref-item" data-type={ref.type}>
                  <div className="omni-ref-item-inner">
                    {ref.type === 'image' && (
                      <Image src={ref.url} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} preview={false} />
                    )}
                    {ref.type === 'video' && (
                      <div className="omni-ref-video-thumb">
                        <PlayCircleOutlined style={{ fontSize: 20 }} />
                        {ref.url && <video src={ref.url} muted style={{ display: 'none' }} />}
                      </div>
                    )}
                    {ref.type === 'audio' && (
                      <div className="omni-ref-audio-thumb">
                        <SoundOutlined style={{ fontSize: 18 }} />
                        {ref.url && <audio src={ref.url} style={{ display: 'none' }} />}
                      </div>
                    )}
                    {ref.type === 'character' && (
                      <div className="omni-ref-char-thumb">
                        <CustomerServiceOutlined style={{ fontSize: 18 }} />
                      </div>
                    )}
                    <div className="omni-ref-item-overlay">
                      <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{ref.mentionLabel}</Tag>
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => onRemoveReference(ref.id)}
                        style={{ width: 20, height: 20, padding: 0, minWidth: 0 }}
                      />
                    </div>
                  </div>
                  <div className="omni-ref-item-name">{ref.name}</div>
                </div>
              ))}
              {/* 添加更多占位 */}
              {Array.from({ length: Math.max(0, 4 - (references.length % 4 || 4)) }).map((_, i) => (
                <div key={`placeholder-${i}`} className="omni-ref-item placeholder" onClick={() => {
                  if (references.length < MAX_REFERENCES) onAddReference('image');
                }}>
                  <PlusOutlined style={{ fontSize: 20, color: '#bbb' }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="omni-ref-empty" onClick={() => onAddReference('image')}>
              <PlusOutlined style={{ fontSize: 24, color: '#bbb', marginBottom: 8 }} />
              <div style={{ color: '#999', fontSize: 13 }}>点击或拖拽上传参考素材</div>
              <div style={{ color: '#bbb', fontSize: 11 }}>支持图片、视频、音频，最多{MAX_REFERENCES}个</div>
            </div>
          )}

          {/* 提示文字 */}
          <div className="omni-ref-hint">
            <InfoCircleOutlined /> 在输入框中输入 @ 可引用素材，如：
            <Tag color="blue" style={{ margin: '0 4px' }}>@图片1</Tag>模仿
            <Tag color="green" style={{ margin: '0 4px' }}>@视频1</Tag>的动作
          </div>
        </div>
      )}
    </div>
  );
}

// ================= 主组件：即梦生成器（新版） =================

interface JimengGeneratorV2Props {
  /** 当前Tab: video | image */
  activeTab?: 'video' | 'image';
  onTabChange?: (tab: 'video' | 'image') => void;
  /** 提交回调 */
  onSubmitVideo?: (params: VideoGenParams) => Promise<void>;
  onSubmitImage?: (params: ImageGenParams) => Promise<void>;
  /** 上传回调 */
  onUploadFile?: (category: 'image' | 'video' | 'audio', file: File) => Promise<{ id: string; url: string }>;
  /** 获取形象列表 */
  characters?: Array<{ id: string; name: string; coverUrl: string }>;
  /** 是否正在生成 */
  generating?: boolean;
  /** 进度 0-100 */
  progress?: number;
  /** 用户积分余额 */
  userCredits?: number;
}

export default function JimengGeneratorV2({
  activeTab = 'video',
  onTabChange,
  onSubmitVideo,
  onSubmitImage,
  onUploadFile,
  characters = [],
  generating = false,
  progress = 0,
  userCredits,
}: JimengGeneratorV2Props) {
  // ========== 状态 ==========
  const [prompt, setPrompt] = useState('');
  const [videoModel, setVideoModel] = useState('seedance-2.0-mini');
  const [imageModel, setImageModel] = useState('jimeng-5.0');
  const [ratio, setRatio] = useState('16:9');
  const [resolution, setResolution] = useState('720P');
  const [duration, setDuration] = useState(10);
  const [omniMode, setOmniMode] = useState<OmniRefMode>('off');
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [uploading, setUploading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUploadType, setPendingUploadType] = useState<ReferenceType>('image');

  // ========== 计算预估积分 ==========
  const currentParams: VideoGenParams | ImageGenParams = activeTab === 'video'
    ? { prompt, model: videoModel, ratio, resolution, duration, mode: omniMode, references }
    : { prompt, model: imageModel, ratio, references };
  const estimatedCredits = estimateCredits(currentParams, activeTab === 'video');

  // ========== @插入处理 ==========
  const handleMentionInsert = useCallback((ref: ReferenceItem) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const mentionText = `@${ref.mentionLabel}`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newPrompt = prompt.substring(0, start) + mentionText + prompt.substring(end);
    setPrompt(newPrompt);

    // 恢复光标位置
    setTimeout(() => {
      const newPos = start + mentionText.length;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  }, [prompt]);

  // ========== 上传处理 ==========
  const handleAddReference = useCallback(async (type: ReferenceType) => {
    if (type === 'character') {
      // TODO: 弹出形象选择器
      message.info('形象库选择功能开发中');
      return;
    }

    // 创建文件输入
    const acceptMap = { image: 'image/*', video: 'video/*', audio: 'audio/*' };
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptMap[type];
    input.multiple = false; // 单个上传，可多次调用
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || !onUploadFile) return;

      if (references.length >= MAX_REFERENCES) {
        message.warning(`最多支持 ${MAX_REFERENCES} 个参考素材`);
        return;
      }

      setUploading(true);
      try {
        const result = await onUploadFile(type, file);
        const typeLabels = { image: '图片', video: '视频', audio: '音频' };
        const typeCount = references.filter(r => r.type === type).length + 1;
        const newItem: ReferenceItem = {
          id: `${type}_${Date.now()}`,
          type,
          name: file.name,
          url: result.url,
          uploadId: result.id,
          mentionLabel: `${typeLabels[type]}${typeCount}`,
        };
        setReferences(prev => [...prev, newItem]);
        message.success(`${typeLabels[type]}已添加为参考素材`);

        // 如果是关闭状态，自动切换到对应模式
        if (omniMode === 'off') {
          setOmniMode(type === 'video' ? 'motion' : type === 'audio' ? 'style' : 'style');
        }
      } catch (err: any) {
        message.error(err?.message || '上传失败');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }, [references.length, omniMode, onUploadFile]);

  const handleOpenUploadFromMention = (type: ReferenceType) => {
    handleAddReference(type);
  };

  const handleRemoveReference = (id: string) => {
    setReferences(prev => prev.filter(r => r.id !== id));
  };

  // ========== 提交处理 ==========
  const handleSubmit = async () => {
    if (!prompt.trim()) {
      message.warning('请输入提示词');
      return;
    }
    if (activeTab === 'video') {
      await onSubmitVideo?.(currentParams as VideoGenParams);
    } else {
      await onSubmitImage?.(currentParams as ImageGenParams);
    }
  };

  // ========== 键盘快捷键 ==========
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter 发送
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    // @ 键打开选择器
    if (e.key === '@') {
      // 由 MentionPicker 组件的 dropdown 处理
    }
  };

  // ========== 渲染 ==========
  return (
    <div className="jimeng-generator-v2">
      {/* ====== 顶部 Tab 切换 ====== */}
      <div className="jg-header">
        <div className="jg-tabs">
          <button
            className={`jg-tab ${activeTab === 'video' ? 'active' : ''}`}
            onClick={() => onTabChange?.('video')}
          >
            <VideoCameraOutlined /> 视频生成
          </button>
          <button
            className={`jg-tab ${activeTab === 'image' ? 'active' : ''}`}
            onClick={() => onTabChange?.('image')}
          >
            <PictureOutlined /> 图片生成
          </button>
        </div>

        {/* 积分显示 */}
        {userCredits !== undefined && (
          <div className="jg-credits">
            <ThunderboltOutlined style={{ color: '#faad14' }} />
            <span>{userCredits}</span>
            {estimatedCredits > 0 && (
              <Tag color="orange" style={{ marginLeft: 8 }}>
                预计消耗 ~{estimatedCredits}
              </Tag>
            )}
          </div>
        )}
      </div>

      {/* ====== 输入区域 ====== */}
      <div className="jg-input-area">
        <div className="jg-textarea-wrap">
          <textarea
            ref={textareaRef}
            className="jg-prompt-input"
            placeholder="上传最多12个参考素材，输入文字或 @ 参考内容，自由组合图、文、音、视频多元素，定义精彩互动。例如：@图片1 模仿 @视频1 的动作，音色参考 @音频1。"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
            onKeyDown={handleKeyDown}
            rows={4}
            maxLength={MAX_PROMPT_LENGTH}
          />

          {/* 浮动在右下角的提示词占位 */}
          {!prompt.trim() && (
            <div className="jg-placeholder-hint">请输入提示词</div>
          )}
        </div>

        {/* 底部工具栏 */}
        <div className="jg-toolbar">
          {/* 左侧：功能按钮组 */}
          <div className="jg-toolbar-left">
            {/* Tab: 视频生成 时显示模型选择 */}
            {activeTab === 'video' && (
              <Dropdown
                menu={{
                  items: VIDEO_MODELS.map(m => ({
                    key: m.value,
                    label: m.label,
                    onClick: () => setVideoModel(m.value),
                  })),
                  selectedKeys: [videoModel],
                }}
                trigger={['click']}
              >
                <Button size="small" className="jg-tool-btn model-btn">
                  <FireOutlined /> {VIDEO_MODELS.find(m => m.value === videoModel)?.label || '模型'} +
                </Button>
              </Dropdown>
            )}

            {/* 全能参考面板 */}
            <OmniRefPanel
              mode={omniMode}
              onChange={setOmniMode}
              references={references}
              onAddReference={handleAddReference}
              onRemoveReference={handleRemoveReference}
              uploading={uploading}
            />

            {/* 比例选择 */}
            <Dropdown
              menu={{
                items: RATIO_OPTIONS.map(r => ({
                  key: r,
                  label: r,
                  onClick: () => setRatio(r),
                })),
                selectedKeys: [ratio],
              }}
              trigger={['click']}
            >
              <Button size="small" className="jg-tool-btn">
                <ArrowsAltOutlined /> {ratio}
              </Button>
            </Dropdown>

            {/* 分辨率（仅视频） */}
            {activeTab === 'video' && (
              <Dropdown
                menu={{
                  items: RESOLUTION_OPTIONS.map(r => ({
                    key: r,
                    label: r,
                    onClick: () => setResolution(r),
                  })),
                  selectedKeys: [resolution],
                }}
                trigger={['click']}
              >
                <Button size="small" className="jg-tool-btn">
                  {resolution} <PlusOutlined style={{ fontSize: 10 }} />
                </Button>
              </Dropdown>
            )}

            {/* 时长（仅视频） */}
            {activeTab === 'video' && (
              <Dropdown
                menu={{
                  items: DURATION_OPTIONS.map(d => ({
                    key: String(d),
                    label: `${d}s`,
                    onClick: () => setDuration(d),
                  })),
                  selectedKeys: [String(duration)],
                }}
                trigger={['click']}
              >
                <Button size="small" className="jg-tool-btn">
                  <ClockCircleOutlined /> {duration}s
                </Button>
              </Dropdown>
            )}

            {/* @ 选择器 */}
            <MentionPicker
              references={references}
              onInsert={handleMentionInsert}
              onOpenUpload={handleOpenUploadFromMention}
            />
          </div>

          {/* 右侧：字数统计 & 发送按钮 */}
          <div className="jg-toolbar-right">
            <span className={`jg-char-count ${prompt.length > MAX_PROMPT_LENGTH * 0.9 ? 'warning' : ''}`}>
              {prompt.length} <span className="sep">/</span> {MAX_PROMPT_LENGTH}
            </span>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSubmit}
              loading={generating}
              className="jg-send-btn"
            >
              生成
            </Button>
          </div>
        </div>
      </div>

      {/* ====== 生成进度 ====== */}
      {generating && progress > 0 && (
        <div className="jg-progress-area">
          <Progress percent={progress} status="active" strokeColor={{ from: '#6366f1', to: '#a855f7' }} />
          <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
            正在生成中... 请耐心等待
          </Typography.Text>
        </div>
      )}
    </div>
  );
}
