import { useState, useEffect } from 'react';
import { Card, Table, Select, Tag, Button, Space } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export default function Tasks() {
  const navigate = useNavigate();
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState<string>('');
  const [q, setQ] = useState('');

  const load = async (p = page) => {
    const params = new URLSearchParams({ page: String(p), pageSize: '20' });
    if (type) params.set('type', type);
    if (q) params.set('q', q);
    const r = await api.get(`/tasks?${params.toString()}`);
    setData(r.data.data.data);
    setTotal(r.data.data.total);
  };
  useEffect(() => { load(); }, []);

  const colorOf = (s: string) => ({ pending: 'default', running: 'processing', success: 'success', failed: 'error' } as any)[s] || 'default';

  const cols = [
    { title: '类型', dataIndex: 'type' },
    { title: '状态', dataIndex: 'status', render: (s: string) => <Tag color={colorOf(s)}>{s}</Tag> },
    { title: '提示词', dataIndex: 'prompt', ellipsis: true },
    { title: '模型', dataIndex: 'model' },
    { title: '结果', render: (_: any, row: any) => {
        const urls: any[] = row.resultUrls || [];
        if (!urls.length) return '-';
        return <a href={typeof urls[0] === 'string' ? urls[0] : urls[0]?.url} target="_blank">查看</a>;
      } },
    { title: '创建时间', dataIndex: 'createdAt', render: (t: string) => t?.slice(0, 19) },
    {
      title: '操作',
      render: (_: any, row: any) => (
        <Space>
          <Button size="small" icon={<FileTextOutlined />} onClick={() => navigate(`/task-logs?taskId=${row.id}`)}>日志</Button>
          <Button size="small" danger onClick={async () => { await api.delete(`/tasks/${row.id}`); load(); }}>删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <Card title="任务管理（按用户隔离；管理员可见全部）">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Select placeholder="类型" allowClear style={{ width: 160 }} value={type || undefined}
          onChange={(v) => { setType(v || ''); setPage(1); setTimeout(() => load(1), 0); }}
          options={[{ value: 'image', label: '图片' }, { value: 'digital_human', label: '数字人' }, { value: 'video', label: '视频' }]} />
        <input placeholder="搜索提示词" value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(1); } }}
          style={{ width: 200 }} />
        <Button onClick={() => { setPage(1); load(1); }}>查询</Button>
      </div>
      <Table rowKey="id" dataSource={data} columns={cols}
        pagination={{ total, current: page, pageSize: 20, onChange: (p) => { setPage(p); load(p); } }} />
    </Card>
  );
}
