import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  clearRunninghubKey,
  getSettings,
  saveRunninghubKey,
  testRunninghubKey,
  saveHedraCookie,
  clearHedraCookie,
  testHedraCookie,
} from '../api/pipeline';

/**
 * 个人设置 —— RunningHub API Key。
 * 视频生成消耗 R 币且新用户免费额度仅 100R，因此不做共享 Key 池，
 * 每位用户使用并管理自己的 Key。
 */
export default function Settings() {
  const [form] = Form.useForm();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getSettings>> | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [hedraInput, setHedraInput] = useState('');
  const [hedraSaving, setHedraSaving] = useState(false);
  const [hedraTesting, setHedraTesting] = useState(false);
  const [hedraTest, setHedraTest] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => getSettings().then(setInfo).catch(() => undefined);

  useEffect(() => {
    load();
  }, []);

  const onSave = async (values: any) => {
    setSaving(true);
    try {
      await saveRunninghubKey(values.apiKey);
      message.success('已保存');
      form.resetFields();
      setTestResult(null);
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testRunninghubKey();
      setTestResult({
        ok: r.ok,
        text: r.ok
          ? `连接正常${r.remainCoins != null ? `，剩余 R 币：${r.remainCoins}` : ''}`
          : r.message || '校验失败',
      });
    } catch (e: any) {
      setTestResult({ ok: false, text: e?.response?.data?.message || '校验失败' });
    } finally {
      setTesting(false);
    }
  };

  const onClear = async () => {
    await clearRunninghubKey();
    message.success('已清空');
    setTestResult(null);
    await load();
  };

  const onSaveHedra = async () => {
    if (!hedraInput.trim()) {
      message.warning('请输入 Hedra cookie');
      return;
    }
    setHedraSaving(true);
    try {
      await saveHedraCookie(hedraInput.trim());
      message.success('已保存');
      setHedraInput('');
      setHedraTest(null);
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setHedraSaving(false);
    }
  };

  const onTestHedra = async () => {
    setHedraTesting(true);
    setHedraTest(null);
    try {
      const r = await testHedraCookie();
      setHedraTest({
        ok: r.ok,
        text: r.ok
          ? r.email
            ? `登录正常：${r.email}`
            : '登录正常'
          : r.message || '校验失败',
      });
    } catch (e: any) {
      setHedraTest({ ok: false, text: e?.response?.data?.message || '校验失败' });
    } finally {
      setHedraTesting(false);
    }
  };

  const onClearHedra = async () => {
    await clearHedraCookie();
    message.success('已清空');
    setHedraTest(null);
    await load();
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="关于 RunningHub API Key"
        description={
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            视频生成由 RunningHub 工作流完成，会消耗 R 币；新用户免费额度仅 100R，不足以共享使用。
            因此系统不设共享 Key 池，请在 runninghub.cn 个人中心获取自己的 API Key 填入此处。
            Key 采用 AES-256-GCM 加密存储，页面只回显掩码。
            <br />
            生成形象 / 获取灵感使用的 AI 渠道由超级管理员统一配置，无需你填写。
          </Typography.Paragraph>
        }
      />

      <Card title="RunningHub API Key">
        <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="配置状态">
            {info?.runninghubKeyConfigured ? (
              <Tag color="green">已配置</Tag>
            ) : (
              <Tag color="red">未配置</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="当前 Key">
            {info?.runninghubKeyMask || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {info?.runninghubKeyAt ? new Date(info.runninghubKeyAt).toLocaleString('zh-CN') : '—'}
          </Descriptions.Item>
        </Descriptions>

        <Form form={form} layout="inline" onFinish={onSave}>
          <Form.Item
            name="apiKey"
            rules={[{ required: true, message: '请输入 API Key' }]}
            style={{ flex: 1, minWidth: 320 }}
          >
            <Input.Password placeholder="粘贴你的 RunningHub API Key" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>
                保存
              </Button>
              <Button onClick={onTest} loading={testing} disabled={!info?.runninghubKeyConfigured}>
                测试连接 / 查余额
              </Button>
              <Popconfirm title="确定清空已保存的 Key？" onConfirm={onClear}>
                <Button danger disabled={!info?.runninghubKeyConfigured}>
                  清空
                </Button>
              </Popconfirm>
            </Space>
          </Form.Item>
        </Form>

        {testResult && (
          <Alert
            style={{ marginTop: 16 }}
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            message={testResult.text}
          />
        )}
      </Card>

      <Card title="Hedra Cookie（提示词扩写）">
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message="关于 Hedra Cookie"
          description={
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              视频工作区的「提示词扩写」优先调用 Hedra。此处填写你自己的 Hedra 登录 cookie
              （浏览器导出数组、JSON 对象或 <code>Cookie:</code> 请求头均可），采用 AES-256-GCM
              加密存储，页面只回显掩码。留空则回退到服务器 <code>.env</code> 配置的全局 Hedra cookie。
            </Typography.Paragraph>
          }
        />
        <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="配置状态">
            {info?.hedraCookieConfigured ? (
              <Tag color="green">已配置</Tag>
            ) : (
              <Tag color="red">未配置</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="当前 Cookie">
            {info?.hedraCookieMask || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {info?.hedraCookieAt ? new Date(info.hedraCookieAt).toLocaleString('zh-CN') : '—'}
          </Descriptions.Item>
        </Descriptions>

        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Input.TextArea
            rows={4}
            placeholder="粘贴你的 Hedra cookie（数组 / JSON 对象 / Cookie 请求头）"
            value={hedraInput}
            onChange={(e) => setHedraInput(e.target.value)}
          />
          <Space>
            <Button type="primary" loading={hedraSaving} onClick={onSaveHedra}>
              保存
            </Button>
            <Button onClick={onTestHedra} loading={hedraTesting} disabled={!info?.hedraCookieConfigured}>
              测试登录
            </Button>
            <Popconfirm title="确定清空已保存的 Hedra cookie？" onConfirm={onClearHedra}>
              <Button danger disabled={!info?.hedraCookieConfigured}>
                清空
              </Button>
            </Popconfirm>
          </Space>
        </Space>

        {hedraTest && (
          <Alert
            style={{ marginTop: 16 }}
            type={hedraTest.ok ? 'success' : 'error'}
            showIcon
            message={hedraTest.text}
          />
        )}
      </Card>
    </Space>
  );
}
