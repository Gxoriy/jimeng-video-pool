import { useState, useEffect } from 'react';
import { Card, Form, Input, Select, Button, message, Spin, Typography, Table } from 'antd';
import { api } from '../api/client';

export default function DigitalHuman() {
  const [form] = Form.useForm();
  const [songs, setSongs] = useState<any[]>([]);
  const [prompts, setPrompts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    api.get('/libraries/songs?pageSize=200').then((r) => setSongs(r.data.data.data || [])).catch(() => {});
    api.get('/libraries/prompts?pageSize=200&type=digital_human').then((r) => setPrompts(r.data.data.data || [])).catch(() => {});
  }, []);

  const onSubmit = async (values: any) => {
    setLoading(true);
    setResult(null);
    const song = songs.find((s) => s.id === values.songId);
    try {
      await api.post('/generation', {
        type: 'digital_human',
        prompt: values.promptText || '对口型数字人',
        params: { audioUrl: song?.url || song?.localPath, runninghubInputs: values.runninghubInputs },
      });
      message.success('已提交，正在生成视频…');
      setPolling(true);
      // 简单轮询最近任务
      const list = await api.get('/tasks?pageSize=1&type=digital_human');
      const task = list.data.data.data?.[0];
      if (task) {
        for (let i = 0; i < 40; i++) {
          const t = await api.get(`/tasks/${task.id}`);
          if (t.data.data.status === 'success') {
            const url = (t.data.data.resultUrls || [])[0];
            setResult(typeof url === 'string' ? url : url?.url);
            setPolling(false);
            message.success('生成完成');
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
    <Card title="数字人对口型（RunningHub）">
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item name="songId" label="选择歌曲（音频来源）" rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={songs.map((s) => ({ value: s.id, label: `${s.title}${s.artist ? ' - ' + s.artist : ''}` }))}
            placeholder="从歌曲库选择"
          />
        </Form.Item>
        <Form.Item name="promptId" label="引用提示词库（可选）">
          <Select
            allowClear
            options={prompts.map((p) => ({ value: p.id, label: p.title }))}
            onChange={(v) => {
              const p = prompts.find((x) => x.id === v);
              if (p) form.setFieldsValue({ promptText: p.content });
            }}
            placeholder="选择后自动填充口型提示词"
          />
        </Form.Item>
        <Form.Item name="promptText" label="口型提示词">
          <Input.TextArea rows={3} placeholder="用于指导对口型的提示词" />
        </Form.Item>
        <Form.Item name="runninghubInputs" label="RunningHub 节点映射（高级，可选 JSON）" tooltip='如 [{"nodeId":"1","inputName":"audio","value":"<音频URL>"}]；不填则用默认节点映射'>
          <Input.TextArea rows={2} placeholder="留空使用默认；或粘贴 JSON 数组" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading || polling}>
          {polling ? <Spin size="small" /> : '生成视频'}
        </Button>
      </Form>
      {result && (
        <Typography.Paragraph style={{ marginTop: 12 }}>
          结果：<a href={result} target="_blank">{result}</a>
        </Typography.Paragraph>
      )}
    </Card>
  );
}
