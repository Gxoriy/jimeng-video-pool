import { useState, useEffect, useRef } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
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
  listSongsPage,
  updateSong,
  deleteSong,
  archiveSong,
  importSongsFromText,
  importSongsFromUpload,
  reclassifySong,
  uploadFile,
  Song,
  SongImportResult,
  SongImportItemResult,
} from '../api/pipeline';

type Status = 'pending_review' | 'active';

const LS_EDIT_DRAFT = 'aigen-panel-song-edit-draft';
const LS_IMPORT_TEXT = 'aigen-panel-song-import-text';

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
    /* 忽略持久化失败 */
  }
}
function clearEditDraft() {
  try {
    localStorage.removeItem(LS_EDIT_DRAFT);
  } catch {
    /* 忽略 */
  }
}

export default function Songs() {
  // 歌曲库（已归档）
  const [activeData, setActiveData] = useState<Song[]>([]);
  const [activeTotal, setActiveTotal] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [activeQ, setActiveQ] = useState('');

  // 待审核（AI 识别后待人工归档）
  const [reviewData, setReviewData] = useState<Song[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewQ, setReviewQ] = useState('');

  const [edit, setEdit] = useState<Song | null>(null);
  const [editRestored, setEditRestored] = useState(false);
  const [form] = Form.useForm();

  // 批量导入
  const [importMode, setImportMode] = useState<'upload' | 'text'>('upload');
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(LS_IMPORT_TEXT) || '';
    } catch {
      return '';
    }
  });
  const [files, setFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<SongImportResult | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadActive = (p = activePage, q = activeQ) => {
    listSongsPage({ status: 'active', page: p, pageSize: 20, q })
      .then((r) => {
        setActiveData(r.data);
        setActiveTotal(r.total);
      })
      .catch(() => undefined);
  };

  const loadReview = (p = reviewPage, q = reviewQ) => {
    listSongsPage({ status: 'pending_review', page: p, pageSize: 20, q })
      .then((r) => {
        setReviewData(r.data);
        setReviewTotal(r.total);
      })
      .catch(() => undefined);
  };

  // 挂载即加载（修复刷新后表格空白）→ 再尝试恢复未保存的编辑草稿
  useEffect(() => {
    loadActive();
    loadReview();
    const draft = readEditDraft();
    if (draft) {
      const restored = { id: draft.id, ...draft.values } as Song;
      setEdit(restored);
      form.resetFields();
      form.setFieldsValue(draft.values);
      setEditRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (row: Song) => {
    setEdit(row);
    setEditRestored(false);
    form.resetFields();
    form.setFieldsValue(row);
  };

  // 编辑中实时落库（防抖）：刷新 / 归档前都不会丢；仅在编辑「已有」歌曲时触发
  const onValuesChange = (_: any, all: Record<string, any>) => {
    if (!edit?.id) return;
    writeEditDraft(edit.id, all);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await updateSong(edit.id, all);
      } catch {
        /* 静默：下次改动或点保存会再次尝试 */
      }
    }, 600);
  };

  const onSubmitEdit = async () => {
    if (!edit) return;
    const v = await form.validateFields();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await updateSong(edit.id, v);
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

  const onArchive = async (row: Song) => {
    // 若正在编辑同一首且草稿未提交，先保存再归档，避免人工标签丢失
    if (edit?.id === row.id) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const v = form.getFieldsValue(true);
      await updateSong(row.id, v).catch(() => undefined);
      clearEditDraft();
      setEdit(null);
      setEditRestored(false);
    }
    await archiveSong(row.id);
    message.success('已归档入库');
    loadReview();
    loadActive();
  };

  const onDelete = async (row: Song) => {
    await deleteSong(row.id);
    message.success('已删除');
    loadActive();
    loadReview();
  };

  const onReclassify = async (row: Song) => {
    try {
      await reclassifySong(row.id);
      message.success('AI 重新识别完成');
      loadReview();
    } catch (e: any) {
      message.error(e?.response?.data?.message || 'AI 重新识别失败');
    }
  };

  /* ---------------- 批量导入 ---------------- */

  const doImport = async () => {
    setImporting(true);
    setImportResult(null);
    setImportProgress(0);
    try {
      let res: SongImportResult;
      if (importMode === 'text') {
        const lines = text
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        if (!lines.length) {
          message.warning('请至少填写一首「歌名-作者」');
          setImporting(false);
          return;
        }
        res = await importSongsFromText(lines.join('\n'));
      } else {
        if (!files.length) {
          message.warning('请先选择本地音频文件');
          setImporting(false);
          return;
        }
        const ids: string[] = [];
        for (let i = 0; i < files.length; i++) {
          const up = await uploadFile('audio', files[i]);
          ids.push(up.id);
          setImportProgress(Math.round(((i + 1) / files.length) * 100));
        }
        res = await importSongsFromUpload(ids);
      }
      setImportResult(res);
      loadReview();
      message.success(
        `导入完成：新增 ${res.imported} 首，跳过 ${res.skipped} 首，失败 ${res.failed} 首`,
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
    { title: '标题', dataIndex: 'title' },
    { title: '艺人', dataIndex: 'artist', render: (v: string) => v || '-' },
    { title: '分类', dataIndex: 'category', render: (v: string) => v || '-' },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (t: string[]) => (t || []).map((x) => <Tag key={x}>{x}</Tag>),
    },
    {
      title: '音频',
      render: (_: any, row: Song) =>
        row.url ? (
          <a href={row.url} target="_blank" rel="noreferrer">
            链接
          </a>
        ) : row.localPath ? (
          '本地'
        ) : (
          '-'
        ),
    },
    {
      title: '操作',
      render: (_: any, row: Song) => (
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
    { title: '标题', dataIndex: 'title' },
    { title: '艺人', dataIndex: 'artist', render: (v: string) => v || '-' },
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
      render: (_: any, row: Song) => (
        <Space>
          <Button size="small" type="primary" onClick={() => onArchive(row)}>
            归档
          </Button>
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm title="确认重新执行 AI 识别？" onConfirm={() => onReclassify(row)}>
            <Button size="small">二次识别</Button>
          </Popconfirm>
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
        description="录入的歌曲会先经 AI 自动识别歌名/艺人/语种并分配标签与分类，统一进入「待审核」列表；由人工对 AI 标签进行增删改查检验后，点击「归档」才正式入库可被各生成环节选用。"
      />
      <Tabs
        activeKey={importMode}
        onChange={(k) => setImportMode(k as 'upload' | 'text')}
        items={[
          {
            key: 'upload',
            label: '本地文件上传',
            children: (
              <>
                <Upload.Dragger
                  multiple
                  accept="audio/*"
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
                  <p className="ant-upload-text">点击或拖拽音频文件到此（支持多选）</p>
                  <p className="ant-upload-hint">上传后将自动读取时长并由 AI 识别信息</p>
                </Upload.Dragger>
                <div style={{ marginTop: 12 }}>
                  {files.map((f, i) => (
                    <Tag key={i} closable onClose={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                      {f.name}
                    </Tag>
                  ))}
                </div>
              </>
            ),
          },
          {
            key: 'text',
            label: '歌名-作者 自动下载',
            children: (
              <Input.TextArea
                rows={8}
                value={text}
                onChange={(e) => {
                  const v = e.target.value;
                  setText(v);
                  try {
                    localStorage.setItem(LS_IMPORT_TEXT, v);
                  } catch {
                    /* 忽略 */
                  }
                }}
                placeholder={'每行一首，形如「歌名-作者」，例：\n孤勇者-陈奕迅\n晴天-周杰伦'}
              />
            ),
          },
        ]}
      />
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
            setText('');
            setImportResult(null);
            try {
              localStorage.removeItem(LS_IMPORT_TEXT);
            } catch {
              /* 忽略 */
            }
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
            message={`新增 ${importResult.imported} 首 · 跳过 ${importResult.skipped} 首 · 失败 ${importResult.failed} 首`}
          />
          <List
            size="small"
            style={{ marginTop: 8 }}
            dataSource={importResult.items}
            renderItem={(it: SongImportItemResult) => (
              <List.Item>
                <Space>
                  {it.coverUrl && <Image src={it.coverUrl} width={32} height={32} />}
                  <span>
                    {it.title}
                    {it.artist ? ` - ${it.artist}` : ''}
                  </span>
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
    <Card title="歌曲库">
      <Tabs
        items={[
          {
            key: 'active',
            label: `歌曲库（${activeTotal}）`,
            children: (
              <Card type="inner" title="已归档歌曲" extra={<Button onClick={() => loadActive()}>刷新</Button>}>
                <Input.Search
                  placeholder="搜索标题/艺人"
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
                  placeholder="搜索标题/艺人"
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
        title={edit ? '编辑歌曲' : '新建歌曲'}
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
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="artist" label="艺人">
            <Input />
          </Form.Item>
          <Form.Item name="url" label="音频 URL">
            <Input />
          </Form.Item>
          <Form.Item name="localPath" label="本地路径">
            <Input />
          </Form.Item>
          <Form.Item name="duration" label="时长(秒)">
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input />
          </Form.Item>
          <Form.Item name="tags" label="标签（AI 识别结果可在此增删改）">
            <Select mode="tags" />
          </Form.Item>
          <Form.Item name="lyrics" label="歌词/音乐信息">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
