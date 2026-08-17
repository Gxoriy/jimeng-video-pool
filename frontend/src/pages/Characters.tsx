import { useState, useEffect, useRef } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Image,
  Input,
  List,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
  Progress,
} from 'antd';
import { InboxOutlined, DownloadOutlined, DeleteOutlined, EditOutlined, FileTextOutlined, SaveOutlined } from '@ant-design/icons';
import {
  listCharactersPage,
  getCharacter,
  archiveCharacter,
  deleteCharacter,
  appendCharacterImages,
  deleteCharacterImage,
  importCharactersFromUpload,
  uploadFile,
  runCharacterGen,
  pollTask,
  updateCharacter,
  listPromptsPage,
  createPrompt,
  patchCharacterImage,
  type Character,
  type Prompt,
  type CharacterImportResult,
  type CharacterImportItemResult,
} from '../api/pipeline';

type Status = 'pending_review' | 'active';

const FOLD_THRESHOLD = 12; // 超过该数量的图自动折叠

export default function Characters() {
  /* ---------- 形象列表（左） ---------- */
  const [list, setList] = useState<Character[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* ---------- 选中形象的详情（右） ---------- */
  const [detail, setDetail] = useState<Character | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  /* ---------- 本地导入 ---------- */
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  /* ---------- 再生成新风格 ---------- */
  const [regenPrompt, setRegenPrompt] = useState('');
  const [regening, setRegening] = useState(false);
  const [regenResult, setRegenResult] = useState<string[]>([]);
  const [regenStyle, setRegenStyle] = useState('');
  const [regenSource, setRegenSource] = useState<'ai' | 'jimeng'>('ai');
  const [regenJimengModel, setRegenJimengModel] = useState('jimeng-5.0');
  const [confirming, setConfirming] = useState(false);
  const [regenRatio, setRegenRatio] = useState('1:1');
  const [regenResolution, setRegenResolution] = useState('2k');
  const [regenSize, setRegenSize] = useState('1024x1536');

  /* ---------- 编辑形象信息（改名 / 分类 / 标签） ---------- */
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  /* ---------- 风格改名：每张图在卡片内联编辑（见图片网格） ---------- */

  /* ---------- 提示词库选取 ---------- */
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptList, setPromptList] = useState<Prompt[]>([]);
  const [promptQ, setPromptQ] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);

  /* ---------- 待审核 / 批量导入（保留） ---------- */
  const [reviewData, setReviewData] = useState<Character[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewQ, setReviewQ] = useState('');
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState<CharacterImportResult | null>(null);
  const [enableAi, setEnableAi] = useState(true);

  const loadList = (p = page, kw = q) => {
    listCharactersPage({ status: 'active', page: p, pageSize: 50, q: kw })
      .then((r) => {
        setList(r.data);
        setTotal(r.total);
        if (!selectedId && r.data.length) selectCharacter(r.data[0].id);
      })
      .catch(() => undefined);
  };

  const loadReview = (kw = reviewQ) => {
    listCharactersPage({ status: 'pending_review', page: 1, pageSize: 20, q: kw })
      .then((r) => {
        setReviewData(r.data);
        setReviewTotal(r.total);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    loadList();
    loadReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectCharacter = async (id: string) => {
    setSelectedId(id);
    setChecked(new Set());
    setExpanded(false);
    setRegenResult([]);
    setLoadingDetail(true);
    try {
      const c = await getCharacter(id);
      setDetail(c);
    } finally {
      setLoadingDetail(false);
    }
  };

  /* ---------------- 编辑形象信息（改名 / 分类 / 标签） ---------------- */
  const openEdit = () => {
    if (!detail) return;
    setEditName(detail.name || '');
    setEditCategory(detail.category || '');
    setEditTags(detail.tags || []);
    setEditOpen(true);
  };

  const onEditSave = async () => {
    if (!selectedId) return;
    if (!editName.trim()) return message.warning('名称不能为空');
    setEditSaving(true);
    try {
      await updateCharacter(selectedId, {
        name: editName.trim(),
        category: editCategory.trim() || undefined,
        tags: editTags,
      });
      message.success('已保存形象信息');
      setEditOpen(false);
      selectCharacter(selectedId);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setEditSaving(false);
    }
  };

  /* ---------------- 风格改名：每张图在卡片内联编辑（单独命名） ---------------- */
  const patchStyle = async (imageId: string, value: string) => {
    if (!selectedId) return;
    try {
      await patchCharacterImage(selectedId, imageId, { style: value.trim() || null });
      message.success('已更新风格名');
      selectCharacter(selectedId);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    }
  };

  /* ---------------- 提示词库选取 ---------------- */
  const loadPrompts = (kw?: string) => {
    listPromptsPage({ type: 'character', q: kw || undefined, pageSize: 200 })
      .then((r) => setPromptList(r.data))
      .catch(() => undefined);
  };

  const openPromptPicker = () => {
    setPromptQ('');
    loadPrompts();
    setPromptOpen(true);
  };

  const onPickPrompt = (p: Prompt) => {
    setRegenPrompt((prev) => (prev.trim() ? `${prev.trim()}\n${p.content}` : p.content));
    setPromptOpen(false);
    message.success(`已插入提示词「${p.title}」`);
  };

  const saveCurrentPromptToLibrary = async () => {
    if (!regenPrompt.trim()) return message.warning('请先输入提示词');
    setPromptSaving(true);
    try {
      await createPrompt({
        title: regenPrompt.trim().slice(0, 20) || '自定义形象提示词',
        content: regenPrompt.trim(),
        type: 'character',
      });
      message.success('已保存到提示词库');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setPromptSaving(false);
    }
  };

  /* ---------------- 本地导入（追加到当前形象） ---------------- */
  const doImport = async () => {
    if (!selectedId) return message.warning('请先选择一个形象');
    if (!importFiles.length) return message.warning('请先选择本地图片');
    setImporting(true);
    setImportProgress(0);
    try {
      const ids: string[] = [];
      for (let i = 0; i < importFiles.length; i++) {
        const up = await uploadFile('image', importFiles[i]);
        ids.push(up.id);
        setImportProgress(Math.round(((i + 1) / importFiles.length) * 100));
      }
      const res = await appendCharacterImages(selectedId, { uploadIds: ids });
      message.success(
        `已导入 ${res.added} 张${res.skipped ? `，跳过重复 ${res.skipped} 张` : ''}`,
      );
      setImportFiles([]);
      selectCharacter(selectedId);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  /* ---------------- 勾选图片多选下载 ---------------- */
  const downloadSelected = () => {
    const imgs = detail?.images?.filter((i) => checked.has(i.id)) || [];
    if (!imgs.length) return message.warning('请先勾选要下载的图片');
    imgs.forEach((img, idx) => {
      const a = document.createElement('a');
      a.href = img.url;
      a.download = `${detail?.name || 'image'}-${idx + 1}`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  };

  const toggleCheck = (id: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  /* ---------------- 再生成新风格（单张参考 + 提示词） ---------------- */
  const doRegenerate = async () => {
    if (!selectedId) return message.warning('请先选择一个形象');
    if (checked.size !== 1) return message.warning('请且仅勾选 1 张参考图');
    if (!regenPrompt.trim()) return message.warning('请输入新风格提示词');
    const refImageId = Array.from(checked)[0];
    setRegening(true);
    try {
      const payload: Parameters<typeof runCharacterGen>[0] = {
        referenceCharacterImageId: refImageId,
        saveToCharacterId: selectedId,
        promptText: regenPrompt,
        source: regenSource,
        n: 1,
      };
      if (regenSource === 'jimeng') {
        payload.jimengModel = regenJimengModel;
        payload.ratio = regenRatio;
        payload.resolution = regenResolution;
      } else {
        payload.size = regenSize;
      }
      const { taskId } = await runCharacterGen(payload);
      const task = await pollTask(taskId, { maxTries: 200 });
      const urls = (task.resultUrls || []).map((u: any) => (typeof u === 'string' ? u : u?.url)).filter(Boolean);
      if (!urls.length) throw new Error('未产出图片');
      setRegenResult(urls);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '生成失败');
    } finally {
      setRegening(false);
    }
  };

  const confirmRegen = async () => {
    if (!selectedId || confirming) return;
    setConfirming(true);
    try {
      await appendCharacterImages(selectedId, { urls: regenResult, style: regenStyle || '新风格', prompt: regenPrompt });
      message.success('已入库');
      setRegenResult([]);
      setRegenPrompt('');
      setRegenStyle('');
      selectCharacter(selectedId);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '入库失败');
    } finally {
      setConfirming(false);
    }
  };

  const onDeleteImage = async (imageId: string) => {
    if (!selectedId) return;
    await deleteCharacterImage(selectedId, imageId);
    message.success('已删除');
    toggleCheck(imageId, false);
    selectCharacter(selectedId);
  };

  const onArchive = async (row: Character) => {
    await archiveCharacter(row.id);
    message.success('已归档入库');
    loadReview();
    loadList();
  };

  const onDeleteCharacter = async (id: string) => {
    try {
      await deleteCharacter(id);
      message.success('已删除形象');
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      loadList();
      loadReview();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  /* ---------------- 批量导入（新建形象） ---------------- */
  const doBulkImport = async () => {
    if (!bulkFiles.length) return message.warning('请先选择本地图片文件');
    setBulkImporting(true);
    setBulkResult(null);
    try {
      const ids: string[] = [];
      for (const f of bulkFiles) {
        const up = await uploadFile('image', f);
        ids.push(up.id);
      }
      const res = await importCharactersFromUpload(ids, false, enableAi);
      setBulkResult(res);
      loadReview();
      message.success(`导入完成：新增 ${res.imported} 个，跳过 ${res.skipped} 个，失败 ${res.failed} 个`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '导入失败');
    } finally {
      setBulkImporting(false);
    }
  };

  /* ---------------- 渲染 ---------------- */

  const images = detail?.images || [];
  const visibleImages = expanded ? images : images.slice(0, FOLD_THRESHOLD);

  const libraryPane = (
    <Row gutter={16}>
      {/* 左：形象列表 */}
      <Col xs={24} md={8}>
        <Card
          size="small"
          title={`形象库（${total}）`}
          styles={{ body: { padding: 8 } }}
        >
          <Input.Search
            placeholder="搜索名称"
            allowClear
            onSearch={(v) => {
              setQ(v);
              setPage(1);
              loadList(1, v);
            }}
            style={{ marginBottom: 8 }}
          />
          <List
            dataSource={list}
            locale={{ emptyText: '暂无形象' }}
            renderItem={(c) => (
              <List.Item
                onClick={() => selectCharacter(c.id)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: c.id === selectedId ? '#e6f4ff' : 'transparent',
                }}
              >
                <Space>
                  {c.coverUrl ? (
                    <Image src={c.coverUrl} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />
                  ) : (
                    <div style={{ width: 36, height: 36, background: '#f0f0f0', borderRadius: 4 }} />
                  )}
                  <span>{c.name}</span>
                  <Tag>{c.images?.length || 0} 图</Tag>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      </Col>

      {/* 右：选中形象的多种风格图 */}
      <Col xs={24} md={16}>
        <Card
          size="small"
          title={detail ? `「${detail.name}」的多风格图（${images.length}）` : '形象详情'}
          extra={
            detail && (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={openEdit}>
                  编辑信息
                </Button>
                <Button size="small" icon={<DownloadOutlined />} disabled={checked.size === 0} onClick={downloadSelected}>
                  下载勾选（{checked.size}）
                </Button>
                <Popconfirm title="确认删除该形象？" onConfirm={() => onDeleteCharacter(detail!.id)}>
                  <Button size="small" danger>删除形象</Button>
                </Popconfirm>
              </Space>
            )
          }
        >
          {loadingDetail ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : !detail ? (
            <Empty description="请选择左侧形象" />
          ) : (
            <>
              {(detail.category || (detail.tags && detail.tags.length)) && (
                <div style={{ marginBottom: 12 }}>
                  <Space wrap>
                    {detail.category && <Tag color="green">{detail.category}</Tag>}
                    {(detail.tags || []).map((t) => <Tag key={t}>{t}</Tag>)}
                  </Space>
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {visibleImages.map((img) => (
                  <div key={img.id} style={{ width: 150, border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
                  <Checkbox checked={checked.has(img.id)} onChange={(e) => toggleCheck(img.id, e.target.checked)}>
                    <span onClick={(e) => e.stopPropagation()}>
                      <Typography.Text
                        style={{ fontSize: 12 }}
                        editable={{ tooltip: '重命名该风格', onChange: (v: string) => patchStyle(img.id, v) }}
                      >
                        {img.style || '默认风格'}
                      </Typography.Text>
                    </span>
                  </Checkbox>
                    <Image src={img.url} width={134} height={134} style={{ objectFit: 'cover', borderRadius: 4, marginTop: 4 }} />
                    <div style={{ marginTop: 4 }}>
                      <Popconfirm title="删除这张图？" onConfirm={() => onDeleteImage(img.id)}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                      {img.prompt && <div style={{ fontSize: 11, color: '#888', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={img.prompt}>{img.prompt}</div>}
                    </div>
                  </div>
                ))}
              </div>

              {images.length > FOLD_THRESHOLD && (
                <Button type="link" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? '收起' : `展开全部 ${images.length} 张`}
                </Button>
              )}

              {/* 本地导入 */}
              <Card size="small" title="本地导入（追加到本形象）" style={{ marginTop: 16 }}>
                <Upload.Dragger
                  multiple
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  beforeUpload={(f) => {
                    setImportFiles((p) => {
                      const dup = p.some(
                        (x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified,
                      );
                      return dup ? p : [...p, f as File];
                    });
                    return false;
                  }}
                  fileList={[]}
                  onRemove={() => undefined}
                >
                  <p className="ant-upload-text">点击或拖拽图片到此（支持多选）</p>
                </Upload.Dragger>
                <div style={{ marginTop: 8 }}>
                  {importFiles.map((f, i) => (
                    <Tag key={i} closable onClose={() => setImportFiles((p) => p.filter((_, j) => j !== i))}>{f.name}</Tag>
                  ))}
                </div>
                <Space style={{ marginTop: 8 }}>
                  <Button type="primary" loading={importing} onClick={doImport}>导入到「{detail.name}」</Button>
                  {importing && <Progress percent={importProgress} size="small" style={{ width: 160 }} />}
                </Space>
              </Card>

              {/* 再生成新风格 */}
              <Card size="small" title="基于勾选单图再生成新风格（手动确认入库）" style={{ marginTop: 16 }}>
                <Input.TextArea
                  rows={2}
                  placeholder="输入新风格提示词，如：赛博朋克霓虹背景的嘻哈猫咪"
                  value={regenPrompt}
                  onChange={(e) => setRegenPrompt(e.target.value)}
                />
                <Space style={{ marginTop: 12, flexWrap: 'wrap' }}>
                  <Radio.Group
                    optionType="button"
                    buttonStyle="solid"
                    value={regenSource}
                    onChange={(e) => setRegenSource(e.target.value)}
                    options={[
                      { label: 'AI 渠道', value: 'ai' },
                      { label: '即梦生成', value: 'jimeng' },
                    ]}
                  />
                  {regenSource === 'jimeng' ? (
                    <>
                      <Select
                        value={regenJimengModel}
                        onChange={setRegenJimengModel}
                        style={{ width: 130 }}
                        options={[
                          { value: 'jimeng-5.0', label: '即梦 5.0' },
                          { value: 'jimeng-4.6', label: '即梦 4.6' },
                          { value: 'jimeng-4.5', label: '即梦 4.5' },
                          { value: 'jimeng-4.1', label: '即梦 4.1' },
                          { value: 'jimeng-4.0', label: '即梦 4.0' },
                        ]}
                      />
                      <Select
                        value={regenRatio}
                        onChange={setRegenRatio}
                        style={{ width: 110 }}
                        options={[
                          { value: '1:1', label: '1:1' },
                          { value: '16:9', label: '16:9' },
                          { value: '9:16', label: '9:16' },
                          { value: '3:4', label: '3:4' },
                          { value: '4:3', label: '4:3' },
                        ]}
                      />
                      <Select
                        value={regenResolution}
                        onChange={setRegenResolution}
                        style={{ width: 100 }}
                        options={[
                          { value: '1k', label: '1k' },
                          { value: '2k', label: '2k' },
                          { value: '4k', label: '4k' },
                        ]}
                      />
                    </>
                  ) : (
                    <Select
                      value={regenSize}
                      onChange={setRegenSize}
                      style={{ width: 180 }}
                      options={[
                        { value: '1024x1024', label: '1024x1024' },
                        { value: '1024x1536', label: '1024x1536' },
                        { value: '1536x1024', label: '1536x1024' },
                      ]}
                    />
                  )}
                </Space>
                <Space style={{ marginTop: 8 }}>
                  <Input placeholder="风格标签（可选，如：赛博朋克）" value={regenStyle} onChange={(e) => setRegenStyle(e.target.value)} style={{ width: 200 }} />
                  <Button onClick={doRegenerate} loading={regening} disabled={checked.size !== 1}>
                    生成（需勾选 1 张参考图）
                  </Button>
                  <Button icon={<FileTextOutlined />} onClick={openPromptPicker}>
                    从提示词库选取
                  </Button>
                  <Button icon={<SaveOutlined />} loading={promptSaving} onClick={saveCurrentPromptToLibrary}>
                    保存到提示词库
                  </Button>
                  <span style={{ color: '#888', fontSize: 12 }}>已勾选 {checked.size} 张</span>
                </Space>

                {regenResult.length > 0 && (
                  <Card size="small" style={{ marginTop: 12 }} title="生成结果（确认后入库）">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {regenResult.map((u, i) => (
                        <Image key={i} src={u} width={100} height={100} style={{ objectFit: 'cover', borderRadius: 4 }} />
                      ))}
                    </div>
                    <Space style={{ marginTop: 8 }}>
                      <Button type="primary" loading={confirming} onClick={confirmRegen}>确认入库</Button>
                      <Button onClick={() => setRegenResult([])}>放弃</Button>
                    </Space>
                  </Card>
                )}
              </Card>
            </>
          )}
        </Card>
      </Col>
    </Row>
  );

  const reviewPane = (
    <Card title={`待审核（${reviewTotal}）`}>
      <Input.Search placeholder="搜索名称" allowClear onSearch={(v) => { setReviewQ(v); loadReview(v); }} style={{ marginBottom: 12, maxWidth: 320 }} />
      <List
        dataSource={reviewData}
        renderItem={(row) => (
          <List.Item>
            <Space>
              {row.coverUrl && <Image src={row.coverUrl} width={32} height={32} preview={false} />}
              <span>{row.name}</span>
              {(row.tags || []).map((t) => <Tag key={t} color="blue">{t}</Tag>)}
              {row.category && <Tag color="green">{row.category}</Tag>}
            </Space>
            <Space>
              <Popconfirm title="确认删除该待审核形象？" onConfirm={() => onDeleteCharacter(row.id)}>
                <Button size="small" danger>删除</Button>
              </Popconfirm>
              <Button type="primary" size="small" onClick={() => onArchive(row)}>归档</Button>
            </Space>
          </List.Item>
        )}
      />
    </Card>
  );

  const bulkPane = (
    <Card title="批量导入（新建形象）">
      <Upload.Dragger
        multiple
        accept="image/png,image/jpeg,image/jpg,image/webp"
        beforeUpload={(f) => { setBulkFiles((p) => [...p, f as File]); return false; }}
        fileList={[]}
        onRemove={() => undefined}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">点击或拖拽图片到此（支持多选）</p>
        <p className="ant-upload-hint">上传后由 AI 识别主体并自动分类，进入「待审核」</p>
      </Upload.Dragger>
      <div style={{ marginTop: 8 }}>
        {bulkFiles.map((f, i) => (
          <Tag key={i} closable onClose={() => setBulkFiles((p) => p.filter((_, j) => j !== i))}>{f.name}</Tag>
        ))}
      </div>
      <Checkbox
        checked={enableAi}
        onChange={(e) => setEnableAi(e.target.checked)}
        style={{ marginTop: 8 }}
      >
        AI 智能分类（取消勾选则跳过 AI，直接以「已入库」状态添加）
      </Checkbox>
      <Space style={{ marginTop: 8 }}>
        <Button type="primary" loading={bulkImporting} onClick={doBulkImport}>开始导入</Button>
        <Button onClick={() => { setBulkFiles([]); setBulkResult(null); }}>清空</Button>
      </Space>
      {bulkResult && (
        <Card size="small" title="导入结果" style={{ marginTop: 12 }}>
          <Tag color="success">新增 {bulkResult.imported}</Tag>
          <Tag>跳过 {bulkResult.skipped}</Tag>
          <Tag color="error">失败 {bulkResult.failed}</Tag>
          <div style={{ marginTop: 8 }}>
            {bulkResult.items.map((it, i) => (
              <Tag key={i} color={it.aiUsed ? 'blue' : 'default'}>
                {it.name}
                {it.aiUsed ? '·AI' : '·文件名'}
                {it.skipped ? '·已存在' : ''}
                {it.error ? '·失败' : ''}
              </Tag>
            ))}
          </div>
        </Card>
      )}
    </Card>
  );

  return (
    <Card title="形象库">
      <Tabs
        items={[
          { key: 'library', label: `形象库（${total}）`, children: libraryPane },
          { key: 'review', label: `待审核（${reviewTotal}）`, children: reviewPane },
          { key: 'bulk', label: '批量导入', children: bulkPane },
        ]}
      />

      {/* 编辑形象信息：改名 / 分类 / 标签 */}
      <Modal
        open={editOpen}
        title={`编辑形象信息 · ${detail?.name || ''}`}
        onCancel={() => setEditOpen(false)}
        onOk={onEditSave}
        confirmLoading={editSaving}
        okText="保存"
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>形象名称</div>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="形象名称" />
          </div>
          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>分类</div>
            <Input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} placeholder="如：真人 / 动漫 / 动物 / 虚拟偶像" />
          </div>
          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>标签</div>
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder="输入后回车添加标签"
              value={editTags}
              onChange={(v) => setEditTags(v)}
              tokenSeparators={[',', '，']}
            />
          </div>
        </Space>
      </Modal>

      {/* 风格改名已改为图片卡片内联编辑（单独命名），见上文网格 */}

      {/* 提示词库选取（形象类） */}
      <Modal
        open={promptOpen}
        title="从提示词库选取（形象类）"
        onCancel={() => setPromptOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Input.Search
          placeholder="搜索提示词"
          allowClear
          onSearch={(v) => { setPromptQ(v); loadPrompts(v); }}
          style={{ marginBottom: 12 }}
        />
        <List
          dataSource={promptList}
          locale={{ emptyText: '提示词库暂无数据，可在「再生成新风格」处输入后点击「保存到提示词库」' }}
          renderItem={(p) => (
            <List.Item
              onClick={() => onPickPrompt(p)}
              style={{ cursor: 'pointer', padding: '10px 12px', borderRadius: 6 }}
              actions={[
                <Button key="pick" size="small" type="primary" onClick={(e) => { e.stopPropagation(); onPickPrompt(p); }}>
                  选用
                </Button>,
              ]}
            >
              <div>
                <Space wrap>
                  <strong>{p.title}</strong>
                  {p.category && <Tag color="green">{p.category}</Tag>}
                  {(p.tags || []).map((t) => <Tag key={t}>{t}</Tag>)}
                </Space>
                <div style={{ fontSize: 12, color: '#888', marginTop: 4, whiteSpace: 'pre-wrap' }}>{p.content}</div>
              </div>
            </List.Item>
          )}
        />
      </Modal>
    </Card>
  );
}
