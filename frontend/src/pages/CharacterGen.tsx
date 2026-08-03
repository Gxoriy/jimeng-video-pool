import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Image,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Steps,
  Tag,
  Typography,
  message,
} from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Channel,
  Prompt,
  Song,
  listChannels,
  listPrompts,
  listSongs,
  listTags,
  runCharacterGen,
} from '../api/pipeline';
import { useTaskSession } from '../context/TaskSession';
import { ImageSourcePicker, ImageSourceValue } from '../components/SourcePickers';

const sizeOptions = [
  { value: '1024x1024', label: '1024x1024 方形' },
  { value: '1024x1536', label: '1024x1536 竖版（数字人推荐）' },
  { value: '1536x1024', label: '1536x1024 横版' },
];

/**
 * 生成形象（第二步）
 * 提示词（必填，手填 / 从提示词库按标签挑 / 由「获取灵感」带入的形象提示词）
 *   + 可选参考图 + 可选歌曲音乐信息 -> 形象图
 * 执行方：管理员配置的 AI 渠道
 *
 * 任务进度/结果保存在全局 TaskSession（跨路由切换不丢失），并落盘 localStorage 防整页刷新。
 */
export default function CharacterGen() {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const location = useLocation() as { state?: any };
  const { get: getSession, startCharacter, clear, getDraft, patchDraft, clearDraft } =
    useTaskSession();
  const sess = getSession('character');
  const draft = getDraft('character');

  const [channels, setChannels] = useState<Channel[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string | undefined>(draft.extra?.tagFilter);

  const [ref, setRefState] = useState<ImageSourceValue>(draft.image || {});

  // 所有输入都写进草稿（localStorage），刷新 / 关标签页后仍能恢复
  const setRef = (v: ImageSourceValue) => {
    setRefState(v);
    patchDraft('character', { image: v });
  };
  const onTagFilterChange = (v?: string) => {
    setTagFilter(v);
    patchDraft('character', { extra: { ...draft.extra, tagFilter: v } });
  };

  useEffect(() => {
    listChannels('character').then(setChannels).catch(() => undefined);
    listSongs(undefined, 'active').then(setSongs).catch(() => undefined);
    listTags('prompt')
      .then((t) => setTags(t.map((x) => x.name)))
      .catch(() => undefined);
  }, []);

  // 由「获取灵感」带入的形象提示词（或刷新后从会话兜底），自动填入提示词框
  useEffect(() => {
    const cp = location.state?.characterPrompt || sess.characterPrompt;
    if (cp && !form.getFieldValue('promptText')) {
      form.setFieldValue('promptText', cp);
      patchDraft('character', { form: { ...draft.form, promptText: cp } });
    }
    // 仅挂载时同步一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listPrompts('character', tagFilter).then(setPrompts).catch(() => undefined);
  }, [tagFilter]);

  const selectedPromptId = Form.useWatch('promptId', form);
  const selectedPrompt = useMemo(
    () => prompts.find((p) => p.id === selectedPromptId),
    [prompts, selectedPromptId],
  );

  const running = sess.status === 'pending' || sess.status === 'running';

  // 状态流转时仅提示一次
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (sess.status && sess.status !== lastStatus.current) {
      if (sess.status === 'success') message.success('形象生成完成');
      else if (sess.status === 'failed') message.error(sess.error || '生成失败');
      lastStatus.current = sess.status;
    }
  }, [sess.status, sess.error]);

  const onSubmit = async (values: any) => {
    if (!values.promptId && !values.promptText?.trim()) {
      message.error('提示词为必填项：请手动填写，或从提示词库中选择');
      return;
    }
    try {
      await startCharacter({
        channelId: values.channelId,
        model: values.model,
        promptId: values.promptId,
        promptText: values.promptText,
        imageUploadId: ref.imageUploadId,
        referenceCharacterId: ref.characterId,
        referenceCharacterImageId: ref.characterImageId,
        songId: values.songId,
        size: values.size,
        n: values.n,
        saveToCharacterId: values.saveToCharacterId,
        newCharacterName: values.newCharacterName,
        newCharacterTags: values.newCharacterTags,
      });
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '提交失败');
    }
  };

  const reset = () => {
    clear('character');
    lastStatus.current = undefined;
  };

  /** 清空本页所有已填内容（表单 + 参考图 + 结果） */
  const resetAll = () => {
    form.resetFields();
    setRefState({});
    setTagFilter(undefined);
    clearDraft('character');
    clear('character');
    lastStatus.current = undefined;
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Steps
        size="small"
        current={1}
        items={[
          { title: '获取灵感' },
          { title: '生成形象' },
          { title: '视频生成' },
        ]}
      />

      {running && (
        <Alert
          type="info"
          showIcon
          message="生成进行中（切换其它页面不会中断，可随时返回查看进度）"
          description={sess.statusText}
        />
      )}

      <Card title="生成形象">
        {channels.length === 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="暂无可用的 AI 渠道"
            description="AI 渠道仅超级管理员可配置，请联系管理员在「AI 渠道配置」中添加并启用支持 character 阶段的渠道。"
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={onSubmit}
          initialValues={{ size: '1024x1536', n: 1, ...draft.form }}
          onValuesChange={(_c, all) => patchDraft('character', { form: all })}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="channelId" label="AI 渠道">
                <Select
                  allowClear
                  placeholder="留空则用第一个可用渠道"
                  options={channels.map((c) => ({
                    value: c.id,
                    label: `${c.name}${c.model ? ' · ' + c.model : ''}`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="model" label="模型（可覆盖渠道默认）">
                <Input placeholder="如 gpt-image-1 / gemini-2.5-flash-image" allowClear />
              </Form.Item>
            </Col>
          </Row>

          <Card size="small" type="inner" title="提示词（必填）" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item label="按标签筛选提示词库">
                  <Select
                    allowClear
                    placeholder="全部标签"
                    value={tagFilter}
                    onChange={onTagFilterChange}
                    options={tags.map((t) => ({ value: t, label: t }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={16}>
                <Form.Item name="promptId" label="从提示词库选择（形象提示词）">
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择已有提示词"
                    options={prompts.map((p) => ({
                      value: p.id,
                      label: `${p.title}${p.tags?.length ? '（' + p.tags.join('/') + '）' : ''}`,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>

            {selectedPrompt && (
              <Alert
                type="info"
                style={{ marginBottom: 12 }}
                message={selectedPrompt.title}
                description={
                  <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                    {selectedPrompt.content}
                  </Typography.Paragraph>
                }
              />
            )}

            <Form.Item
              name="promptText"
              label={selectedPromptId ? '补充要求（可选）' : '手动填写提示词'}
              extra="与提示词库二选一；两者都填时，手填内容会作为补充要求追加"
            >
              <Input.TextArea rows={4} placeholder="描述想要的形象：外貌、服装、气质、场景…" />
            </Form.Item>
          </Card>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="参考图（可选）">
                <ImageSourcePicker value={ref} onChange={setRef} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="songId"
                label="音乐信息（可选）"
                extra="选歌后会把歌名/曲风/歌词一并交给 AI，让形象契合歌曲气质"
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="从歌曲库选择"
                  options={songs.map((s) => ({
                    value: s.id,
                    label: `${s.title}${s.artist ? ' - ' + s.artist : ''}`,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={12} md={6}>
              <Form.Item name="size" label="尺寸">
                <Select options={sizeOptions} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="n" label="数量">
                <InputNumber min={1} max={4} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={7}>
              <Form.Item name="newCharacterName" label="存入形象库（新建）">
                <Input placeholder="填写形象名称即入库，留空则不入库" />
              </Form.Item>
            </Col>
            <Col xs={24} md={7}>
              <Form.Item name="newCharacterTags" label="形象标签">
                <Select mode="tags" placeholder="回车添加标签" />
              </Form.Item>
            </Col>
          </Row>

          <Space>
            <Button type="primary" htmlType="submit" loading={running}>
              生成形象
            </Button>
            <Button onClick={resetAll} disabled={running}>
              清空表单
            </Button>
            {sess.statusText && !running && (
              <Typography.Text type="secondary">{sess.statusText}</Typography.Text>
            )}
          </Space>
        </Form>
      </Card>

      {sess.results.length > 0 && (
        <Card
          title="生成结果"
          extra={
            <Space>
              <Tag color="green">{sess.results.length} 张</Tag>
              <Button type="link" onClick={() => navigate('/video')}>
                下一步：视频生成 →
              </Button>
              <Button type="link" danger onClick={reset}>
                重新生成
              </Button>
            </Space>
          }
        >
          <Space wrap>
            {sess.results.map((u, i) => (
              <Image key={i} src={u} width={220} style={{ borderRadius: 6 }} />
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
}
