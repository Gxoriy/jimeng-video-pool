import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  CloudSyncOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';

interface JimengAccount {
  id: string;
  label?: string;
  keyMask: string;
  source: string;
  status: string;
  credits: number;
  expireAt?: string;
  lastCheckAt?: string;
  lastUsedAt?: string;
  createdAt: string;
}

/**
 * 即梦账号池管理 —— 仅超级管理员。
 * 概念 A（本地导入 cookie）/ 概念 B（外部 :18813 号池）共用，靠 source 区分。
 * 「查活兑换」= 长效 cookie 访问即梦网站换取短效 cookie 并回写积分。
 */
export default function JimengAccounts() {
  const [data, setData] = useState<JimengAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form] = Form.useForm();
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<JimengAccount | null>(null);
  const [editForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/jimeng-accounts');
      setData(r.data.data || []);
    } catch (e: any) {
      if (e?.response?.status === 403) message.error('仅超级管理员可访问即梦账号池');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openImport = () => {
    form.setFieldsValue({ source: 'local', cookies: '' });
    setImportOpen(true);
  };

  const onSubmitImport = async () => {
    const v = await form.validateFields();
    setImporting(true);
    try {
      const r = await api.post('/admin/jimeng-accounts/import', {
        cookies: v.cookies,
        source: v.source,
      });
      message.success(`已导入 ${r.data.data.imported} 个账号`);
      setImportOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const onCheck = async (id: string) => {
    setCheckingId(id);
    try {
      const r = await api.post(`/admin/jimeng-accounts/${id}/check`);
      const d = r.data.data;
      if (d.refreshedSessionid) message.success(`存活，已兑换短效 cookie（积分 ${d.credits}）`);
      else if (d.alive) message.success(`存活（积分 ${d.credits}）`);
      else message.warning('账号已失效');
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '查活失败');
    } finally {
      setCheckingId(null);
    }
  };

  const onSyncExternal = async () => {
    setSyncing(true);
    try {
      const r = await api.post('/admin/jimeng-accounts/sync-external');
      const d = r.data.data || {};
      message.success(d.message || `同步 ${d.synced ?? 0} 个外部账号`);
      load();
    } catch (e: any) {
      const m = e?.response?.data?.message || '同步失败';
      if (/未配置|未启用|关闭|disabled/i.test(m)) message.info('外部号池未启用（需配置 EXTERNAL_POOL_BASE_URL）');
      else message.error(m);
    } finally {
      setSyncing(false);
    }
  };

  const openEdit = (row: JimengAccount) => {
    setEditing(row);
    editForm.setFieldsValue({ label: row.label || '', status: row.status });
    setEditOpen(true);
  };
  const onSubmitEdit = async () => {
    const v = await editForm.validateFields();
    try {
      await api.put(`/admin/jimeng-accounts/${editing!.id}`, v);
      message.success('已更新');
      setEditOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '更新失败');
    }
  };
  const onDelete = async (id: string) => {
    await api.delete(`/admin/jimeng-accounts/${id}`);
    message.success('已删除');
    load();
  };

  const columns = [
    { title: '标签', dataIndex: 'label', render: (v: string) => v || '—' },
    { title: 'SessionID', dataIndex: 'keyMask', width: 140 },
    {
      title: '来源',
      dataIndex: 'source',
      width: 96,
      render: (v: string) => (
        <Tag color={v === 'external' ? 'purple' : 'blue'}>
          {v === 'external' ? '外部号池' : '本地'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 96,
      render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : v === 'expired' ? 'red' : 'default'}>{v}</Tag>
      ),
    },
    { title: '积分', dataIndex: 'credits', width: 80 },
    {
      title: '过期时间',
      dataIndex: 'expireAt',
      width: 160,
      render: (v?: string) => (v ? new Date(v).toLocaleString() : '—'),
    },
    {
      title: '上次查活',
      dataIndex: 'lastCheckAt',
      width: 160,
      render: (v?: string) => (v ? new Date(v).toLocaleString() : '—'),
    },
    {
      title: '操作',
      width: 230,
      render: (_: any, r: JimengAccount) => (
        <Space>
          <Button size="small" icon={<CheckCircleOutlined />} loading={checkingId === r.id} onClick={() => onCheck(r.id)}>
            查活兑换
          </Button>
          <Button size="small" onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm title="确定删除该账号？" onConfirm={() => onDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="即梦账号池（本地 cookie / 外部号池）"
        description="导入浏览器导出的 cookie（整份 JSON 数组），系统只提取 sessionid 重建调用 Cookie；「查活兑换」会用长效 cookie 访问即梦网站换取短效 cookie 并回写积分。外部号池需配置 EXTERNAL_POOL_BASE_URL 后启用。"
      />
      <Card
        title="即梦账号池"
        extra={
          <Space>
            <Button icon={<CloudSyncOutlined />} loading={syncing} onClick={onSyncExternal}>
              同步外部号池
            </Button>
            <Button type="primary" icon={<ImportOutlined />} onClick={openImport}>
              导入 Cookie
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          columns={columns as any}
          pagination={false}
        />
      </Card>

      <Modal
        open={importOpen}
        title="导入即梦 Cookie"
        onCancel={() => setImportOpen(false)}
        onOk={onSubmitImport}
        confirmLoading={importing}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="source" label="来源" initialValue="local">
            <Select
              options={[
                { value: 'local', label: '本地导入' },
                { value: 'external', label: '外部号池' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="cookies"
            label="Cookie JSON"
            rules={[{ required: true, message: '请粘贴浏览器导出的 cookie 数组' }]}
            extra="支持单个账号的 JSON 数组，或多个账号换行分隔；系统只提取 sessionid，整份加密存储作为兜底。"
          >
            <Input.TextArea rows={10} placeholder='[{"name":"sessionid","value":"...","domain":"..."}, ...]' />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={editOpen}
        title="编辑账号"
        onCancel={() => setEditOpen(false)}
        onOk={onSubmitEdit}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="label" label="标签">
            <Input placeholder="可选备注" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'active', label: 'active' },
                { value: 'disabled', label: 'disabled' },
                { value: 'expired', label: 'expired' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
