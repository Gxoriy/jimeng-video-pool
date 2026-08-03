import { useState, useEffect } from 'react';
import { Card, Table, Select, Button, Tag, message } from 'antd';
import { api } from '../api/client';

export default function TaskLogs() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [taskId, setTaskId] = useState<string>('');
  const [tasks, setTasks] = useState<any[]>([]);

  const load = async (p = page) => {
    const params = new URLSearchParams({ page: String(p), pageSize: '20' });
    if (taskId) params.set('taskId', taskId);
    const r = await api.get(`/task-logs?${params.toString()}`);
    setData(r.data.data);
    // Count total by querying all with pageSize=1
    try {
      const countResp = await api.get(`/task-logs?page=1&pageSize=1${taskId ? `&taskId=${taskId}` : ''}`);
      setTotal(countResp.data.data.length || 0);
    } catch {
      setTotal(data.length);
    }
  };

  const loadTasks = async () => {
    try {
      const r = await api.get('/tasks?page=1&pageSize=100');
      setTasks(r.data.data.data || []);
    } catch (e) {
      console.error('加载任务列表失败:', e);
    }
  };

  useEffect(() => { 
    load(); 
    loadTasks();
  }, []);

  const clearLogs = async () => {
    try {
      await api.delete(`/task-logs${taskId ? `?taskId=${taskId}` : ''}`);
      message.success('日志清理完成');
      load(1);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '清理失败');
    }
  };

  const colorOf = (level: string) => {
    return {
      info: 'blue',
      warn: 'orange',
      error: 'red'
    }[level] || 'default';
  };

  const cols = [
    { title: '任务ID', dataIndex: 'taskId', render: (id: string) => (
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{id?.substring(0, 8)}</span>
    )},
    { title: '级别', dataIndex: 'level', render: (level: string) => (
      <Tag color={colorOf(level)}>{level}</Tag>
    )},
    { title: '消息', dataIndex: 'message', ellipsis: { showTitle: false },
      render: (msg: string) => (
        <span title={msg} style={{ cursor: 'pointer' }}>
          {msg?.length > 100 ? msg.substring(0, 100) + '...' : msg}
        </span>
      )
    },
    { title: '时间', dataIndex: 'createdAt', render: (t: string) => t?.slice(0, 19) },
  ];

  return (
    <Card 
      title="任务日志（仅管理员可见）"
      extra={
        <div style={{ display: 'flex', gap: 8 }}>
          <Select 
            placeholder="筛选任务" 
            allowClear 
            style={{ width: 200 }} 
            value={taskId || undefined}
            onChange={(v) => { setTaskId(v); setPage(1); setTimeout(() => load(1), 0); }}
            options={tasks.map(t => ({ 
              value: t.id, 
              label: `${t.type}-${t.id.substring(0, 8)} (${t.status})` 
            }))}
          />
          <Button danger onClick={clearLogs}>
            清理日志
          </Button>
        </div>
      }
    >
      <Table 
        rowKey="id" 
        dataSource={data} 
        columns={cols}
        pagination={{ 
          total, 
          current: page, 
          pageSize: 20, 
          onChange: (p) => { setPage(p); load(p); } 
        }} 
      />
    </Card>
  );
}
