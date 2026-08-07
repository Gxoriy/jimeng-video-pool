import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Image,
  Input,
  InputNumber,
  Progress,
  Row,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { ClearOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  getJimengModels,
  listPrompts,
  type JimengModel,
  type Prompt,
} from '../api/pipeline';
import { useTaskSession } from '../context/TaskSession';
import { ImageSourcePicker, type ImageSourceValue } from '../components/SourcePickers';
import { api } from '../api/client';

/**
 * 即梦生成（图像 / 视频）—— 登录用户可见。
 *
 * 与三阶段流水线同一套任务体系：
 *  - 提交即创建 Task 记录，后台异步执行（不阻塞前端）
 *  - 进度/结果通过全局 TaskSession 持久化（刷新/切页不丢）
 *  - 接入共享提示词库、形象库、本地上传
 *  - 生成结果自动入库（media 表）
 */
export default function JimengGen() {
  const [models, setModels] = useState<{ image?: JimengModel[]; video?: JimengModel[] }>({});
  const [tab, setTab] = useState<'image' | 'video'>('image');
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  // 新用户适配：超级管理员且即梦账号池为空时，引导先导入账号
  const [needAccount, setNeedAccount] = useState(false);
  useEffect(() => {
    api
      .get('/auth/me')
      .then((r: any) => (r?.data?.role === 'super_admin' ? api.get('/admin/jimeng-accounts') : null))
      .then((r: any) => {
        if (!r) return;
        const d = r?.data?.data;
        const arr = Array.isArray(d) ? d : d?.data || [];
        if (arr.length === 0) setNeedAccount(true);
      })
      .catch(() => {});
  }, []);
  const { get: getSession, startJimengImage, startJimengVideo, clear, getDraft, patchDraft, clearDraft } =
    useTaskSession();

  const imageSess = getSession('jimeng_image');
  const videoSess = getSession('jimeng_video');
  const imageDraft = getDraft('jimeng_image');
  const videoDraft = getDraft('jimeng_video');

  const [imageForm] = Form.useForm();
  const [videoForm] = Form.useForm();

  // 参考图 / 首尾帧 状态
  const [imgRef, setImgRef] = useState<ImageSourceValue>(imageDraft.image || {});
  const [firstFrame, setFirstFrame] = useState<ImageSourceValue>(videoDraft.image || {});
  const [endFrame, setEndFrame] = useState<ImageSourceValue>(videoDraft.extra?.endFrame || {});

  useEffect(() => {
    getJimengModels()
      .then((r) => setModels(r || {}))
      .catch(() => {});
    listPrompts('action')
      .then(setPrompts)
      .catch(() => {});
  }, []);

  const imageOptions = (models.image || []).map((m) => ({ value: m.id, label: m.name }));
  const videoOptions = (models.video || []).map((m) => ({ value: m.id, label: m.name }));

  const setImgRefAndSave = (v: ImageSourceValue) => {
    setImgRef(v);
    patchDraft('jimeng_image', { image: v });
  };
  const setFirstFrameAndSave = (v: ImageSourceValue) => {
    setFirstFrame(v);
    patchDraft('jimeng_video', { image: v });
  };
  const setEndFrameAndSave = (v: ImageSourceValue) => {
    setEndFrame(v);
    patchDraft('jimeng_video', { extra: { ...videoDraft.extra, endFrame: v } });
  };

  /* ---------------- 图像生成 ---------------- */

  const onGenImage = async () => {
    const v = await imageForm.validateFields();
    try {
      await startJimengImage({
        model: v.model,
        prompt: v.prompt,
        ratio: v.ratio,
        resolution: v.resolution,
        sampleStrength: v.sampleStrength,
        negativePrompt: v.negativePrompt,
        filePath: v.filePath,
        imageUploadId: imgRef.imageUploadId,
        characterId: imgRef.characterId,
        characterImageId: imgRef.characterImageId,
        saveToCharacterId: v.saveToCharacterId,
        newCharacterName: v.newCharacterName,
        newCharacterTags: v.newCharacterTags,
      });
      message.success('已提交即梦图像生成任务');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '提交失败');
    }
  };

  /* ---------------- 视频生成 ---------------- */

  const onGenVideo = async () => {
    const v = await videoForm.validateFields();
    try {
      await startJimengVideo({
        model: v.model,
        prompt: v.prompt,
        ratio: v.ratio,
        resolution: v.resolution,
        duration: v.duration,
        firstFrameUploadId: firstFrame.imageUploadId,
        firstFrameCharacterId: firstFrame.characterId,
        endFrameUploadId: endFrame.imageUploadId,
        endFrameCharacterId: endFrame.characterId,
      });
      message.success('已提交即梦视频生成任务');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '提交失败');
    }
  };

  /* ---------------- 状态提示 ---------------- */

  const imageRunning = imageSess.status === 'pending' || imageSess.status === 'running';
  const videoRunning = videoSess.status === 'pending' || videoSess.status === 'running';

  const imageStatusRef = useRef<string | undefined>(undefined);
  const videoStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (imageSess.status && imageSess.status !== imageStatusRef.current) {
      if (imageSess.status === 'success') message.success('即梦图像生成完成');
      else if (imageSess.status === 'failed') message.error(imageSess.error || '生成失败');
      imageStatusRef.current = imageSess.status;
    }
  }, [imageSess.status, imageSess.error]);
  useEffect(() => {
    if (videoSess.status && videoSess.status !== videoStatusRef.current) {
      if (videoSess.status === 'success') message.success('即梦视频生成完成');
      else if (videoSess.status === 'failed') message.error(videoSess.error || '生成失败');
      videoStatusRef.current = videoSess.status;
    }
  }, [videoSess.status, videoSess.error]);

  const resetImageAll = () => {
    imageForm.resetFields();
    setImgRef({});
    clearDraft('jimeng_image');
    clear('jimeng_image');
    imageStatusRef.current = undefined;
  };
  const resetVideoAll = () => {
    videoForm.resetFields();
    setFirstFrame({});
    setEndFrame({});
    clearDraft('jimeng_video');
    clear('jimeng_video');
    videoStatusRef.current = undefined;
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="即梦生成（图像 / 视频）"
        description="调用本地号池（按积分加权选号）。任务后台异步执行，切换页面不会中断，刷新不丢数据。结果自动存入素材库。"
      />
      {needAccount && (
        <Alert
          type="warning"
          showIcon
          closable
          message="即梦账号池暂无账号"
          description={
            <>
              即梦生成需要可用的 cookie 账号。请先到{' '}
              <a href="#/jimeng-accounts">即梦账号池</a>{' '}
              导入即梦 Cookie；否则提交的任务会因无可用账号而失败。
            </>
          }
        />
      )}

      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as 'image' | 'video')}
          items={[
            {
              key: 'image',
              label: (
                <span>
                  <ThunderboltOutlined /> 图像生成
                  {imageRunning && <Tag color="processing" style={{ marginLeft: 6 }}>进行中</Tag>}
                </span>
              ),
              children: (
                <Form
                  form={imageForm}
                  layout="vertical"
                  initialValues={{
                    resolution: '2k',
                    ratio: '1:1',
                    ...imageDraft.form,
                  }}
                  onValuesChange={(_c, all) => patchDraft('jimeng_image', { form: all })}
                >
                  {/* 提示词 + 提示词库 */}
                  <Form.Item label="提示词" required>
                    <Space.Compact style={{ width: '100%' }}>
                      <Form.Item name="prompt" noStyle rules={[{ required: true, message: '请填写提示词' }]}>
                        <Input.TextArea rows={3} placeholder="描述要生成的图像" />
                      </Form.Item>
                    </Space.Compact>
                    <Select
                      allowClear
                      showSearch
                      style={{ width: '100%', marginTop: 8 }}
                      placeholder="从提示词库中选择（可选，会覆盖上方输入）"
                      optionFilterProp="label"
                      onChange={(id) => {
                        const p = prompts.find((x) => x.id === id);
                        if (p) {
                          imageForm.setFieldValue('prompt', p.content);
                          patchDraft('jimeng_image', { form: { ...imageForm.getFieldsValue(), prompt: p.content } });
                        }
                      }}
                      options={prompts.map((p) => ({
                        value: p.id,
                        label: `${p.title}${p.category ? ` [${p.category}]` : ''}`,
                      }))}
                    />
                  </Form.Item>

                  <Form.Item name="model" label="模型">
                    <Select showSearch allowClear placeholder="默认模型" options={imageOptions} />
                  </Form.Item>

                  <Row gutter={16}>
                    <Col xs={12} md={6}>
                      <Form.Item name="ratio" label="比例">
                        <Select
                          options={[
                            { value: '1:1', label: '1:1' },
                            { value: '3:4', label: '3:4' },
                            { value: '4:3', label: '4:3' },
                            { value: '9:16', label: '9:16' },
                            { value: '16:9', label: '16:9' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="resolution" label="分辨率">
                        <Select
                          options={[
                            { value: '1k', label: '1K' },
                            { value: '2k', label: '2K' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="negativePrompt" label="反向提示词（可选）">
                        <Input.TextArea rows={1} />
                      </Form.Item>
                    </Col>
                  </Row>

                  {/* 参考图来源 */}
                  <Form.Item label="参考图（可选：本地上传 / 形象库 / URL）">
                    <ImageSourcePicker value={imgRef} onChange={setImgRefAndSave} />
                  </Form.Item>
                  <Form.Item name="filePath" label="或输入图片 URL（可选）" extra="与上方来源三选一，远程 URL 或 base64">
                    <Input placeholder="https://..." />
                  </Form.Item>

                  {/* 保存到形象库 */}
                  <Form.Item label="生成结果保存到形象库（可选）">
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Form.Item name="saveToCharacterId" noStyle>
                        <Input placeholder="已有形象 ID（可选）" />
                      </Form.Item>
                      <Form.Item name="newCharacterName" noStyle>
                        <Input placeholder="或新建形象名称（可选）" />
                      </Form.Item>
                    </Space>
                  </Form.Item>

                  <Space>
                    <Button type="primary" loading={imageRunning} onClick={onGenImage}>
                      生成图像
                    </Button>
                    <Button icon={<ClearOutlined />} onClick={resetImageAll} disabled={imageRunning}>
                      清空
                    </Button>
                    {imageSess.statusText && !imageRunning && (
                      <Typography.Text type="secondary">{imageSess.statusText}</Typography.Text>
                    )}
                    {imageSess.results.length > 0 && !imageRunning && (
                      <Button danger type="link" onClick={() => clear('jimeng_image')}>
                        重新生成
                      </Button>
                    )}
                  </Space>

                  {imageRunning && <Progress percent={100} status="active" showInfo={false} style={{ marginTop: 12 }} />}
                </Form>
              ),
            },
            {
              key: 'video',
              label: (
                <span>
                  <ThunderboltOutlined /> 视频生成
                  {videoRunning && <Tag color="processing" style={{ marginLeft: 6 }}>进行中</Tag>}
                </span>
              ),
              children: (
                <Form
                  form={videoForm}
                  layout="vertical"
                  initialValues={{
                    resolution: '1080p',
                    ratio: '16:9',
                    duration: 5,
                    ...videoDraft.form,
                  }}
                  onValuesChange={(_c, all) => patchDraft('jimeng_video', { form: all })}
                >
                  <Form.Item label="提示词" required>
                    <Form.Item name="prompt" noStyle rules={[{ required: true, message: '请填写提示词' }]}>
                      <Input.TextArea rows={3} placeholder="描述要生成的视频" />
                    </Form.Item>
                    <Select
                      allowClear
                      showSearch
                      style={{ width: '100%', marginTop: 8 }}
                      placeholder="从提示词库中选择（可选，会覆盖上方输入）"
                      optionFilterProp="label"
                      onChange={(id) => {
                        const p = prompts.find((x) => x.id === id);
                        if (p) {
                          videoForm.setFieldValue('prompt', p.content);
                          patchDraft('jimeng_video', { form: { ...videoForm.getFieldsValue(), prompt: p.content } });
                        }
                      }}
                      options={prompts.map((p) => ({
                        value: p.id,
                        label: `${p.title}${p.category ? ` [${p.category}]` : ''}`,
                      }))}
                    />
                  </Form.Item>

                  <Form.Item name="model" label="模型">
                    <Select showSearch allowClear placeholder="默认模型" options={videoOptions} />
                  </Form.Item>

                  <Row gutter={16}>
                    <Col xs={12} md={6}>
                      <Form.Item name="ratio" label="比例">
                        <Select
                          options={[
                            { value: '1:1', label: '1:1' },
                            { value: '16:9', label: '16:9' },
                            { value: '9:16', label: '9:16' },
                            { value: '4:3', label: '4:3' },
                            { value: '3:4', label: '3:4' },
                            { value: '21:9', label: '21:9' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="resolution" label="分辨率">
                        <Select
                          options={[
                            { value: '480p', label: '480P' },
                            { value: '720p', label: '720P' },
                            { value: '1080p', label: '1080P' },
                            { value: '4k', label: '4K' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="duration" label="时长(秒)">
                        <InputNumber min={5} max={10} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>

                  {/* 首帧 */}
                  <Form.Item label="首帧图（可选：本地上传 / 形象库）">
                    <ImageSourcePicker value={firstFrame} onChange={setFirstFrameAndSave} allowPickImage={false} />
                  </Form.Item>

                  {/* 尾帧 */}
                  <Form.Item label="尾帧图（可选：本地上传 / 形象库）">
                    <ImageSourcePicker value={endFrame} onChange={setEndFrameAndSave} allowPickImage={false} />
                  </Form.Item>

                  <Space>
                    <Button type="primary" loading={videoRunning} onClick={onGenVideo}>
                      生成视频
                    </Button>
                    <Button icon={<ClearOutlined />} onClick={resetVideoAll} disabled={videoRunning}>
                      清空
                    </Button>
                    {videoSess.statusText && !videoRunning && (
                      <Typography.Text type="secondary">{videoSess.statusText}</Typography.Text>
                    )}
                    {videoSess.results.length > 0 && !videoRunning && (
                      <Button danger type="link" onClick={() => clear('jimeng_video')}>
                        重新生成
                      </Button>
                    )}
                  </Space>

                  {videoRunning && <Progress percent={100} status="active" showInfo={false} style={{ marginTop: 12 }} />}
                </Form>
              ),
            },
          ]}
        />
      </Card>

      {/* 生成结果 */}
      {tab === 'image' && imageSess.results.length > 0 && (
        <Card title="图像生成结果" extra={<Tag color="green">{imageSess.results.length} 张</Tag>}>
          <Image.PreviewGroup>
            <Space wrap>
              {imageSess.results.map((u, i) => (
                <Image key={i} src={u} width={200} style={{ borderRadius: 6 }} />
              ))}
            </Space>
          </Image.PreviewGroup>
        </Card>
      )}
      {tab === 'video' && videoSess.results.length > 0 && (
        <Card title="视频生成结果" extra={<Tag color="green">{videoSess.results.length} 个</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {videoSess.results.map((u, i) => (
              <video key={i} src={u} controls style={{ width: '100%', maxWidth: 640, borderRadius: 6 }} />
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
}
