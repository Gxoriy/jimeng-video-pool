import { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Form, Input, InputNumber, Select, Space, Tag, message } from 'antd';
import { api } from '../api/client';

export default function Songs() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async (p = page, query = q) => {
    const r = await api.get(`/libraries/songs?page=${p}&pageSize=20&q=${query}`);
    setData(r.data.data.data);
    setTotal(r.data.data.total);
  };
  useEffect(() => { load(); }, []);

  const onSubmit = async () => {
    const v = await form.validateFields();
    if (edit?.id) {
      await api.put(`/libraries/songs/${edit.id}`, v);
      message.success('已更新');
    } else {
      await api.post('/libraries/songs', v);
      message.success('已创建');
    }
    setEdit(null);
    form.resetFields();
    load();
  };

  const cols = [
    { title: '标题', dataIndex: 'title' },
    { title: '艺人', dataIndex: 'artist' },
    { title: '分类', dataIndex: 'category' },
    { title: '标签', dataIndex: 'tags', render: (t: string[]) => (t || []).map((x) => <Tag key={x}>{x}</Tag>) },
    { title: '音频', render: (_: any, row: any) => row.url ? <a href={row.url} target="_blank">链接</a> : row.localPath ? '本地' : '-' },
    {
      title: '操作',
      render: (_: any, row: any) => (
        <Space>
          <Button size="small" onClick={() => { setEdit(row); form.setFieldsValue(row); }}>编辑</Button>
          <Button size="small" danger onClick={async () => { await api.delete(`/libraries/songs/${row.id}`); load(); }}>删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <Card title="歌曲库（全站共享）"
      extra={<Button type="primary" onClick={() => { setEdit({}); form.resetFields(); }}>新建歌曲</Button>}>
      <Input.Search placeholder="搜索标题" onSearch={(v) => { setQ(v); setPage(1); load(1, v); }} style={{ marginBottom: 12 }} />
      <Table rowKey="id" dataSource={data} columns={cols}
        pagination={{ total, current: page, pageSize: 20, onChange: (p) => { setPage(p); load(p); } }} />
      <Modal title={edit?.id ? '编辑歌曲' : '新建歌曲'} open={!!edit} onOk={onSubmit} onCancel={() => setEdit(null)}>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="artist" label="艺人"><Input /></Form.Item>
          <Form.Item name="url" label="音频 URL"><Input /></Form.Item>
          <Form.Item name="localPath" label="本地路径"><Input /></Form.Item>
          <Form.Item name="duration" label="时长(秒)"><InputNumber /></Form.Item>
          <Form.Item name="category" label="分类"><Input /></Form.Item>
          <Form.Item name="tags" label="标签"><Select mode="tags" /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
