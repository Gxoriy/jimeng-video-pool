import { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Form, Input, Select, Space, Tag, message } from 'antd';
import { api } from '../api/client';

export default function Prompts() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async (p = page, query = q) => {
    const r = await api.get(`/libraries/prompts?page=${p}&pageSize=20&q=${query}`);
    setData(r.data.data.data);
    setTotal(r.data.data.total);
  };
  useEffect(() => { load(); }, []);

  const onSubmit = async () => {
    const v = await form.validateFields();
    if (edit?.id) {
      await api.put(`/libraries/prompts/${edit.id}`, v);
      message.success('已更新');
    } else {
      await api.post('/libraries/prompts', v);
      message.success('已创建');
    }
    setEdit(null);
    form.resetFields();
    load();
  };

  const cols = [
    { title: '标题', dataIndex: 'title' },
    { title: '类型', dataIndex: 'type', render: (t: string) => <Tag color={t === 'character' ? 'blue' : 'purple'}>{t}</Tag> },
    { title: '分类', dataIndex: 'category' },
    { title: '标签', dataIndex: 'tags', render: (t: string[]) => (t || []).map((x) => <Tag key={x}>{x}</Tag>) },
    { title: '内容', dataIndex: 'content', ellipsis: true },
    {
      title: '操作',
      render: (_: any, row: any) => (
        <Space>
          <Button size="small" onClick={() => { setEdit(row); form.setFieldsValue(row); }}>编辑</Button>
          <Button size="small" danger onClick={async () => { await api.delete(`/libraries/prompts/${row.id}`); load(); }}>删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <Card title="提示词库（全站共享，生成时可引用）"
      extra={<Button type="primary" onClick={() => { setEdit({}); form.resetFields(); }}>新建提示词</Button>}>
      <Input.Search placeholder="搜索标题" onSearch={(v) => { setQ(v); setPage(1); load(1, v); }} style={{ marginBottom: 12 }} />
      <Table rowKey="id" dataSource={data} columns={cols}
        pagination={{ total, current: page, pageSize: 20, onChange: (p) => { setPage(p); load(p); } }} />
      <Modal title={edit?.id ? '编辑提示词' : '新建提示词'} open={!!edit} onOk={onSubmit} onCancel={() => setEdit(null)}>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={[{ value: 'character', label: '形象' }, { value: 'digital_human', label: '数字人' }]} />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
          <Form.Item name="category" label="分类"><Input /></Form.Item>
          <Form.Item name="tags" label="标签"><Select mode="tags" /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
