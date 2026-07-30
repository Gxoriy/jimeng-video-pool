import { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Form, Input, Select, message } from 'antd';
import { api } from '../api/client';

export default function ApiKeys() {
  const [data, setData] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => {
    const r = await api.get('/key-pool/keys');
    setData(r.data.data);
  };
  useEffect(() => { load(); }, []);

  const onSubmit = async () => {
    const v = await form.validateFields();
    await api.post('/key-pool/keys', v);
    message.success('已添加（加密存储）');
    setEdit(null);
    form.resetFields();
    load();
  };

  const cols = [
    { title: 'Provider', dataIndex: 'provider' },
    { title: '标签', dataIndex: 'label' },
    { title: '密钥（掩码）', dataIndex: 'masked' },
    { title: '创建时间', dataIndex: 'createdAt', render: (t: string) => t?.slice(0, 19) },
    {
      title: '操作',
      render: (_: any, row: any) => (
        <Button size="small" danger onClick={async () => { await api.delete(`/key-pool/keys/${row.id}`); load(); }}>删除</Button>
      ),
    },
  ];

  return (
    <Card title="我的密钥（需求 #6：每个用户可配置自己的 OpenAI / RunningHub Key）"
      extra={<Button type="primary" onClick={() => { setEdit({}); form.resetFields(); }}>添加密钥</Button>}>
      <Table rowKey="id" dataSource={data} columns={cols} />
      <Modal title="添加个人密钥" open={!!edit} onOk={onSubmit} onCancel={() => setEdit(null)}>
        <Form form={form} layout="vertical">
          <Form.Item name="provider" label="Provider" rules={[{ required: true }]} initialValue="openai">
            <Select options={[{ value: 'openai', label: 'openai（ChatGPT 生图/出提示词）' }, { value: 'runninghub', label: 'runninghub（数字人/视频）' }]} />
          </Form.Item>
          <Form.Item name="key" label="Key" rules={[{ required: true }]}><Input placeholder="sk-... / rh-..." /></Form.Item>
          <Form.Item name="label" label="标签"><Input /></Form.Item>
        </Form>
      </Modal>
      <p style={{ color: '#888', marginTop: 12 }}>
        生成调用时，系统会从「你的密钥 ∪ 系统密钥」合并池中随机选一个（复用 jimen2api 的 Bearer 拆分 + 随机选号）。也可在请求头直接传 <code>Authorization: Bearer k1,k2,k3</code> 优先使用该池。
      </p>
    </Card>
  );
}
