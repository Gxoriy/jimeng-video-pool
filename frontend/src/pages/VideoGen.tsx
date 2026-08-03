import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Progress,
  Row,
  Space,
  Steps,
  Tag,
  Typography,
  message,
} from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getNodeMapStatus,
  getSettings,
  runVideoGen,
} from '../api/pipeline';
import { useTaskSession } from '../context/TaskSession';
import {
  AudioSourcePicker,
  AudioSourceValue,
  ImageSourcePicker,
  ImageSourceValue,
} from '../components/SourcePickers';

/**
 * P3 · 视频生成
 * RunningHub 工作流 2031016553440878594（LTX 数字人说话唱歌对口型）
 * 图片 + 音频 + 生成秒数 + 对口型起始秒 + 动作提示词 + 最大分辨率 + 帧率
 * 使用**用户自己**的 RunningHub API Key（在「个人设置」中填写）
 *
 * 进度/结果保存在全局 TaskSession；动作提示词优先取获取灵感传入 state，其次取 session 中已产出的提示词。
 */
export default function VideoGen() {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const location = useLocation() as { state?: any };
  const { get: getSession, startVideo, clear, getDraft, patchDraft, clearDraft } = useTaskSession();
  const sess = getSession('video');
  const draft = getDraft('video');

  const [img, setImgState] = useState<ImageSourceValue>(draft.image || {});
  const [audio, setAudioState] = useState<AudioSourceValue>(draft.audio || {});
  const [keyReady, setKeyReady] = useState<boolean | null>(null);

  const setImg = (v: ImageSourceValue) => {
    setImgState(v);
    patchDraft('video', { image: v });
  };
  const setAudio = (v: AudioSourceValue) => {
    setAudioState(v);
    patchDraft('video', { audio: v });
  };
  const [nodeMap, setNodeMap] = useState<{ workflowId: string; missing: string[] } | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => setKeyReady(s.runninghubKeyConfigured))
      .catch(() => setKeyReady(false));
    getNodeMapStatus()
      .then((n) => setNodeMap({ workflowId: n.workflowId, missing: n.missing }))
      .catch(() => undefined);
  }, []);

  // 从获取灵感带过来的动作提示词与素材；若未带，则兜底读取 session 中已产出的提示词
  useEffect(() => {
    const st = location.state;
    // 优先级：获取灵感明确带过来的 > 本页草稿（用户可能已手动改过） > 会话里残留的
    const drafted = draft.form?.actionPrompt;
    const next = st?.actionPrompt || drafted || sess.actionPrompt;
    if (next && next !== drafted) {
      form.setFieldValue('actionPrompt', next);
      patchDraft('video', { form: { ...draft.form, actionPrompt: next } });
    }
    if (st) {
      if (st.imageUploadId || st.characterId) {
        setImg({
          imageUploadId: st.imageUploadId,
          characterId: st.characterId,
          characterImageId: st.characterImageId,
          previewUrl: st.previewUrl,
        });
      }
      if (st.audioUploadId || st.songId) {
        setAudio({ audioUploadId: st.audioUploadId, songId: st.songId, songTitle: st.songTitle });
      }
    }
    // 仅在挂载时同步一次 P2 传入的数据
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = sess.status === 'pending' || sess.status === 'running';

  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (sess.status && sess.status !== lastStatus.current) {
      if (sess.status === 'success') message.success('视频生成完成');
      else if (sess.status === 'failed') message.error(sess.error || '生成失败');
      lastStatus.current = sess.status;
    }
  }, [sess.status, sess.error]);

  const onSubmit = async (values: any) => {
    if (!img.imageUploadId && !img.characterId) {
      message.error('请上传图片，或选择一个数字人形象');
      return;
    }
    if (!audio.audioUploadId && !audio.songId) {
      message.error('请上传音频，或从歌曲库中选择一首歌曲');
      return;
    }
    try {
      await startVideo({
        imageUploadId: img.imageUploadId,
        characterId: img.characterId,
        characterImageId: img.characterImageId,
        audioUploadId: audio.audioUploadId,
        songId: audio.songId,
        durationSeconds: values.durationSeconds ?? 0,
        audioStartSeconds: values.audioStartSeconds ?? 0,
        actionPrompt: values.actionPrompt,
        maxResolution: values.maxResolution ?? 1024,
        fps: values.fps ?? 25,
      });
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '提交失败');
    }
  };

  const reset = () => {
    clear('video');
    lastStatus.current = undefined;
  };

  /** 清空本页所有已填内容 */
  const resetAll = () => {
    form.resetFields();
    setImgState({});
    setAudioState({});
    clearDraft('video');
    clear('video');
    lastStatus.current = undefined;
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Steps
        size="small"
        current={2}
        items={[{ title: '获取灵感' }, { title: '生成形象' }, { title: '视频生成' }]}
      />

      {running && (
        <Alert
          type="info"
          showIcon
          message="视频生成进行中（切换其它页面不会中断，可随时返回查看进度）"
          description={sess.statusText}
        />
      )}

      {keyReady === false && (
        <Alert
          type="error"
          showIcon
          message="尚未配置个人 RunningHub API Key"
          description="视频生成会消耗 R 币（新用户免费额度仅 100R），因此每位用户需使用自己的 Key。请先到「个人设置」填写。"
          action={
            <Button size="small" type="primary" onClick={() => navigate('/settings')}>
              去配置
            </Button>
          }
        />
      )}

      {nodeMap && nodeMap.missing.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`工作流 ${nodeMap.workflowId} 的节点映射未配置完整`}
          description={`以下字段将使用工作流默认值：${nodeMap.missing.join('、')}。请管理员在后端 .env 的 RUNNINGHUB_NODE_MAP 中补全对应的 nodeId。`}
        />
      )}

      <Card title="视频生成（RunningHub 数字人对口型）">
          <Form
            form={form}
            layout="vertical"
            onFinish={onSubmit}
            initialValues={{
              durationSeconds: 0,
              audioStartSeconds: 0,
              maxResolution: 1024,
              fps: 25,
              ...draft.form,
            }}
            onValuesChange={(_c, all) => patchDraft('video', { form: all })}
          >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="图片 / 数字人形象（必填）" required>
                <ImageSourcePicker value={img} onChange={setImg} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="音频（必填）" required>
                <AudioSourcePicker value={audio} onChange={setAudio} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="actionPrompt"
            label="动作提示词"
            rules={[{ required: true, message: '请填写动作提示词，或先用「获取灵感」生成' }]}
            extra="示例：角色面向镜头深情的说话，固定镜头"
          >
            <Input.TextArea rows={3} placeholder="角色面向镜头深情的说话，固定镜头" />
          </Form.Item>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="durationSeconds"
                label="生成秒数"
                extra="35 秒内效果更佳；0 = 整段音频"
              >
                <InputNumber min={0} max={600} style={{ width: '100%' }} addonAfter="秒" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="audioStartSeconds"
                label="音频从第几秒开始对口型"
                extra="例：0 秒；工作流仅支持起始偏移，不支持结束秒"
              >
                <InputNumber min={0} max={180} style={{ width: '100%' }} addonAfter="秒" />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item
                name="maxResolution"
                label="最大分辨率"
                extra="小于 1600，越大越慢"
                rules={[{ type: 'number', min: 256, max: 1599, message: '需在 256~1599 之间' }]}
              >
                <InputNumber min={256} max={1599} step={64} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="fps" label="帧率">
                <InputNumber min={8} max={60} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={running}
              disabled={keyReady === false}
            >
              生成视频
            </Button>
            <Button onClick={resetAll} disabled={running}>
              清空表单
            </Button>
            {sess.statusText && !running && (
              <Typography.Text type="secondary">{sess.statusText}</Typography.Text>
            )}
            {sess.results.length > 0 && (
              <Button danger type="link" onClick={reset}>
                重新生成
              </Button>
            )}
          </Space>

          {running && <Progress percent={100} status="active" showInfo={false} style={{ marginTop: 12 }} />}
        </Form>
      </Card>

      {sess.results.length > 0 && (
        <Card title="生成结果" extra={<Tag color="green">{sess.results.length} 个文件</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {sess.results.map((u, i) => (
              <video key={i} src={u} controls style={{ width: '100%', maxWidth: 640, borderRadius: 6 }} />
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
}
