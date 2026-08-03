import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Steps,
  Typography,
  message,
} from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { Channel, listChannels } from '../api/pipeline';
import { useTaskSession } from '../context/TaskSession';
import {
  AudioSourcePicker,
  AudioSourceValue,
  ImageSourcePicker,
  ImageSourceValue,
} from '../components/SourcePickers';

/**
 * 获取灵感（第一步）
 * 参考图（上传/形象库） + 参考音频（上传/歌曲库） -> 产出两类提示词：
 *   1) 形象提示词：以参考图人物为主体，按歌词情绪换背景/服装，用于「生成形象」
 *   2) 动作提示词：用于「视频生成」驱动数字人表演
 * 执行方：管理员配置的 AI 渠道（建议选支持读图的模型）
 *
 * 两类提示词都保存在全局 TaskSession（跨路由切换 / 整页刷新都不丢失）。
 */
export default function Inspiration() {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { get: getSession, startInspiration, clear, getDraft, patchDraft, clearDraft } =
    useTaskSession();
  const sess = getSession('inspiration');
  const draft = getDraft('inspiration');

  const [channels, setChannels] = useState<Channel[]>([]);
  const [img, setImgState] = useState<ImageSourceValue>(draft.image || {});
  const [audio, setAudioState] = useState<AudioSourceValue>(draft.audio || {});

  // 素材选择同步进草稿，刷新后不丢
  const setImg = (v: ImageSourceValue) => {
    setImgState(v);
    patchDraft('inspiration', { image: v });
  };
  const setAudio = (v: AudioSourceValue) => {
    setAudioState(v);
    patchDraft('inspiration', { audio: v });
  };

  useEffect(() => {
    listChannels('inspiration').then(setChannels).catch(() => undefined);
  }, []);

  const running = sess.status === 'pending' || sess.status === 'running';

  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (sess.status && sess.status !== lastStatus.current) {
      if (sess.status === 'success') message.success('灵感已产出');
      else if (sess.status === 'failed') message.error(sess.error || '生成失败');
      lastStatus.current = sess.status;
    }
  }, [sess.status, sess.error]);

  const onSubmit = async (values: any) => {
    if (!img.imageUploadId && !img.characterId) {
      message.error('请上传参考图片，或从形象库中选择一个形象');
      return;
    }
    if (!audio.audioUploadId && !audio.songId) {
      message.error('请上传参考音频，或从歌曲库中选择一首歌曲');
      return;
    }
    try {
      await startInspiration({
        channelId: values.channelId,
        model: values.model,
        imageUploadId: img.imageUploadId,
        referenceCharacterId: img.characterId,
        referenceCharacterImageId: img.characterImageId,
        audioUploadId: audio.audioUploadId,
        songId: audio.songId,
        extraRequirement: values.extraRequirement,
        saveToPromptLibrary: values.saveToPromptLibrary,
        savePromptTitle: values.savePromptTitle,
        savePromptTags: values.savePromptTags,
      });
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '提交失败');
    }
  };

  const goCharacter = () => {
    navigate('/character-gen', {
      state: { characterPrompt: sess.characterPrompt, ...img, ...audio },
    });
  };

  const goVideo = () => {
    navigate('/video', { state: { actionPrompt: sess.actionPrompt, ...img, ...audio } });
  };

  const copy = (text?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    message.success('已复制');
  };

  const reset = () => {
    clear('inspiration');
    lastStatus.current = undefined;
  };

  /** 清空本页所有已填内容 */
  const resetAll = () => {
    form.resetFields();
    setImgState({});
    setAudioState({});
    clearDraft('inspiration');
    clear('inspiration');
    lastStatus.current = undefined;
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Steps
        size="small"
        current={0}
        items={[{ title: '获取灵感' }, { title: '生成形象' }, { title: '视频生成' }]}
      />

      {running && (
        <Alert
          type="info"
          showIcon
          message="生成进行中（切换其它页面不会中断，可随时返回查看进度）"
          description={sess.statusText}
        />
      )}

      <Card title="获取灵感（产出两类提示词）">
        {channels.length === 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="暂无可用的 AI 渠道"
            description="请联系超级管理员在「AI 渠道配置」中添加并启用支持 inspiration 阶段、且支持读图（vision）的渠道。"
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={onSubmit}
          initialValues={draft.form}
          onValuesChange={(_c, all) => patchDraft('inspiration', { form: all })}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="channelId" label="AI 渠道">
                <Select
                  allowClear
                  placeholder="留空则用第一个可用渠道"
                  options={channels.map((c) => ({
                    value: c.id,
                    label: `${c.name}${c.model ? ' · ' + c.model : ''}${c.supportsVision ? ' · 支持读图' : ''}`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="model" label="模型（可覆盖渠道默认）">
                <Input placeholder="建议使用支持读图的多模态模型" allowClear />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="参考图片（必填）" required>
                <ImageSourcePicker value={img} onChange={setImg} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="参考音频 / 音乐信息（必填）" required>
                <AudioSourcePicker value={audio} onChange={setAudio} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="extraRequirement"
            label="额外要求（可选）"
            extra="如：情绪更激昂、手势少一点、镜头固定不动"
          >
            <Input.TextArea rows={2} placeholder="补充你的偏好…" />
          </Form.Item>

          <Form.Item name="saveToPromptLibrary" valuePropName="checked">
            <Checkbox>生成后存入提示词库（形象提示词 + 动作提示词 各一条）</Checkbox>
          </Form.Item>

          <SaveToLibFields form={form} />

          <Space>
            <Button type="primary" htmlType="submit" loading={running}>
              获取灵感
            </Button>
            <Button onClick={resetAll} disabled={running}>
              清空表单
            </Button>
            {sess.statusText && !running && (
              <Typography.Text type="secondary">{sess.statusText}</Typography.Text>
            )}
            {(sess.actionPrompt || sess.characterPrompt) && (
              <Button danger type="link" onClick={reset}>
                清除本结果
              </Button>
            )}
          </Space>
        </Form>
      </Card>

      {sess.characterPrompt && (
        <Card
          title="形象提示词（用于生成形象）"
          extra={
            <Space>
              <Button icon={<CopyOutlined />} onClick={() => copy(sess.characterPrompt)}>
                复制
              </Button>
              <Button type="primary" onClick={goCharacter}>
                带入生成形象 →
              </Button>
            </Space>
          }
        >
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
            {sess.characterPrompt}
          </Typography.Paragraph>
        </Card>
      )}

      {sess.actionPrompt && (
        <Card
          title="动作提示词（用于视频表演）"
          extra={
            <Space>
              <Button icon={<CopyOutlined />} onClick={() => copy(sess.actionPrompt)}>
                复制
              </Button>
              <Button type="primary" onClick={goVideo}>
                带入视频生成 →
              </Button>
            </Space>
          }
        >
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
            {sess.actionPrompt}
          </Typography.Paragraph>
        </Card>
      )}
    </Space>
  );
}

/** 勾选「存入提示词库」后展开标题/标签输入 */
function SaveToLibFields({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  const saveToLib = Form.useWatch('saveToPromptLibrary', form);
  if (!saveToLib) return null;
  return (
    <Row gutter={16}>
      <Col xs={24} md={12}>
        <Form.Item name="savePromptTitle" label="提示词标题">
          <Input placeholder="留空自动按时间命名" />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item name="savePromptTags" label="标签">
          <Select mode="tags" placeholder="回车添加标签" />
        </Form.Item>
      </Col>
    </Row>
  );
}
