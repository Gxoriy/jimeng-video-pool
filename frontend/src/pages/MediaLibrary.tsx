import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Image,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, VideoCameraOutlined, PictureOutlined } from '@ant-design/icons';
import { listMedia, deleteMedia, type MediaItem } from '../api/pipeline';
import { api } from '../api/client';

/**
 * 素材库 —— 登录用户可见。
 * 汇总所有生成任务产出的图片/视频，按类型筛选、分页浏览。
 * 删除仅超级管理员。
 */
export default function MediaLibrary() {
  const [data, setData] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [type, setType] = useState<string>('video');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    api.get('/auth/me').then((r) => {
      setIsAdmin(r.data.data?.role === 'super_admin');
    }).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listMedia({ type: type || undefined, page, pageSize });
      setData(r.data || []);
      setTotal(r.total || 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, page, pageSize]);

  const onDelete = async (id: string) => {
    try {
      await deleteMedia(id);
      message.success('已删除');
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const columns = [
    {
      title: '预览',
      width: 120,
      render: (_: any, r: MediaItem) =>
        r.type === 'video' ? (
          <video src={r.url} style={{ width: 100, height: 56, objectFit: 'cover', borderRadius: 4 }} controls />
        ) : (
          <Image src={r.url} width={100} height={56} style={{ objectFit: 'cover', borderRadius: 4 }} />
        ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: (v: string) => (
        <Tag color={v === 'video' ? 'blue' : 'green'} icon={v === 'video' ? <VideoCameraOutlined /> : <PictureOutlined />}>
          {v === 'video' ? '视频' : '图片'}
        </Tag>
      ),
    },
    {
      title: '来源提示词',
      width: 300,
      ellipsis: true,
      render: (_: any, r: MediaItem) => r.task?.prompt || '—',
    },
    {
      title: '模型',
      width: 160,
      render: (_: any, r: MediaItem) => r.task?.model || '—',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 80,
      render: (_: any, r: MediaItem) =>
        isAdmin ? (
          <Popconfirm title="确定删除该素材？" onConfirm={() => onDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="素材库"
        description="所有生成任务产出的图片/视频自动归档在此，可按类型筛选浏览。视频素材来自即梦视频生成和 RunningHub 视频生成。"
      />
      <Card
        title="素材列表"
        extra={
          <Segmented
            value={type}
            onChange={(v) => {
              setType(v as string);
              setPage(1);
            }}
            options={[
              { label: '视频', value: 'video' },
              { label: '图片', value: 'image' },
              { label: '全部', value: '' },
            ]}
          />
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          columns={columns as any}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>
    </Space>
  );
}
