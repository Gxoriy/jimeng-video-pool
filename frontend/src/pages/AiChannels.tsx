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
  Switch,
  Table,
  Tag,
  message,
} from 'antd';
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';

interface Channel {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  model?: string;
  enabled: boolean;
  usableFor: string;
  usableForList: string[];
  supportsImage: boolean;
  supportsVision: boolean;
  streaming: boolean;
  proxyUrl?: string;
  remark?: string;
  keyMask?: string;
  createdAt: string;
}

const protocolOptions = [
  { value: 'openai', label: 'OpenAI / 兼容' },
  { value: 'anthropic', label: 'Anthropic' },
];

const stageOptions = [
  { value: 'character', label: '生成形象' },
  { value: 'inspiration', label: '获取灵感' },
  { value: 'song', label: '歌曲库 AI 分类' },
];

const presetModels = [
  'gpt-image-1',
  'dall-e-3',
  'gpt-4o',
  'gpt-4o-mini',
  'gemini-2.5-flash-image',
  'claude-opus-5',
];

/**
 * AI 渠道配置 —— 仅超级管理员可见可改。
 * 供生成形象 / 获取灵感调用；视频生成走 RunningHub，不在此配置。
 */
export default function AiChannels() {
  const [data, setData] = useState<Channel[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>(presetModels);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/ai-channels');
      setData(r.data.data || []);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        message.error('仅超级管理员可访问 AI 渠道配置');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setModelOptions(presetModels);
    form.setFieldsValue({
      protocol: 'openai',
      enabled: true,
      usableFor: ['character', 'inspiration', 'song'],
      supportsImage: true,
      supportsVision: true,
      streaming: false,
      name: '',
      baseUrl: '',
      apiKey: '',
      model: undefined,
      proxyUrl: '',
      remark: '',
    });
    setOpen(true);
  };

  const openEdit = (row: Channel) => {
    setEditing(row);
    setModelOptions(Array.from(new Set([...presetModels, row.model].filter(Boolean) as string[])));
    form.setFieldsValue({
      ...row,
      apiKey: '', // 留空表示不修改
      usableFor: row.usableForList?.length ? row.usableForList : ['character', 'inspiration', 'song'],
    });
    setOpen(true);
  };

  /** 用当前表单值（或已保存的渠道）拉取模型列表 */
  const handleFetchModels = async () => {
    const baseUrl = form.getFieldValue('baseUrl');
    const apiKey = form.getFieldValue('apiKey');
    if (!editing && (!baseUrl || !apiKey)) {
      message.warning('请先填写 Base URL 和 API Key');
      return;
    }
    setFetchingModels(true);
    try {
      const r = await api.post('/ai-channels/models', {
        id: editing?.id,
        baseUrl,
        apiKey: apiKey || undefined,
      });
      const list: string[] = r.data.data || [];
      if (!list.length) {
        message.warning('该渠道未返回模型列表');
      } else {
        setModelOptions(list);
        message.success(`获取到 ${list.length} 个模型`);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.message || '获取模型列表失败');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTest = async () => {
    const baseUrl = form.getFieldValue('baseUrl');
    const apiKey = form.getFieldValue('apiKey');
    const model = form.getFieldValue('model');
    setFetchingModels(true);
    try {
      const r = await api.post('/ai-channels/test', {
        id: editing?.id,
        baseUrl,
        apiKey: apiKey || undefined,
        model,
      });
      const d = r.data.data;
      if (d.ok) message.success(`连接正常（${d.latencyMs}ms）`);
      else message.error(d.message || '连接失败');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '测试失败');
    } finally {
      setFetchingModels(false);
    }
  };

  const onSubmit = async (values: any) => {
    const payload = { ...values };
    if (editing && !payload.apiKey) delete payload.apiKey;
    try {
      if (editing) await api.put(`/ai-channels/${editing.id}`, payload);
      else await api.post('/ai-channels', payload);
      message.success('已保存');
      setOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    }
  };

  const onDelete = async (id: string) => {
    await api.delete(`/ai-channels/${id}`);
    message.success('已删除');
    load();
  };

  const columns = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '协议',
      dataIndex: 'protocol',
      width: 100,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    { title: 'Base URL', dataIndex: 'baseUrl', ellipsis: true },
    { title: '默认模型', dataIndex: 'model', render: (v?: string) => v || '—' },
    { title: 'Key', dataIndex: 'keyMask', width: 140 },
    {
      title: '可用阶段',
      dataIndex: 'usableForList',
      render: (list: string[]) => (
        <Space size={4}>
          {(list || []).map((s) => (
            <Tag
              key={s}
              color={s === 'character' ? 'purple' : s === 'inspiration' ? 'cyan' : 'green'}
            >
              {s === 'character' ? '生成形象' : s === 'inspiration' ? '获取灵感' : '歌曲分类'}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '能力',
      render: (_: any, r: Channel) => (
        <Space size={4}>
          {r.supportsImage && <Tag color="gold">生图</Tag>}
          {r.supportsVision && <Tag color="blue">读图</Tag>}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 90,
      render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作',
      width: 150,
      render: (_: any, r: Channel) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm title="确定删除该渠道？" onConfirm={() => onDelete(r.id)}>
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
        message="AI 渠道由超级管理员统一配置，普通用户只能在生成页选用"
        description="这里配置的渠道用于生成形象、获取灵感，以及歌曲库批量导入时的 AI 自动分类归档。视频生成使用每位用户自己的 RunningHub API Key，不在此处配置。API Key 加密存储，列表只显示掩码。"
      />
      <Card
        title="AI 渠道配置"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增渠道
          </Button>
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
        open={open}
        title={editing ? `编辑渠道 · ${editing.name}` : '新增渠道'}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}>
            <Input placeholder="如：Edu 主力" />
          </Form.Item>
          <Form.Item name="protocol" label="协议">
            <Select options={protocolOptions} />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[{ required: true }]}
            extra="需带 /v1，如 https://new.api.edu.gr/v1"
          >
            <Input placeholder="https://xxx/v1" />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="API Key"
            rules={editing ? [] : [{ required: true, message: '请填写 API Key' }]}
            extra={editing ? '留空表示不修改现有 Key' : undefined}
          >
            <Input.Password placeholder={editing ? '不修改请留空' : 'sk-...'} />
          </Form.Item>

          <Form.Item label="默认模型">
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="model" noStyle>
                <Select
                  showSearch
                  allowClear
                  style={{ width: '100%' }}
                  placeholder="选择或输入模型"
                  options={modelOptions.map((m) => ({ value: m, label: m }))}
                />
              </Form.Item>
              <Button
                icon={<CloudDownloadOutlined />}
                loading={fetchingModels}
                onClick={handleFetchModels}
              >
                获取模型列表
              </Button>
              <Button icon={<ThunderboltOutlined />} onClick={handleTest}>
                测试
              </Button>
            </Space.Compact>
          </Form.Item>

          <Form.Item
            name="usableFor"
            label="可用阶段"
            extra="决定该渠道会出现在哪个生成页的下拉框中"
          >
            <Select mode="multiple" options={stageOptions} />
          </Form.Item>

          <Space size={24} wrap>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="supportsImage" label="支持生图" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="supportsVision" label="支持读图" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="streaming" label="流式" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>

          <Form.Item name="proxyUrl" label="代理地址（可选）">
            <Input placeholder="http://127.0.0.1:7890" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
