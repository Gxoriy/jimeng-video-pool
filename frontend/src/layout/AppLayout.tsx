import { useState, useEffect } from 'react';
import { Layout, Menu, Avatar, Tag, Dropdown } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined,
  PictureOutlined,
  CustomerServiceOutlined,
  VideoCameraOutlined,
  TeamOutlined,
  SoundOutlined,
  FileTextOutlined,
  HistoryOutlined,
  UserOutlined,
  KeyOutlined,
  LogoutOutlined,
  CloudServerOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  SafetyCertificateOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import { api, User as UserType } from '../api/client';
import { TaskSessionProvider, clearWorkspaceStorage } from '../context/TaskSession';
import { FeaturesProvider, useFeatures } from '../context/Features';

const { Sider, Header, Content } = Layout;

const baseMenuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '概览' },
  { key: '/video-workspace', icon: <VideoCameraOutlined />, label: '视频工作区' },
  { key: '/libraries/characters', icon: <TeamOutlined />, label: '形象库' },
  { key: '/libraries/songs', icon: <SoundOutlined />, label: '歌曲库' },
  { key: '/libraries/prompts', icon: <FileTextOutlined />, label: '提示词库' },
  { key: '/tasks', icon: <HistoryOutlined />, label: '任务管理' },
  { key: '/task-logs', icon: <HistoryOutlined />, label: '任务日志' },
  { key: '/jimeng-gen', icon: <ThunderboltOutlined />, label: '即梦生成' },
  { key: '/settings', icon: <KeyOutlined />, label: '个人设置' },
];

const adminMenuItems = [
  { key: '/users', icon: <UserOutlined />, label: '用户管理' },
  { key: '/ai-channels', icon: <CloudServerOutlined />, label: 'AI 渠道配置' },
  { key: '/jimeng-accounts', icon: <SafetyCertificateOutlined />, label: '即梦账号池' },
];

/** 真正渲染菜单/布局的壳；必须在 FeaturesProvider 内以读取 hideJimeng 开关 */
function AppShell({ user }: { user: UserType }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { hideJimeng } = useFeatures();

  const isAdmin = user?.role === 'super_admin';
  let menuItems = isAdmin ? [...baseMenuItems, ...adminMenuItems] : baseMenuItems;
  // 管理员关闭即梦功能时，对所有用户隐藏即梦菜单（生成 + 账号池）
  if (hideJimeng) {
    menuItems = menuItems.filter(
      (it) => it.key !== '/jimeng-gen' && it.key !== '/jimeng-accounts',
    );
  }

  const selectedKey = '/' + (location.pathname.split('/')[1] || 'dashboard');

  const onLogout = async () => {
    await api.post('/auth/logout');
    clearWorkspaceStorage();
    window.location.hash = '#/login';
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" breakpoint="lg" collapsedWidth={0}>
        <div style={{ color: '#fff', padding: 16, fontWeight: 700, fontSize: 16 }}>
          AI 生成面板
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={(e) => navigate(e.key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
          {user && (
            <>
              <Avatar icon={<UserOutlined />} />
              <span>{user.username}</span>
              <Tag color={user.role === 'super_admin' ? 'gold' : 'blue'}>{user.role}</Tag>
              <Tag>{user.networkScope === 'broad' ? 'broad' : 'restricted'}</Tag>
            </>
          )}
          <Dropdown menu={{ items: [
            { key: 'settings', icon: <KeyOutlined />, label: '个人设置', onClick: () => navigate('/settings') },
            ...(isAdmin ? [
              { key: 'users', icon: <UserOutlined />, label: '用户管理', onClick: () => navigate('/users') },
              { key: 'channels', icon: <CloudServerOutlined />, label: 'AI 渠道配置', onClick: () => navigate('/ai-channels') },
            ] : []),
            { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: onLogout },
          ] }}>
            <a onClick={(e) => e.preventDefault()}>更多 ▾</a>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16 }}>
          <TaskSessionProvider>
            <Outlet />
          </TaskSessionProvider>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function AppLayout() {
  const [user, setUser] = useState<UserType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/auth/me').then((r) => setUser(r.data.data)).catch(() => {
      window.location.hash = '#/login';
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  return (
    <FeaturesProvider>
      <AppShell user={user!} />
    </FeaturesProvider>
  );
}
