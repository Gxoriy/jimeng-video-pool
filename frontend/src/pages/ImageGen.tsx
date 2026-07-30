import { useState } from 'react';
import { Card, Form, Input, InputNumber, Select, Button, message, Image, Spin, Typography } from 'antd';
import { api } from '../api/client';

export default function ImageGen() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const [polling, setPolling] = useState(false);

  const onSubmit = async (values: any) => {
    setLoading(true);
    setUrls([]);
    try {
      const res = await api.post('/generation', {
        type: 'image',
        prompt: values.prompt,
        model: values.model,
        params: { size: values.size, n: values.n },
      });
      const taskId = res.data.data.taskId;
      message.success('已提交，正在生成…');
      poll(taskId);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '提交失败');
    } finally {
      setLoading(false);
    }
  };

  const poll = async (taskId: string) => {
    setPolling(true);
    for (let i = 0; i < 40; i++) {
      const r = await api.get(`/tasks/${taskId}`);
      const t = r.data.data;
      if (t.status === 'success') {
        setUrls((t.resultUrls || []).map((u: any) => (typeof u === 'string' ? u : u.url)));
        setPolling(false);
        message.success('生成完成');
        return;
      }
      if (t.status === 'failed') {
        setPolling(false);
        message.error('生成失败：' + t.errorMessage);
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    setPolling(false);
    message.warning('轮询超时，请稍后在任务管理查看');
  };

  return (
    <Card title="图片生成（ChatGPT / OpenAI 兼容生图）">
      <Form form={form} layout="vertical" onFinish={onSubmit} initialValues={{ model: 'gpt-image-1', size: '1024x1024', n: 1 }}>
        <Form.Item name="prompt" label="提示词" rules={[{ required: true }]}>
          <Input.TextArea rows={3} placeholder="描述你想要的图片" />
        </Form.Item>
        <Form.Item name="model" label="模型">
          <Select options={[{ value: 'gpt-image-1', label: 'gpt-image-1' }, { value: 'dall-e-3', label: 'dall-e-3' }]} />
        </Form.Item>
        <Form.Item name="size" label="尺寸">
          <Select options={[{ value: '1024x1024', label: '1024x1024' }, { value: '1536x1024', label: '1536x1024' }, { value: '1024x1536', label: '1024x1536' }]} />
        </Form.Item>
        <Form.Item name="n" label="数量">
          <InputNumber min={1} max={4} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading || polling}>
          {polling ? <Spin size="small" /> : '生成'}
        </Button>
      </Form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
        结果将自动下载落地并登记到「任务管理」。
      </Typography.Paragraph>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        {urls.map((u, i) => (
          <Image key={i} src={u} width={200} />
        ))}
      </div>
    </Card>
  );
}
