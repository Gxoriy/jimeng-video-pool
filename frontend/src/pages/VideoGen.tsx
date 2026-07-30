import { useState } from 'react';
import { Card, Form, Input, Button, message, Spin, Typography } from 'antd';
import { api } from '../api/client';

export default function VideoGen() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);

  const onSubmit = async (values: any) => {
    setLoading(true);
    try {
      await api.post('/generation', {
        type: 'video',
        prompt: values.prompt,
        params: {
          runninghubInputs: values.runninghubInputs,
          ...(values.imageUrl ? { imageUrl: values.imageUrl } : {}),
        },
      });
      message.success('已提交视频生成（可插拔 provider，默认 RunningHub）');
      setPolling(true);
      const list = await api.get('/tasks?pageSize=1&type=video');
      const task = list.data.data.data?.[0];
      if (task) {
        for (let i = 0; i < 60; i++) {
          const t = await api.get(`/tasks/${task.id}`);
          if (t.data.data.status === 'success') {
            setPolling(false);
            message.success('生成完成，请在任务管理查看结果');
            return;
          }
          if (t.data.data.status === 'failed') {
            setPolling(false);
            message.error('生成失败：' + t.data.data.errorMessage);
            return;
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      setPolling(false);
      message.warning('轮询超时，请稍后在任务管理查看');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '提交失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="视频生成（可插拔 provider，默认 RunningHub）">
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item name="prompt" label="视频提示词" rules={[{ required: true }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="imageUrl" label="首帧/参考图 URL（可选）">
          <Input placeholder="https://..." />
        </Form.Item>
        <Form.Item name="runninghubInputs" label="RunningHub 节点映射（高级，可选 JSON）">
          <Input.TextArea rows={2} placeholder="留空使用默认；或粘贴 JSON 数组" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading || polling}>
          {polling ? <Spin size="small" /> : '生成视频'}
        </Button>
      </Form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
        设计 §4.2.3：视频 provider 为可插拔接口，接入新 provider 只需实现 IGenerationProvider 并注册到 ProviderFactory。
      </Typography.Paragraph>
    </Card>
  );
}
