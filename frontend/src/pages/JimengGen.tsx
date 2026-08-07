import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Image,
  Input,
  InputNumber,
  Select,
  Space,
  Tabs,
  message,
} from 'antd';
import { api } from '../api/client';

interface ModelOption {
  id: string;
  name: string;
}

/**
 * 即梦生成（图像 / 视频）—— 登录用户可见。
 * 走本地号池（按积分加权选号）；生成结果自动入库（media）。
 */
export default function JimengGen() {
  const [models, setModels] = useState<{ image?: ModelOption[]; video?: ModelOption[] }>({});
  const [tab, setTab] = useState<'image' | 'video'>('image');
  const [imageForm] = Form.useForm();
  const [videoForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);

  useEffect(() => {
    api
      .get('/jimeng/models')
      .then((r) => setModels(r.data.data || {}))
      .catch(() => {});
  }, []);

  const imageOptions = (models.image || []).map((m) => ({ value: m.id, label: m.name }));
  const videoOptions = (models.video || []).map((m) => ({ value: m.id, label: m.name }));

  const onGenImage = async () => {
    const v = await imageForm.validateFields();
    setLoading(true);
    setResults([]);
    try {
      const r = await api.post('/jimeng/image/generations', v);
      const arr = (r.data.data?.data || []).map((d: any) => d.url).filter(Boolean);
      setResults(arr);
      message.success(`生成 ${arr.length} 张`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const onGenVideo = async () => {
    const v = await videoForm.validateFields();
    const filePaths = v.filePaths
      ? String(v.filePaths)
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : undefined;
    setLoading(true);
    setResults([]);
    try {
      const r = await api.post('/jimeng/video/generations', { ...v, filePaths });
      const url = r.data.data?.url;
      setResults(url ? [url] : []);
      message.success('生成完成');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="即梦生成（图像 / 视频）"
        description="调用本地号池（按积分加权选号）。生成结果会自动存入素材库。"
      />
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as 'image' | 'video')}
          items={[
            {
              key: 'image',
              label: '图像生成',
              children: (
                <Form form={imageForm} layout="vertical" initialValues={{ resolution: '2k', ratio: '1:1' }}>
                  <Form.Item name="model" label="模型">
                    <Select showSearch allowClear placeholder="默认模型" options={imageOptions} />
                  </Form.Item>
                  <Form.Item name="prompt" label="提示词" rules={[{ required: true }]}>
                    <Input.TextArea rows={4} placeholder="描述要生成的图像" />
                  </Form.Item>
                  <Space size={16} wrap>
                    <Form.Item name="ratio" label="比例">
                      <Select
                        style={{ width: 120 }}
                        options={[
                          { value: '1:1', label: '1:1' },
                          { value: '3:4', label: '3:4' },
                          { value: '4:3', label: '4:3' },
                          { value: '9:16', label: '9:16' },
                          { value: '16:9', label: '16:9' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name="resolution" label="分辨率">
                      <Select
                        style={{ width: 120 }}
                        options={[
                          { value: '1k', label: '1K' },
                          { value: '2k', label: '2K' },
                        ]}
                      />
                    </Form.Item>
                  </Space>
                  <Form.Item name="negativePrompt" label="反向提示词（可选）">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                  <Form.Item name="filePath" label="参考图 URL（可选）" extra="远程 URL 或 base64 data URL">
                    <Input placeholder="https://..." />
                  </Form.Item>
                  <Button type="primary" loading={loading} onClick={onGenImage}>
                    生成图像
                  </Button>
                </Form>
              ),
            },
            {
              key: 'video',
              label: '视频生成',
              children: (
                <Form
                  form={videoForm}
                  layout="vertical"
                  initialValues={{ resolution: '1080p', ratio: '16:9', duration: 5 }}
                >
                  <Form.Item name="model" label="模型">
                    <Select showSearch allowClear placeholder="默认模型" options={videoOptions} />
                  </Form.Item>
                  <Form.Item name="prompt" label="提示词" rules={[{ required: true }]}>
                    <Input.TextArea rows={4} placeholder="描述要生成的视频" />
                  </Form.Item>
                  <Space size={16} wrap>
                    <Form.Item name="ratio" label="比例">
                      <Select
                        style={{ width: 120 }}
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
                    <Form.Item name="resolution" label="分辨率">
                      <Select
                        style={{ width: 120 }}
                        options={[
                          { value: '480p', label: '480P' },
                          { value: '720p', label: '720P' },
                          { value: '1080p', label: '1080P' },
                          { value: '4k', label: '4K' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name="duration" label="时长(秒)">
                      <InputNumber min={5} max={10} />
                    </Form.Item>
                  </Space>
                  <Form.Item name="filePaths" label="首/尾帧 URL（可选，逗号分隔）" extra="最多 2 张远程 URL 或 base64">
                    <Input placeholder="url1,url2" />
                  </Form.Item>
                  <Button type="primary" loading={loading} onClick={onGenVideo}>
                    生成视频
                  </Button>
                </Form>
              ),
            },
          ]}
        />
      </Card>

      {results.length > 0 && (
        <Card title="生成结果">
          {tab === 'image' ? (
            <Image.PreviewGroup>
              <Space wrap>
                {results.map((u, i) => (
                  <Image key={i} src={u} width={200} />
                ))}
              </Space>
            </Image.PreviewGroup>
          ) : (
            <Space wrap>
              {results.map((u, i) => (
                <video key={i} src={u} controls width={360} />
              ))}
            </Space>
          )}
        </Card>
      )}
    </Space>
  );
}
