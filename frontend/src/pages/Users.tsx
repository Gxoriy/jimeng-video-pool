import { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, message } from 'antd';
import { api } from '../api/client';

export default function Users() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async (p = page) => {
    const r = await api.get(`/users?page=${p}&pageSize=20`);
    setData(r.data.data.data);
    setTotal(r.data.data.total);
  };
  useEffect(() => { load(); }, []);

  const onSubmit = async () => {
    const v = await form.validateFields();
    if (edit?.id) {
      await api.patch(`/users/${edit.id}`, v);
      message.success('已更新');
    } else {
      await api.post('/users', v);
      message.success('已创建');
    }
    setEdit(null);
    form.resetFields();
    load();
  };

  const cols = [
    { title: '用户名', dataIndex: 'username' },
    { title: '角色', dataIndex: 'role', render: (r: string) => <Tag color={r === 'super_admin' ? 'gold' : 'blue'}>{r}</Tag> },
    { title: '网络范围', dataIndex: 'networkScope', render: (s: string) => <Tag>{s}</Tag> },
    { title: '状态', dataIndex: 'status', render: (s: boolean) => <Tag color={s ? 'success' : 'error'}>{s ? '启用' : '禁用'}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', render: (t: string) => t?.slice(0, 19) },
    {
      title: '操作',
      render: (_: any, row: any) => (
        <Button size="small" onClick={() => { setEdit(row); form.setFieldsValue(row); }}>编辑</Button>
      ),
    },
  ];

  return (
    <Card title="用户管理（仅超级管理员）"
      extra={<Button type="primary" onClick={() => { setEdit({}); form.resetFields(); }}>新建用户</Button>}>
      <Table rowKey="id" dataSource={data} columns={cols}
        pagination={{ total, current: page, pageSize: 20, onChange: (p) => { setPage(p); load(p); } }} />
      <Modal title={edit?.id ? '编辑用户' : '新建用户'} open={!!edit} onOk={onSubmit} onCancel={() => setEdit(null)}>
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="password" label="密码（新建必填 / 修改留空不变）" rules={edit?.id ? [] : [{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="normal_user">
            <Select options={[{ value: 'super_admin', label: 'super_admin' }, { value: 'normal_user', label: 'normal_user' }]} />
          </Form.Item>
          <Form.Item name="networkScope" label="网络访问范围" initialValue="restricted" tooltip="restricted=禁内网仅白名单；broad=放行（超级管理员）">
            <Select options={[{ value: 'restricted', label: 'restricted' }, { value: 'broad', label: 'broad' }]} />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue={true}><Select options={[{ value: true, label: '启用' }, { value: false, label: '禁用' }]} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
