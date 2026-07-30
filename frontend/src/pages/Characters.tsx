import { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Form, Input, Select, Space, Tag, Image, message } from 'antd';
import { api } from '../api/client';

export default function Characters() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const [regen, setRegen] = useState<any>(null);
  const [regenForm] = Form.useForm();
  const [songs, setSongs] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = async (p = page, query = q) => {
    const r = await api.get(`/libraries/characters?page=${p}&pageSize=20&q=${query}`);
    setData(r.data.data.data);
    setTotal(r.data.data.total);
  };
  useEffect(() => { load(); api.get('/libraries/songs?pageSize=200').then((r) => setSongs(r.data.data.data || [])).catch(() => {}); }, []);

  const onSubmit = async () => {
    const v = await form.validateFields();
    if (edit) {
      await api.put(`/libraries/characters/${edit.id}`, v);
      message.success('已更新');
    } else {
      await api.post('/libraries/characters', v);
      message.success('已创建');
    }
    setEdit(null);
    form.resetFields();
    load();
  };

  const onRegen = async () => {
    const v = await regenForm.validateFields();
    await api.post(`/libraries/characters/${regen.id}/regen`, { ...v });
    message.success('已提交换景重生图，请在任务管理查看进度');
    setRegen(null);
    regenForm.resetFields();
  };

  const cols = [
    { title: '名称', dataIndex: 'name' },
    { title: '分类', dataIndex: 'category' },
    { title: '标签', dataIndex: 'tags', render: (t: string[]) => (t || []).map((x) => <Tag key={x}>{x}</Tag>) },
    { title: '封面', dataIndex: 'coverUrl', render: (u: string) => (u ? <Image src={u} width={60} /> : '-') },
    {
      title: '操作',
      render: (_: any, row: any) => (
        <Space>
          <Button size="small" onClick={() => { setEdit(row); form.setFieldsValue(row); }}>编辑</Button>
          <Button size="small" type="primary" onClick={() => { setRegen(row); }}>换景重生图</Button>
          <Button size="small" danger onClick={async () => { await api.delete(`/libraries/characters/${row.id}`); load(); }}>删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <Card title="形象库（全站共享）"
      extra={<Button type="primary" onClick={() => { setEdit({}); form.resetFields(); }}>新建形象</Button>}>
      <Input.Search placeholder="搜索名称" onSearch={(v) => { setQ(v); setPage(1); load(1, v); }} style={{ marginBottom: 12 }} />
      <Table rowKey="id" dataSource={data} columns={cols}
        pagination={{ total, current: page, pageSize: 20, onChange: (p) => { setPage(p); load(p); } }} />

      <Modal title={edit?.id ? '编辑形象' : '新建形象'} open={!!edit} onOk={onSubmit} onCancel={() => setEdit(null)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="coverUrl" label="封面 URL"><Input /></Form.Item>
          <Form.Item name="category" label="分类"><Input /></Form.Item>
          <Form.Item name="tags" label="标签"><Select mode="tags" /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`换景重生图 · ${regen?.name}`} open={!!regen} onOk={onRegen} onCancel={() => setRegen(null)}>
        <Form form={regenForm} layout="vertical">
          <Form.Item name="songId" label="选择歌曲（情绪/风格来源）" rules={[{ required: true }]}>
            <Select options={songs.map((s) => ({ value: s.id, label: `${s.title}${s.artist ? ' - ' + s.artist : ''}` }))} />
          </Form.Item>
          <Form.Item name="promptText" label="换景提示词（可选，留空自动生成）"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
