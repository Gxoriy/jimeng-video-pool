import { useState, useEffect, useRef } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Tag,
  message,
  Tabs,
  Popconfirm,
  Tooltip,
} from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import {
  listPromptsPage,
  updatePrompt,
  createPrompt,
  deletePrompt,
  classifyPrompt,
} from '../api/pipeline';

type RowType = 'character' | 'action';

export default function Prompts() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<RowType | undefined>(undefined);
  const [edit, setEdit] = useState<any>(null);
  const [form] = Form.useForm();
  const [classifying, setClassifying] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async (p = page, query = q, t = typeFilter) => {
    const r = await listPromptsPage({ q: query, type: t, page: p, pageSize: 20 });
    setData(r.data);
    setTotal(r.total);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTypeChange = (t?: RowType) => {
    setTypeFilter(t);
    setPage(1);
    load(1, q, t);
  };

  const openEdit = (row: any) => {
    setEdit(row);
    form.resetFields();
    form.setFieldsValue(row);
  };

  const onSubmit = async () => {
    const v = await form.validateFields();
    if (edit?.id) {
      await updatePrompt(edit.id, v);
      message.success('已更新');
    } else {
      await createPrompt(v);
      message.success('已创建');
    }
    setEdit(null);
    form.resetFields();
    load();
  };

  // 编辑中实时落库（防抖），避免「无法保存编辑」
  const onValuesChange = (_: any, all: Record<string, any>) => {
    if (!edit?.id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await updatePrompt(edit.id, all);
      } catch {
        /* 下次改动会再次尝试 */
      }
    }, 600);
  };

  const onClassify = async (row: any) => {
    setClassifying(row.id);
    try {
      const res = await classifyPrompt(row.id);
      setData((prev) => prev.map((x) => (x.id === row.id ? { ...x, category: res.category, tags: res.tags } : x)));
      message.success('AI 已重新分类');
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '分类失败');
    } finally {
      setClassifying(null);
    }
  };

  const cols = [
    { title: '标题', dataIndex: 'title' },
    {
      title: '类型',
      dataIndex: 'type',
      render: (t: string) =>
        t === 'character' ? (
          <Tag color="blue">形象提示词</Tag>
        ) : (
          <Tag color="purple">动作提示词</Tag>
        ),
    },
    { title: '分类', dataIndex: 'category', render: (v: string) => v || '-' },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (t: string[]) => (t || []).map((x) => <Tag key={x}>{x}</Tag>),
    },
    { title: '内容', dataIndex: 'content', ellipsis: true },
    {
      title: '操作',
      render: (_: any, row: any) => (
        <Space>
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Tooltip title="调用 AI 根据标题与正文智能生成分类与标签">
            <Button
              size="small"
              icon={<RobotOutlined />}
              loading={classifying === row.id}
              onClick={() => onClassify(row)}
            >
              智能分类
            </Button>
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={async () => { await deletePrompt(row.id); load(); }}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="提示词库（全站共享，生成时可引用）"
      extra={
        <Button type="primary" onClick={() => { setEdit({}); form.resetFields(); }}>
          新建提示词
        </Button>
      }
    >
      <Tabs
        activeKey={typeFilter || 'all'}
        onChange={(k) => onTypeChange(k === 'all' ? undefined : (k as RowType))}
        items={[
          { key: 'all', label: '全部' },
          { key: 'character', label: '形象提示词' },
          { key: 'action', label: '动作提示词' },
        ]}
        style={{ marginBottom: 8 }}
      />
      <Input.Search
        placeholder="搜索标题/内容"
        allowClear
        onSearch={(v) => {
          setQ(v);
          setPage(1);
          load(1, v);
        }}
        style={{ marginBottom: 12, maxWidth: 320 }}
      />
      <Table
        rowKey="id"
        dataSource={data}
        columns={cols}
        pagination={{
          total,
          current: page,
          pageSize: 20,
          onChange: (p) => {
            setPage(p);
            load(p);
          },
        }}
      />

      <Modal
        title={edit?.id ? '编辑提示词' : '新建提示词'}
        open={!!edit}
        onOk={onSubmit}
        onCancel={() => setEdit(null)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onValuesChange={onValuesChange}>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'character', label: '形象提示词' },
                { value: 'action', label: '动作提示词' },
              ]}
            />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input />
          </Form.Item>
          <Form.Item name="tags" label="标签（回车添加，可调用 AI 智能分类）">
            <Select mode="tags" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
