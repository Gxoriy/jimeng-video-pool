import { useEffect, useState } from 'react';
import { Button, Image, Radio, Select, Space, Tag, Typography, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import {
  Character,
  Song,
  UploadItem,
  listCharacters,
  listSongs,
  uploadFile,
} from '../api/pipeline';

/* ================= 图片来源 ================= */

export interface ImageSourceValue {
  /** 本地上传得到的文件 ID */
  imageUploadId?: string;
  /** 形象库：形象 ID */
  characterId?: string;
  /** 形象库：精确到某一张图 */
  characterImageId?: string;
  /** 仅用于预览 */
  previewUrl?: string;
}

export function ImageSourcePicker(props: {
  value?: ImageSourceValue;
  onChange?: (v: ImageSourceValue) => void;
  /** 形象库里是否允许精确选某一张图 */
  allowPickImage?: boolean;
}) {
  const { value = {}, onChange, allowPickImage = true } = props;
  const [mode, setMode] = useState<'upload' | 'library'>(
    value.characterId ? 'library' : 'upload',
  );
  const [characters, setCharacters] = useState<Character[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    listCharacters().then(setCharacters).catch(() => undefined);
  }, []);

  const current = characters.find((c) => c.id === value.characterId);

  const emit = (v: ImageSourceValue) => onChange?.(v);

  const doUpload = async (file: File) => {
    setUploading(true);
    try {
      const up: UploadItem = await uploadFile('image', file);
      emit({ imageUploadId: up.id, previewUrl: up.url });
      message.success('图片已上传');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '上传失败');
    } finally {
      setUploading(false);
    }
    return false;
  };

  return (
    <div>
      <Radio.Group
        value={mode}
        onChange={(e) => {
          setMode(e.target.value);
          emit({});
        }}
        optionType="button"
        buttonStyle="solid"
        size="small"
        style={{ marginBottom: 8 }}
      >
        <Radio.Button value="upload">上传图片</Radio.Button>
        <Radio.Button value="library">选择形象库</Radio.Button>
      </Radio.Group>

      {mode === 'upload' ? (
        <Space align="start" wrap>
          <Upload beforeUpload={doUpload} maxCount={1} accept="image/*" showUploadList={false}>
            <Button icon={<UploadOutlined />} loading={uploading}>
              选择本地图片
            </Button>
          </Upload>
          {value.previewUrl && <Image src={value.previewUrl} width={72} style={{ borderRadius: 4 }} />}
        </Space>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            showSearch
            allowClear
            style={{ width: '100%' }}
            placeholder="选择形象"
            optionFilterProp="label"
            value={value.characterId}
            onChange={(id) => emit({ characterId: id, previewUrl: characters.find((c) => c.id === id)?.coverUrl })}
            options={characters.map((c) => ({
              value: c.id,
              label: c.name + (c.tags?.length ? `（${c.tags.join('/')}）` : ''),
            }))}
          />
          {allowPickImage && current?.images?.length ? (
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder="可选：指定该形象下的某一张图（默认用最新一张）"
              value={value.characterImageId}
              onChange={(imgId) =>
                emit({
                  characterId: value.characterId,
                  characterImageId: imgId,
                  previewUrl:
                    current.images?.find((i) => i.id === imgId)?.url || current.coverUrl,
                })
              }
              options={current.images.map((img, idx) => ({
                value: img.id,
                label: `第 ${idx + 1} 张 · ${new Date(img.createdAt).toLocaleString('zh-CN')}`,
              }))}
            />
          ) : null}
          {value.previewUrl && <Image src={value.previewUrl} width={72} style={{ borderRadius: 4 }} />}
        </Space>
      )}
    </div>
  );
}

/* ================= 音频来源 ================= */

export interface AudioSourceValue {
  audioUploadId?: string;
  songId?: string;
  previewUrl?: string;
  songTitle?: string;
  hasLyrics?: boolean;
}

export function AudioSourcePicker(props: {
  value?: AudioSourceValue;
  onChange?: (v: AudioSourceValue) => void;
}) {
  const { value = {}, onChange } = props;
  const [mode, setMode] = useState<'upload' | 'library'>(value.songId ? 'library' : 'upload');
  const [songs, setSongs] = useState<Song[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    listSongs(undefined, 'active').then(setSongs).catch(() => undefined);
  }, []);

  const emit = (v: AudioSourceValue) => onChange?.(v);

  const doUpload = async (file: File) => {
    setUploading(true);
    try {
      const up: UploadItem = await uploadFile('audio', file);
      emit({ audioUploadId: up.id, previewUrl: up.url, songTitle: up.filename });
      message.success('音频已上传');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '上传失败');
    } finally {
      setUploading(false);
    }
    return false;
  };

  return (
    <div>
      <Radio.Group
        value={mode}
        onChange={(e) => {
          setMode(e.target.value);
          emit({});
        }}
        optionType="button"
        buttonStyle="solid"
        size="small"
        style={{ marginBottom: 8 }}
      >
        <Radio.Button value="upload">上传音频</Radio.Button>
        <Radio.Button value="library">选择歌曲库</Radio.Button>
      </Radio.Group>

      {mode === 'upload' ? (
        <Space align="center" wrap>
          <Upload beforeUpload={doUpload} maxCount={1} accept="audio/*" showUploadList={false}>
            <Button icon={<UploadOutlined />} loading={uploading}>
              选择本地音频
            </Button>
          </Upload>
          {value.songTitle && <Tag color="blue">{value.songTitle}</Tag>}
        </Space>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            showSearch
            allowClear
            style={{ width: '100%' }}
            placeholder="选择歌曲（会带上歌名/歌手/歌词等音乐信息）"
            optionFilterProp="label"
            value={value.songId}
            onChange={(id) => {
              const s = songs.find((x) => x.id === id);
              emit({ songId: id, previewUrl: s?.url, songTitle: s?.title, hasLyrics: !!s?.lyrics });
            }}
            options={songs.map((s) => ({
              value: s.id,
              label: `${s.title}${s.artist ? ' - ' + s.artist : ''}${s.duration ? ` (${s.duration}s)` : ''}`,
            }))}
          />
          {value.songId && !value.hasLyrics && (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              该歌曲未填写歌词，AI 只能按通用抒情场景推断，建议到歌曲库补充歌词。
            </Typography.Text>
          )}
        </Space>
      )}
      {value.previewUrl && (
        <audio src={value.previewUrl} controls style={{ marginTop: 8, width: '100%', height: 32 }} />
      )}
    </div>
  );
}
