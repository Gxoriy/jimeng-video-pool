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
  Upload,
  Alert,
  Progress,
  List,
  Popconfirm,
  Image,
} from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import {
  listCharactersPage,
  archiveCharacter,
  importCharactersFromUpload,
  uploadFile,
  Character,
  CharacterImportResult,
  CharacterImportItemResult,
} from '../api/pipeline';

type Status = 'pending_review' | 'active';

const LS_EDIT_DRAFT = 'aigen-panel-character-edit-draft';

function readEditDraft(): { id: string; values: Record<string, any> } | null {
  try {
    const raw = localStorage.getItem(LS_EDIT_DRAFT);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d?.id ? d : null;
  } catch {
    return null;
  }
}
function writeEditDraft(id: string, values: Record<string, any>) {
  try {
    localStorage.setItem(LS_EDIT_DRAFT, JSON.stringify({ id, values }));
  } catch {
    /* 忽略 */
  }
}
function clearEditDraft() {
  try {
    localStorage.removeItem(LS_EDIT_DRAFT);
  } catch {
    /* 忽略 */
  }
}

export default function Characters() {
  // 形象库（已归档）
  const [activeData, setActiveData] = useState<Character[]>([]);
  const [activeTotal, setActiveTotal] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [activeQ, setActiveQ] = useState('');

  // 待审核（AI 识别后待人工归档）
  const [reviewData, setReviewData] = useState<Character[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewQ, setReviewQ] = useState('');

  const [edit, setEdit] = useState<Character | null>(null);
  const [editRestored, setEditRestored] = useState(false);
  const [form] = Form.useForm();

  // 批量导入
  const [files, setFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<CharacterImportResult | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadActive = (p = activePage, q = activeQ) => {
    listCharactersPage({ status: 'active', page: p, pageSize: 20, q })
      .then((r) => {
        setActiveData(r.data);
        setActiveTotal(r.total);
      })
      .catch(() => undefined);
  };

  const loadReview = (p = reviewPage, q = reviewQ) => {
    listCharactersPage({ status: 'pending_review', page: p, pageSize: 20, q })
      .then((r) => {
        setReviewData(r.data);
        setReviewTotal(r.total);
      })
      .catch(() => undefined);
  };

  // 挂载即加载（修复刷新后空白）→ 再恢复未保存的编辑草稿
  useEffect(() => {
    loadActive();
    loadReview();
    const draft = readEditDraft();
    if (draft) {
      const restored = { id: draft.id, ...draft.values } as Character;
      setEdit(restored);
      form.resetFields();
      form.setFieldsValue(draft.values);
      setEditRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (row: Character) => {
    setEdit(row);
    setEditRestored(false);
    form.resetFields();
    form.setFieldsValue(row);
  };

  // 编辑中实时落库（防抖）
  const onValuesChange = (_: any, all: Record<string, any>) => {
    if (!edit?.id) return;
    writeEditDraft(edit.id, all);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.put(`/libraries/characters/${edit.id}`, all);
      } catch {
        /* 静默：下次改动或点保存会再次尝试 */
      }
    }, 600);
  };

  const onSubmitEdit = async () => {
    if (!edit) return;
    const v = await form.validateFields();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await api.put(`/libraries/characters/${edit.id}`, v);
    message.success('已保存');
    clearEditDraft();
    setEdit(null);
    setEditRestored(false);
    loadActive();
    loadReview();
  };

  const closeEdit = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    clearEditDraft();
    setEdit(null);
    setEditRestored(false);
  };

  const onArchive = async (row: Character) => {
    if (edit?.id === row.id) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const v = form.getFieldsValue(true);
      await api.put(`/libraries/characters/${row.id}`, v).catch(() => undefined);
      clearEditDraft();
      setEdit(null);
      setEditRestored(false);
    }
    await archiveCharacter(row.id);
    message.success('已归档入库');
    loadReview();
    loadActive();
  };

  const onDelete = async (row: Character) => {
    await api.delete(`/libraries/characters/${row.id}`);
    message.success('已删除');
    loadActive();
    loadReview();
  };

  /* ---------------- 批量导入 ---------------- */

  const doImport = async () => {
    if (!files.length) {
      message.warning('请先选择本地图片文件');
      return;
    }
    setImporting(true);
    setImportResult(null);
    setImportProgress(0);
    try {
      const ids: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const up = await uploadFile('image', files[i]);
        ids.push(up.id);
        setImportProgress(Math.round(((i + 1) / files.length) * 100));
      }
      const res = await importCharactersFromUpload(ids);
      setImportResult(res);
      loadReview();
      message.success(
        `导入完成：新增 ${res.imported} 个，跳过 ${res.skipped} 个，失败 ${res.failed} 个`,
      );
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  /* ---------------- 列定义 ---------------- */

  const coverCol = {
    title: '封面',
    dataIndex: 'coverUrl',
    width: 64,
    render: (v: string) =>
      v ? <Image src={v} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '-',
  };

  const activeCols = [
    coverCol,
    { title: '名称', dataIndex: 'name' },
    { title: '分类', dataIndex: 'category', render: (v: string) => v || '-' },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (t: string[]) => (t || []).map((x) => <Tag key={x}>{x}</Tag>),
    },
    {
      title: '操作',
      render: (_: any, row: Character) => (
        <Space>
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm title="确认删除？" onConfirm={() => onDelete(row)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const reviewCols = [
    coverCol,
    { title: '名称', dataIndex: 'name' },
    { title: 'AI 分类', dataIndex: 'category', render: (v: string) => v || <Tag color="orange">待分类</Tag> },
    {
      title: 'AI 标签',
      dataIndex: 'tags',
      render: (t: string[]) =>
        (t || []).map((x) => (
          <Tag key={x} color="blue">
            {x}
          </Tag>
        )),
    },
    {
      title: '操作',
      render: (_: any, row: Character) => (
        <Space>
          <Button size="small" type="primary" onClick={() => onArchive(row)}>
            归档
          </Button>
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm title="确认删除？" onConfirm={() => onDelete(row)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  /* ---------------- 渲染 ---------------- */

  const importPane = (
    <Card>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="批量导入流程"
        description="上传本地图片（png/jpg 等）后，AI 用视觉能力识别主体并给出名称/分类/标签，统一进入「待审核」列表；由人工对 AI 结果增删改查后，点击「归档」才正式入库可被生成环节选用。"
      />
      <Upload.Dragger
        multiple
        accept="image/png,image/jpeg,image/jpg,image/webp"
        beforeUpload={(f) => {
          setFiles((prev) => [...prev, f as File]);
          return false;
        }}
        fileList={[]}
        onRemove={() => undefined}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽图片到此（支持多选）</p>
        <p className="ant-upload-hint">上传后将由 AI 识别主体并自动分类</p>
      </Upload.Dragger>
      <div style={{ marginTop: 12 }}>
        {files.map((f, i) => (
          <Tag key={i} closable onClose={() => setFiles((p) => p.filter((_, j) => j !== i))}>
            {f.name}
          </Tag>
        ))}
      </div>
      <Space style={{ marginTop: 12 }}>
        <Button type="primary" loading={importing} onClick={doImport}>
          开始导入
        </Button>
        {importing && importProgress > 0 && (
          <Progress percent={importProgress} size="small" style={{ width: 160 }} />
        )}
        <Button
          onClick={() => {
            setFiles([]);
            setImportResult(null);
          }}
        >
          清空
        </Button>
      </Space>

      {importResult && (
        <Card size="small" title="导入结果" style={{ marginTop: 16 }}>
          <Alert
            type="success"
            showIcon
            message={`新增 ${importResult.imported} 个 · 跳过 ${importResult.skipped} 个 · 失败 ${importResult.failed} 个`}
          />
          <List
            size="small"
            style={{ marginTop: 8 }}
            dataSource={importResult.items}
            renderItem={(it: CharacterImportItemResult) => (
              <List.Item>
                <Space>
                  {it.coverUrl && <Image src={it.coverUrl} width={32} height={32} />}
                  <span>{it.name}</span>
                  {it.tags?.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                  {it.category && <Tag color="blue">{it.category}</Tag>}
                  {it.skipped && <Tag color="default">已存在·跳过</Tag>}
                  {it.error && <Tag color="red">{it.error}</Tag>}
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}
    </Card>
  );

  return (
    <Card title="形象库">
      <Tabs
        items={[
          {
            key: 'active',
            label: `形象库（${activeTotal}）`,
            children: (
              <Card
                type="inner"
                title="已归档形象"
                extra={<Button onClick={() => loadActive()}>刷新</Button>}
              >
                <Input.Search
                  placeholder="搜索名称"
                  allowClear
                  onSearch={(v) => {
                    setActiveQ(v);
                    setActivePage(1);
                    loadActive(1, v);
                  }}
                  style={{ marginBottom: 12, maxWidth: 320 }}
                />
                <Table
                  rowKey="id"
                  dataSource={activeData}
                  columns={activeCols}
                  pagination={{
                    total: activeTotal,
                    current: activePage,
                    pageSize: 20,
                    onChange: (p) => {
                      setActivePage(p);
                      loadActive(p);
                    },
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'review',
            label: `待审核（${reviewTotal}）`,
            children: (
              <Card
                type="inner"
                title="AI 识别后待人工审核归档"
                extra={<Button onClick={() => loadReview()}>刷新</Button>}
              >
                <Input.Search
                  placeholder="搜索名称"
                  allowClear
                  onSearch={(v) => {
                    setReviewQ(v);
                    setReviewPage(1);
                    loadReview(1, v);
                  }}
                  style={{ marginBottom: 12, maxWidth: 320 }}
                />
                <Table
                  rowKey="id"
                  dataSource={reviewData}
                  columns={reviewCols}
                  pagination={{
                    total: reviewTotal,
                    current: reviewPage,
                    pageSize: 20,
                    onChange: (p) => {
                      setReviewPage(p);
                      loadReview(p);
                    },
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'import',
            label: '批量导入',
            children: importPane,
          },
        ]}
      />

      <Modal
        title={edit ? '编辑形象' : '新建形象'}
        open={!!edit}
        onOk={onSubmitEdit}
        onCancel={closeEdit}
        destroyOnClose
      >
        {editRestored && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="已恢复上次未保存的编辑草稿，确认无误后点击「保存」。"
          />
        )}
        <Form form={form} layout="vertical" onValuesChange={onValuesChange}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="coverUrl" label="封面 URL">
            <Input />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input />
          </Form.Item>
          <Form.Item name="tags" label="标签（AI 识别结果可在此增删改）">
            <Select mode="tags" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
